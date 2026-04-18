import { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { supabase } from './supabaseClient';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function Dashboard() {
  const [notas, setNotas] = useState<any[]>([]);
  const [filtroActual, setFiltroActual] = useState<'hoy' | 'semana' | 'mes'>('hoy');
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultadoIA, setResultadoIA] = useState<any>(null);
  const [toast, setToast] = useState<{ mensaje: string; tipo: 'success' | 'error' | 'confirm'; id?: string } | null>(null);
  const [nombreDocente, setNombreDocente] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [seccionesExpandidas, setSeccionesExpandidas] = useState<{ [key: string]: boolean }>({});
  const [isManualEntry, setIsManualEntry] = useState(false);

  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (mensaje: string, tipo: 'success' | 'error' | 'confirm' = 'success', id?: string) => {
    setToast({ mensaje, tipo, id });
    if (tipo !== 'confirm') {
      setTimeout(() => setToast(null), 4000);
    }
  };

  const getGradoStyle = (grado: string) => {
    switch (grado) {
      case '1ro': return 'bg-sky-100 text-sky-800 border-sky-200';
      case '2do': return 'bg-amber-100 text-amber-800 border-amber-200';
      case '3ro': return 'bg-orange-100 text-orange-800 border-orange-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const cargarDatosIniciales = async () => {
    try {
      const savedName = localStorage.getItem('nombre_docente');
      if (savedName) setNombreDocente(savedName);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data, error } = await supabase
        .from('notas_bitacora')
        .select('*')
        .eq('docente_id', session.user.id)
        .order('creado_en', { ascending: false });
      if (error) throw error;
      if (data) setNotas(data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { cargarDatosIniciales(); }, []);

  const guardarNombre = (nuevoNombre: string) => {
    setNombreDocente(nuevoNombre);
    localStorage.setItem('nombre_docente', nuevoNombre);
    setIsEditingName(false);
    showToast('Identidad actualizada');
  };

  const ejecutarEliminacion = async (id: string) => {
    try {
      const { error } = await supabase.from('notas_bitacora').delete().eq('id', id);
      if (error) throw error;
      showToast('Nota eliminada');
      setNotas(notas.filter(n => n.id !== id));
    } catch (err) { showToast('Error al eliminar', 'error'); }
  };

  const reiniciarCiclo = async () => {
    try {
      const idsAEliminar = notasFiltradas.map(n => n.id);
      if (idsAEliminar.length === 0) return;
      const { error } = await supabase.from('notas_bitacora').delete().in('id', idsAEliminar);
      if (error) throw error;
      showToast('Vista reiniciada');
      setNotas(notas.filter(n => !idsAEliminar.includes(n.id)));
    } catch (err) { showToast('Error al reiniciar', 'error'); }
  };

  const notasFiltradas = notas.filter(nota => {
    const fechaNota = new Date(nota.creado_en);
    const hoy = new Date();
    const diffDias = Math.floor((hoy.getTime() - fechaNota.getTime()) / (1000 * 3600 * 24));
    if (filtroActual === 'hoy') return diffDias === 0 && hoy.getDate() === fechaNota.getDate();
    if (filtroActual === 'semana') return diffDias < 7;
    return diffDias < 31;
  });

  const toggleDictado = () => {
    setIsManualEntry(false);
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return showToast('No compatible', 'error');
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.lang = 'es-MX';
    recognitionRef.current.onstart = () => { setIsListening(true); setTranscript(''); setResultadoIA(null); };
    recognitionRef.current.onresult = (event: any) => {
      let current = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      setTranscript(current);
    };
    recognitionRef.current.onend = () => setIsListening(false);
    recognitionRef.current.start();
  };

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  const manejarOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsManualEntry(false);
    setIsProcessing(true);
    setResultadoIA(null);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", safetySettings });
      const prompt = `Analiza esta imagen de una nota escolar (NEM). Extrae el contenido y responde UNICAMENTE con este JSON: {"contenido": "resumen legible", "grado": "1ro/2do/3ro", "grupo": "A-H", "alumnos_involucrados": "nombres", "foco_rojo": boolean}`;
      const result = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: file.type } }]);
      const match = result.response.text().match(/{[^]*}/);
      if (match) {
        setResultadoIA(JSON.parse(match[0]));
        showToast("✨ Foto procesada");
      }
    } catch (err: any) { showToast(`Error OCR: ${err.message}`, "error"); } finally { setIsProcessing(false); }
  };

  const procesarVozIA = async () => {
    if (!transcript) return;
    setIsProcessing(true);
    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", safetySettings });
      
      const prompt = `[EXTRACTOR TÉCNICO]
      ENTRADA: <<< ${transcript} >>>
      TAREA: Extraer JSON con contenido literal entre <<< >>>.
      
      REGLAS DE CLASIFICACIÓN:
      - GRADO: (1ro-3ro)
      - GRUPO: (A-H). FONÉTICA: [be=B, de=D, ce=C, ge=G].
      - ALUMNOS: (Nombres o null)
      - CONSIGNAS: (Tema o null)
      - FOCO ROJO: boolean (Criterio estricto de riesgo)
      - SEGUIMIENTO: boolean (requiere_seguimiento)

      FORMATO JSON ESPERADO:
      {
         "contenido": "texto literal",
         "grado": "VALOR",
         "grupo": "LETRA",
         "alumnos_involucrados": "nombres o null",
         "consignas_relacionadas": "tema o null",
         "foco_rojo": boolean,
         "requiere_seguimiento": boolean
      }`;

      const result = await model.generateContent(prompt);
      const match = result.response.text().match(/\{[\s\S]*\}/);
      
      if (match) {
        let data = JSON.parse(match[0]);
        if (data.contenido) {
          data.contenido = data.contenido.replace(/bateador/gi, "vapeador");
          data.contenido = data.contenido.replace(/bateadores/gi, "vapeadores");
        }
        setResultadoIA(data);
      }
    } catch (err: any) { showToast(`Error IA: ${err.message}`, "error"); } finally { setIsProcessing(false); }
  };

  const guardarNota = async () => {
    if (!resultadoIA) return;
    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) throw new Error("Sesión expirada");
      const focoRojoBooleano = resultadoIA.foco_rojo === true || resultadoIA.foco_rojo === "true";
      let tipoEntrada = isManualEntry ? 'texto_directo' : (transcript ? 'voz' : 'ocr');

      const { error } = await supabase.from('notas_bitacora').insert([{
        docente_id: session.user.id,
        contenido: String(resultadoIA.contenido || ''),
        grado: String(resultadoIA.grado || ''),
        grupo: String(resultadoIA.grupo || ''),
        alumnos_involucrados: String(resultadoIA.alumnos_involucrados || ''),
        foco_rojo: focoRojoBooleano,
        tipo_entrada: tipoEntrada
      }]);

      if (error) throw error;
      showToast('✅ Guardado con éxito');
      setResultadoIA(null); setTranscript(''); setIsManualEntry(false);
      setTimeout(() => cargarDatosIniciales(), 500);
    } catch (err: any) { showToast(`Error DB: ${err.message}`, 'error'); } finally { setIsProcessing(false); }
  };

  const exportarBitacora = async () => {
    if (notasFiltradas.length === 0) return showToast('No hay notas para exportar', 'error');
    setIsProcessing(true);
    try {
      const fechaHoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '_');
      const nombreArchivo = `Bitacora_NEM_${fechaHoy}.pdf`;
      const htmlContent = `<html><head><style>body { font-family: 'Calibri', sans-serif; padding: 40px; color: #1e293b; } .header { border-bottom: 3px solid #2563eb; padding-bottom: 10px; text-align: center; } .registro { margin-bottom: 20px; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; } .firmas { margin-top: 50px; display: flex; justify-content: space-around; } .firma-box { border-top: 2px solid #000; width: 40%; text-align: center; padding-top: 5px; font-size: 12px; }</style></head><body><div class="header"><h2>REPORTE OFICIAL DE BITÁCORA</h2><p>Planeador NEM Pro</p></div><p><strong>DOCENTE:</strong> ${nombreDocente}<br><strong>FECHA:</strong> ${new Date().toLocaleDateString()}</p>${notasFiltradas.map((n, i) => `<div class="registro"><strong>#${i + 1} - ${n.grado} ${n.grupo}</strong> [${n.foco_rojo ? 'RIESGO' : 'ESTÁNDAR'}]<br>${n.contenido}<br><small>Alumnos: ${n.alumnos_involucrados}</small></div>`).join('')}<div class="firmas"><div class="firma-box">FIRMA DOCENTE</div><div class="firma-box">SELLO Y FIRMA DIRECTOR</div></div></body></html>`;
      const win = window.open('', '', 'width=900,height=700');
      if (win) {
        win.document.write(htmlContent); win.document.close(); win.document.title = nombreArchivo;
        setTimeout(() => { win.print(); win.close(); }, 500);
      }
    } catch (err) { showToast('Error al exportar', 'error'); } finally { setIsProcessing(false); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-6 pb-24 font-sans max-w-md mx-auto relative overflow-x-hidden selection:bg-blue-200">
      <style>{`* { font-family: 'Calibri', 'Inter', sans-serif !important; }`}</style>
      
      {/* Toast Notificación Premium (Glassmorphism) */}
      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3.5 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md font-semibold text-[13px] flex flex-col items-center gap-3 min-w-[300px] transition-all duration-300 animate-in slide-in-from-top-4 border ${toast.tipo === 'success' ? 'bg-white/95 text-slate-800 border-slate-200/60' : 'bg-rose-600/95 text-white border-rose-500'}`}>
          <span className="flex items-center gap-2">{toast.tipo === 'success' && <span className="text-emerald-500 text-lg">●</span>} {toast.mensaje}</span>
          {toast.tipo === 'confirm' && (
            <div className="flex gap-3 w-full mt-1">
              <button onClick={() => { if(toast.mensaje.includes('reiniciar')) reiniciarCiclo(); else ejecutarEliminacion(toast.id!); setToast(null); }} className="flex-1 bg-rose-500 hover:bg-rose-600 px-4 py-2 rounded-xl text-white font-bold transition-colors shadow-sm">Confirmar</button>
              <button onClick={() => setToast(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl text-slate-700 font-semibold transition-colors">Cancelar</button>
            </div>
          )}
        </div>
      )}

      <header className="mb-10 flex justify-between items-start pt-2">
        <div>
          <h1 onClick={() => setIsEditingName(true)} className="text-[26px] leading-none font-extrabold text-slate-800 tracking-tight flex items-center gap-2 cursor-pointer group">
            {isEditingName ? (
              <input autoFocus className="border-b-2 border-blue-500 bg-transparent outline-none w-44 text-slate-800 placeholder-slate-400" placeholder="Tu nombre..." onBlur={(e) => guardarNombre(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && guardarNombre(e.currentTarget.value)}/>
            ) : (nombreDocente || 'Tu Bitácora')}
            {!isEditingName && <span className="text-slate-300 group-hover:text-blue-500 transition-colors text-sm">✎</span>}
          </h1>
          <p className="text-blue-600/80 font-semibold text-[11px] uppercase mt-2 tracking-[0.15em]">NEM Pro Digital</p>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={() => showToast(`¿Reiniciar vista de ${filtroActual}?`, 'confirm')} className="bg-white p-2.5 rounded-full border border-slate-200/60 shadow-sm hover:shadow-md hover:bg-slate-50 transition-all text-slate-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          </button>
          <button onClick={exportarBitacora} className="bg-slate-800 hover:bg-slate-900 px-4 py-2.5 rounded-full shadow-md text-white font-semibold text-[12px] tracking-wide flex items-center gap-1.5 transition-all active:scale-95">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            PDF
          </button>
        </div>
      </header>

      <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={manejarOCR} className="hidden" />

      <section className="grid grid-cols-3 gap-4 mb-10">
        <button onClick={toggleDictado} className={`aspect-square rounded-3xl border flex flex-col items-center justify-center transition-all duration-300 ease-out shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] active:scale-95 ${isListening ? 'border-rose-200 bg-rose-50 shadow-rose-100' : 'border-slate-100 bg-white'}`}>
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-2 transition-colors ${isListening ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-200' : 'bg-slate-50 text-slate-700'}`}>
            {isListening ? '⏹️' : '🎙️'}
          </div>
          <span className={`text-[12px] font-bold tracking-wide ${isListening ? 'text-rose-700' : 'text-slate-600'}`}>{isListening ? 'Parar' : 'Dictar'}</span>
        </button>

        <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-3xl bg-white border border-slate-100 shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex flex-col items-center justify-center active:scale-95 transition-all duration-300 ease-out">
          <div className="w-14 h-14 rounded-full bg-slate-50 text-slate-700 flex items-center justify-center text-2xl mb-2">📷</div>
          <span className="text-[12px] font-bold tracking-wide text-slate-600">Foto</span>
        </button>

        <button onClick={() => { setIsManualEntry(true); setTranscript(''); setResultadoIA(null); }} className={`aspect-square rounded-3xl border flex flex-col items-center justify-center active:scale-95 transition-all duration-300 ease-out shadow-[0_4px_20px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] ${isManualEntry ? 'border-blue-200 bg-blue-50' : 'border-slate-100 bg-white'}`}>
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-2 ${isManualEntry ? 'bg-blue-500 text-white shadow-lg shadow-blue-200' : 'bg-slate-50 text-slate-700'}`}>✍️</div>
          <span className={`text-[12px] font-bold tracking-wide ${isManualEntry ? 'text-blue-700' : 'text-slate-600'}`}>Manual</span>
        </button>
      </section>

      {isProcessing && (
        <div className="mb-8 p-6 bg-slate-800 rounded-3xl text-white text-center font-semibold text-[13px] tracking-widest shadow-lg animate-pulse flex items-center justify-center gap-3">
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-ping"></span> PROCESANDO IA
        </div>
      )}

      {(transcript || resultadoIA || isManualEntry) && (
        <div className="mb-10 p-6 bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-slate-100 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex justify-between items-center mb-5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-3 py-1 rounded-full border border-slate-100">Vista Previa</span>
            <button onClick={() => {setTranscript(''); setResultadoIA(null); setIsManualEntry(false);}} className="text-rose-500 font-bold text-[12px] hover:bg-rose-50 px-3 py-1 rounded-full transition-colors">Cancelar ✕</button>
          </div>
          
          {isManualEntry && !resultadoIA ? (
            <textarea autoFocus value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Escribe los detalles del reporte aquí..." className="w-full bg-slate-50/50 border border-slate-200 rounded-2xl p-5 text-[15px] text-slate-700 font-medium min-h-[120px] outline-none focus:border-blue-400 focus:bg-white transition-all mb-5 shadow-inner placeholder:text-slate-400"/>
          ) : (
            <div className="bg-slate-50/80 rounded-2xl p-5 mb-6 border border-slate-100">
              <p className="text-slate-700 font-medium text-[15px] leading-relaxed">"{resultadoIA?.contenido || transcript}"</p>
            </div>
          )}

          {resultadoIA ? (
            <button onClick={guardarNota} disabled={isProcessing} className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-[13px] tracking-wide shadow-lg shadow-emerald-200 transition-all active:scale-[0.98]">
              Guardar en Bitácora
            </button>
          ) : (
            transcript.trim() !== '' && (
              <button onClick={procesarVozIA} disabled={isProcessing} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-[13px] tracking-wide shadow-lg shadow-blue-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                Estructurar con IA <span className="text-lg">✨</span>
              </button>
            )
          )}
        </div>
      )}

      <div className="mt-8">
        <div className="flex justify-between items-center mb-6 px-1">
          <h2 className="text-[20px] font-extrabold text-slate-800 flex items-center gap-2">
            Historial
            <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-bold border border-slate-200">{notasFiltradas.length}</span>
          </h2>
          <div className="flex bg-slate-100 p-1.5 rounded-full border border-slate-200/60 shadow-inner">
            {['hoy', 'semana', 'mes'].map((f) => (
              <button key={f} onClick={() => setFiltroActual(f as any)} className={`text-[11px] font-bold px-4 py-1.5 rounded-full capitalize transition-all duration-200 ${filtroActual === f ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
            ))}
          </div>
        </div>
        
        <div className="space-y-5">
          {notasFiltradas.length === 0 ? (
             <div className="text-center py-12 px-4 bg-white rounded-3xl border border-slate-100 border-dashed">
               <p className="text-slate-400 font-medium text-sm">No hay registros en este periodo.</p>
             </div>
          ) : (
            notasFiltradas.slice(0, seccionesExpandidas[filtroActual] ? undefined : 3).map((n) => (
              <div key={n.id} className={`p-6 rounded-3xl border relative transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] group ${n.foco_rojo ? 'bg-rose-50/50 border-rose-100 shadow-sm' : 'bg-white border-slate-100 shadow-[0_2px_15px_rgb(0,0,0,0.03)]'}`}>
                
                <button onClick={() => showToast('¿Eliminar registro permanentemente?', 'confirm', n.id)} className="absolute top-5 right-5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-2 rounded-full transition-colors opacity-0 group-hover:opacity-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>

                <div className="flex items-center gap-3 mb-4">
                  <span className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${getGradoStyle(n.grado)}`}>
                    {n.grado} {n.grupo}
                  </span>
                  {n.foco_rojo && (
                    <span className="text-[10px] font-extrabold text-rose-600 uppercase tracking-widest bg-rose-100 px-3 py-1.5 rounded-full border border-rose-200 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></span> Riesgo
                    </span>
                  )}
                  <span className="text-[11px] font-medium text-slate-400 ml-auto mr-8">
                    {new Date(n.creado_en).toLocaleString('es-MX', {day: 'numeric', month: 'short', hour:'2-digit', minute:'2-digit', hour12:true})}
                  </span>
                </div>
                
                <p className={`text-[15px] font-medium leading-relaxed mb-4 ${n.foco_rojo ? 'text-slate-800' : 'text-slate-700'}`}>
                  {n.contenido}
                </p>
                
                {n.alumnos_involucrados && (
                  <div className="flex items-center gap-2">
                     <span className="text-slate-400 text-sm">👤</span>
                     <span className="text-[12px] font-semibold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                       {n.alumnos_involucrados}
                     </span>
                  </div>
                )}
              </div>
            ))
          )}
          
          {notasFiltradas.length > 3 && (
            <button onClick={() => setSeccionesExpandidas({...seccionesExpandidas, [filtroActual]: !seccionesExpandidas[filtroActual]})} className="w-full py-4 text-[12px] font-bold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-colors">
              {seccionesExpandidas[filtroActual] ? 'Mostrar menos' : `Cargar ${notasFiltradas.length - 3} registros más`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}