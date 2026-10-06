// ============================================================
// reportes-comun.js — Filtros por disciplina/docente e impresión
// de reportes disciplinarios. Lo usan dashboard.html y reportes_ts.html
// con los datos de GET /api/reportes?todos=1.
// ============================================================

// Siglas usadas en calificaciones y en usuarios.materia
const DISCIPLINAS = {
    ESP: 'Español',
    MAT: 'Matemáticas',
    SLI: 'Inglés',
    CIE: 'Ciencias',
    HIS: 'Historia',
    GMM: 'Geografía',
    FCE: 'Formación Cívica y Ética',
    ETE: 'Tecnología',
    EFI: 'Educación Física',
    ART: 'Artes',
    ESO: 'Educación Socioemocional',
};
const SIN_DISCIPLINA = '__SIN__';

function escRep(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function nombreDisciplina(sigla) { return DISCIPLINAS[sigla] || sigla; }

// Texto de las disciplinas de quien reportó; '' si no tiene registradas
function disciplinasReporte(r) {
    return (r.materia_reporta || []).map(nombreDisciplina).join(', ');
}

// Llena los <select> de disciplina y docente con los valores presentes en los datos
function poblarFiltrosReportes(reportes, selDisciplina, selDocente) {
    const siglas = new Set();
    let haySinDisciplina = false;
    reportes.forEach(r => {
        const m = r.materia_reporta || [];
        if (m.length) m.forEach(s => siglas.add(s)); else haySinDisciplina = true;
    });
    const disciplinas = [...siglas].sort((a, b) => nombreDisciplina(a).localeCompare(nombreDisciplina(b), 'es'));
    selDisciplina.innerHTML = '<option value="">Todas</option>' +
        disciplinas.map(s => `<option value="${escRep(s)}">${escRep(nombreDisciplina(s))}</option>`).join('') +
        (haySinDisciplina ? `<option value="${SIN_DISCIPLINA}">Sin disciplina registrada</option>` : '');

    const docentes = [...new Set(reportes.map(r => r.nombre_reporta).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    selDocente.innerHTML = '<option value="">Todos</option>' +
        docentes.map(d => `<option value="${escRep(d)}">${escRep(d)}</option>`).join('');
}

function coincideDisciplina(r, valor) {
    if (!valor) return true;
    const m = r.materia_reporta || [];
    return valor === SIN_DISCIPLINA ? m.length === 0 : m.includes(valor);
}

// ── Impresión ──────────────────────────────────────────────

let _cfgInstitucional = null;
async function cfgInstitucional() {
    if (_cfgInstitucional) return _cfgInstitucional;
    try {
        const r = await apiFetch('/api/dashboard?tipo=config_institucional');
        _cfgInstitucional = r ? await r.json() : {};
    } catch (e) { _cfgInstitucional = {}; }
    return _cfgInstitucional;
}

const CSS_IMPRESION = `
    body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; color: #000; }
    .hdr { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1B4F8A; padding-bottom: 8px; margin-bottom: 12px; }
    .hdr .logo { width: 70px; text-align: center; }
    .hdr img { max-height: 55px; max-width: 65px; }
    .inst { font-size: 13px; font-weight: 900; color: #1B4F8A; text-align: center; }
    .sub  { font-size: 10px; color: #444; text-align: center; }
    .tit  { font-size: 13px; font-weight: 900; text-align: center; margin: 8px 0 10px; text-transform: uppercase; }
    .filtros { font-size: 10px; margin-bottom: 8px; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    .lista th, .lista td { border: 1px solid #000; padding: 4px 5px; vertical-align: top; text-align: left; }
    .lista th { background: #e8eef6; font-size: 10px; text-transform: uppercase; }
    .lista tr { page-break-inside: avoid; }
    .datos td { border: 1px solid #000; padding: 5px 8px; vertical-align: top; }
    .datos td.lbl { font-weight: 700; width: 150px; background: #f3f6fa; }
    .sec { font-weight: 900; font-size: 11px; margin: 12px 0 4px; text-transform: uppercase; }
    .caja { border: 1px solid #000; padding: 8px; min-height: 40px; white-space: pre-wrap; }
    .firmas { display: flex; justify-content: space-around; flex-wrap: wrap; gap: 18px 10px; margin-top: 45px; page-break-inside: avoid; }
    .fb { text-align: center; width: 30%; }
    .fl { border-bottom: 1px solid #000; height: 30px; margin-bottom: 4px; }
    .ft { font-size: 10px; }
    .pie { margin-top: 10px; font-size: 9px; color: #555; text-align: right; }
    @page { margin: 1.2cm; size: letter; }
`;

function membrete(cfg) {
    const izq = cfg.logo_izquierdo ? `<img src="${escRep(cfg.logo_izquierdo)}">` : '';
    const der = cfg.logo_derecho   ? `<img src="${escRep(cfg.logo_derecho)}">`   : '';
    return `<div class="hdr">
        <div class="logo">${izq}</div>
        <div style="flex:1;">
            <div class="inst">${escRep(cfg.nombre_escuela || 'ESCUELA SECUNDARIA')}</div>
            <div class="sub">${escRep([cfg.clave_escuela, cfg.ciclo_activo].filter(Boolean).join(' · '))}</div>
            ${cfg.direccion_escuela ? `<div class="sub">${escRep(cfg.direccion_escuela)}</div>` : ''}
        </div>
        <div class="logo">${der}</div>
    </div>`;
}

// La ventana se abre antes de cualquier await para que el navegador no la bloquee
async function _imprimirHTML(titulo, cuerpo) {
    const win = window.open('', '_blank');
    if (!win) { alert('Permite las ventanas emergentes para imprimir.'); return; }
    win.document.write('<p style="font-family:Arial;padding:20px;">Preparando impresión...</p>');
    const cfg = await cfgInstitucional();
    const fechaImp = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    win.document.open();
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <title>${escRep(titulo)}</title><style>${CSS_IMPRESION}</style></head><body>
        ${membrete(cfg)}${cuerpo}
        <div class="pie">Impreso el ${escRep(fechaImp)}</div>
        </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
}

function _gradoGrupo(r) { return `${r.alumno_grado}° "${r.alumno_grupo}"`; }

// Imprime en tabla los reportes que quedaron tras filtrar.
// filtrosTexto: array de strings describiendo los filtros aplicados.
function imprimirListadoReportes(lista, filtrosTexto) {
    if (!lista.length) { alert('No hay reportes para imprimir con esos filtros.'); return; }
    const filas = lista.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td style="white-space:nowrap;">${escRep(r.fecha)}</td>
        <td>${escRep(r.alumno_apellidos)} ${escRep(r.alumno_nombre)}</td>
        <td style="white-space:nowrap;">${escRep(_gradoGrupo(r))}</td>
        <td>${escRep(r.gravedad)}</td>
        <td>${escRep(r.motivo)}</td>
        <td>${escRep(r.nombre_reporta || '—')}</td>
        <td>${escRep(disciplinasReporte(r) || '—')}</td>
        <td>${escRep(r.estatus_seguimiento || 'En proceso')}</td>
    </tr>`).join('');
    const filtros = filtrosTexto && filtrosTexto.length
        ? `<div class="filtros"><b>Filtros:</b> ${filtrosTexto.map(escRep).join(' · ')}</div>` : '';
    _imprimirHTML('Listado de Reportes Disciplinarios', `
        <div class="tit">Listado de Reportes Disciplinarios</div>
        ${filtros}
        <div class="filtros"><b>Total:</b> ${lista.length} reporte(s)</div>
        <table class="lista">
            <tr><th>#</th><th>Fecha</th><th>Alumno</th><th>G/G</th><th>Gravedad</th><th>Motivo</th><th>Reportó</th><th>Disciplina</th><th>Estatus</th></tr>
            ${filas}
        </table>`);
}

// Imprime un reporte individual en formato oficial con firmas
function imprimirReporteIndividual(r) {
    const esPositivo = r.gravedad === 'Positiva';
    const titulo = esPositivo ? 'Reconocimiento al Alumno' : 'Reporte Disciplinario';
    const fila = (lbl, val) => `<tr><td class="lbl">${lbl}</td><td>${escRep(val || '—')}</td></tr>`;
    const seguimiento = esPositivo ? '' : `
        <div class="sec">Seguimiento — Trabajo Social</div>
        <table class="datos">
            ${fila('Estatus', r.estatus_seguimiento || 'En proceso')}
            ${r.seguimiento_por ? fila('Atendido por', `${r.seguimiento_por}${r.seguimiento_fecha ? ' · ' + r.seguimiento_fecha : ''}`) : ''}
        </table>
        <div class="caja" style="margin-top:6px;">${escRep(r.acuerdos || 'Sin acuerdos registrados.')}</div>`;
    const firmas = esPositivo
        ? ['Docente que reconoce', 'Alumno(a)', 'Vo. Bo. Dirección']
        : ['Docente que reporta', 'Alumno(a)', 'Padre, madre o tutor', 'Trabajo Social', 'Vo. Bo. Dirección'];
    _imprimirHTML(`${titulo} — ${r.alumno_apellidos} ${r.alumno_nombre}`, `
        <div class="tit">${titulo}</div>
        <table class="datos">
            ${fila('Alumno(a)', `${r.alumno_apellidos} ${r.alumno_nombre}`)}
            ${fila('Grado y grupo', _gradoGrupo(r))}
            ${fila('Fecha', r.fecha)}
            ${esPositivo ? '' : fila('Gravedad', r.gravedad)}
            ${fila(esPositivo ? 'Reconocido por' : 'Reportado por', r.nombre_reporta)}
            ${fila('Disciplina', disciplinasReporte(r))}
        </table>
        <div class="sec">${esPositivo ? 'Motivo del reconocimiento' : 'Descripción de lo ocurrido'}</div>
        <div class="caja">${escRep(r.motivo)}</div>
        ${!esPositivo && r.acuerdo ? `<div class="sec">Acuerdo con el alumno</div><div class="caja">${escRep(r.acuerdo)}</div>` : ''}
        ${seguimiento}
        <div class="firmas">
            ${firmas.map(f => `<div class="fb"><div class="fl"></div><div class="ft">${f}</div></div>`).join('')}
        </div>`);
}
