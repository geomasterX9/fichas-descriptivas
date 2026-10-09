// ============================================================
// foto-zoom.js — Ampliar la foto del alumno al hacer clic
// Uso: <img data-zoom-foto data-nombre="APELLIDOS NOMBRE" src="...">
// Mantiene las protecciones de la foto: sin clic derecho ni arrastrar.
// ============================================================
(function () {
    const css = `
        img[data-zoom-foto] { cursor: zoom-in; }
        .fz-overlay {
            position: fixed; inset: 0; z-index: 3000; display: none;
            background: rgba(15, 23, 42, 0.88); backdrop-filter: blur(3px);
            align-items: center; justify-content: center; flex-direction: column;
            padding: 20px; cursor: zoom-out;
        }
        .fz-overlay.abierto { display: flex; }
        .fz-img {
            max-width: min(92vw, 560px); max-height: 78vh; object-fit: contain;
            border-radius: 14px; border: 4px solid #fff; background: #e2e8f0;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            user-select: none; -webkit-user-drag: none; -webkit-touch-callout: none;
            animation: fz-in 0.15s ease-out;
        }
        .fz-nombre {
            margin-top: 14px; color: #fff; font-family: 'Outfit', sans-serif;
            font-size: 17px; font-weight: 800; text-align: center; letter-spacing: 0.3px;
        }
        .fz-cerrar {
            position: absolute; top: calc(14px + env(safe-area-inset-top, 0px)); right: 16px;
            width: 42px; height: 42px; border-radius: 50%; border: none;
            background: rgba(255,255,255,0.15); color: #fff; font-size: 22px; cursor: pointer;
        }
        .fz-cerrar:hover { background: rgba(255,255,255,0.28); }
        @keyframes fz-in { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    `;

    let overlay, imgGrande, nombreEl;

    function construir() {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.className = 'fz-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<button class="fz-cerrar" type="button" aria-label="Cerrar">✕</button>' +
            '<img class="fz-img" alt="Foto del alumno" draggable="false"><div class="fz-nombre"></div>';
        document.body.appendChild(overlay);
        imgGrande = overlay.querySelector('.fz-img');
        nombreEl  = overlay.querySelector('.fz-nombre');

        overlay.addEventListener('click', cerrar);
        overlay.addEventListener('contextmenu', e => e.preventDefault());
        overlay.addEventListener('dragstart', e => e.preventDefault());
    }

    function abrir(src, nombre) {
        if (!overlay) construir();
        imgGrande.src = src;
        nombreEl.textContent = nombre || '';
        overlay.classList.add('abierto');
    }

    function cerrar() {
        if (!overlay) return;
        overlay.classList.remove('abierto');
        imgGrande.removeAttribute('src');
    }

    // Silueta genérica o foto que no cargó: no hay nada que ampliar
    function esFotoReal(img) {
        const src = img.currentSrc || img.src || '';
        return src && !src.startsWith('data:image/svg') && !src.includes('flaticon.com') && img.naturalWidth > 0;
    }

    // Fase de captura: el clic en la foto no debe activar el onclick de la fila que la contiene
    document.addEventListener('click', e => {
        const img = e.target.closest && e.target.closest('img[data-zoom-foto]');
        if (!img || !esFotoReal(img)) return;
        e.preventDefault();
        e.stopPropagation();
        abrir(img.currentSrc || img.src, img.dataset.nombre);
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay && overlay.classList.contains('abierto')) cerrar();
    });

    document.addEventListener('contextmenu', e => {
        if (e.target && e.target.matches && e.target.matches('img[data-zoom-foto]')) e.preventDefault();
    });
})();
