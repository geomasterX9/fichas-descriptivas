// ============================================================
// AUTH HELPER — EST 84 Frontend
// ============================================================

async function apiFetch(url, opciones = {}) {
    const token = localStorage.getItem('authToken');
    if (!token) {
        cerrarSesionYRedirigir();
        return null;
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(opciones.headers || {})
    };

    if (opciones.body instanceof FormData) {
        delete headers['Content-Type'];
    }

    try {
        const respuesta = await fetch(url, { ...opciones, headers });

        if (respuesta.status === 401) {
            const data = await respuesta.json().catch(() => ({}));
            alert(data.error || 'Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
            cerrarSesionYRedirigir();
            return null;
        }
        if (respuesta.status === 403) {
            const data = await respuesta.json().catch(() => ({}));
            alert(data.error || 'No tienes permiso para realizar esta acción.');
            return null;
        }

        return respuesta;
    } catch (e) {
        console.error('Error de red en apiFetch:', url, e);
        return null;
    }
}

function verificarSesion() {
    const token = localStorage.getItem('authToken');
    const rol = localStorage.getItem('rolActivo');
    if (!token || !rol) {
        window.location.href = 'index.html';
        return false;
    }
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(decodeURIComponent(atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join('')));
        if (payload.exp && Date.now() / 1000 > payload.exp) {
            alert('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
            cerrarSesionYRedirigir();
            return false;
        }
    } catch (e) {
        // No cerrar sesión por error de decodificación — dejar que el servidor valide
        console.warn('No se pudo decodificar token localmente:', e.message);
    }
    return true;
}

function cerrarSesionYRedirigir() {
    localStorage.clear();
    window.location.href = 'index.html';
}

// Registrar acción en log — fire and forget (no bloquea la UI)
function registrarLog(accion, detalle = null) {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ accion, detalle })
    }).catch(() => {}); // Silencioso — los logs no deben interrumpir el flujo
}

function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
