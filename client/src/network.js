/**
 * Captura y clasificación de señal / canal de atención.
 */

export const SIGNAL_CHANNELS = [
  { id: 'auto', label: 'Detectar automáticamente' },
  { id: 'wifi', label: 'WiFi fijo / oficina' },
  { id: 'mobile_data', label: 'Datos móviles' },
  { id: 'hotspot', label: 'Hotspot compartido' },
  { id: 'termux_host', label: 'Termux / bot en celular' },
  { id: 'vps_cloud', label: 'VPS / nube' },
  { id: 'whatsapp_business_api', label: 'WhatsApp Business API' },
];

export const SIGNAL_ENVIRONMENTS = [
  { id: '', label: 'No especificado' },
  { id: 'oficina', label: 'Oficina / local' },
  { id: 'calle', label: 'Calle / domicilio' },
  { id: 'casa', label: 'Casa' },
  { id: 'bodega', label: 'Bodega / cocina' },
  { id: 'servidor', label: 'Servidor / Termux fijo' },
];

export function captureNetworkSignal() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const conn =
    nav?.connection || nav?.mozConnection || nav?.webkitConnection || null;

  const online = nav?.onLine ?? true;

  if (!conn) {
    return {
      network_type: online ? 'unknown' : 'offline',
      effective_type: online ? 'unknown' : 'offline',
      downlink: null,
      rtt: null,
      save_data: false,
      signal_captured_at: new Date().toISOString(),
      quality_label: online ? 'Desconocida (API no disponible)' : 'Sin conexión',
      score_hint: online ? 50 : 0,
    };
  }

  const effective = conn.effectiveType || 'unknown';
  const type = conn.type || 'unknown';
  const downlink = typeof conn.downlink === 'number' ? conn.downlink : null;
  const rtt = typeof conn.rtt === 'number' ? conn.rtt : null;
  const save_data = Boolean(conn.saveData);

  return {
    network_type: type,
    effective_type: effective,
    downlink,
    rtt,
    save_data,
    signal_captured_at: new Date().toISOString(),
    quality_label: labelQuality(effective, downlink, rtt, online),
    score_hint: hintScore(effective, downlink, rtt, online, save_data),
  };
}

function labelQuality(effective, downlink, rtt, online) {
  if (!online) return 'Sin conexión';
  if (effective === '4g' || (downlink != null && downlink >= 5)) return 'Buena';
  if (effective === '3g' || (downlink != null && downlink >= 1)) return 'Media';
  if (effective === '2g' || effective === 'slow-2g') return 'Mala';
  if (rtt != null && rtt > 500) return 'Latencia alta';
  if (rtt != null && rtt > 200) return 'Media';
  return effective === 'wifi' || effective === 'unknown'
    ? 'Variable'
    : String(effective);
}

function hintScore(effective, downlink, rtt, online, save_data) {
  if (!online) return 0;
  let s = 50;
  if (effective === '4g') s = 75;
  else if (effective === '3g') s = 45;
  else if (effective === '2g' || effective === 'slow-2g') s = 20;
  if (downlink != null) {
    if (downlink >= 10) s += 10;
    else if (downlink < 0.5) s -= 20;
  }
  if (rtt != null) {
    if (rtt <= 50) s += 8;
    else if (rtt > 600) s -= 25;
    else if (rtt > 300) s -= 10;
  }
  if (save_data) s -= 5;
  return Math.max(0, Math.min(100, s));
}

export function formatDuration(value, unit = 'auto') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  let ms = Number(value);
  // Heurística: si parece segundos (< 100000 y unit auto no es ms explícito) 
  // pero preferimos pasar ms. Si unit === 's', convertir.
  if (unit === 's') ms = ms * 1000;
  if (unit === 'auto' && ms > 0 && ms < 1000 && Number.isInteger(ms) === false) {
    // valores como 75.5 segundos
    ms = ms * 1000;
  }

  const totalMs = Math.round(ms);
  const abs = Math.abs(totalMs);
  const sign = totalMs < 0 ? '-' : '';

  if (abs < 1000) {
    return `${sign}${abs} ms`;
  }

  const seconds = abs / 1000;
  if (abs < 60000) {
    return `${sign}${seconds.toFixed(3)} s (${abs.toLocaleString('es-CO')} ms)`;
  }

  const m = Math.floor(abs / 60000);
  const remMs = abs % 60000;
  const remS = (remMs / 1000).toFixed(3);
  if (m < 60) {
    return `${sign}${m}m ${remS}s (${abs.toLocaleString('es-CO')} ms)`;
  }
  const h = Math.floor(m / 60);
  return `${sign}${h}h ${m % 60}m ${remS}s (${abs.toLocaleString('es-CO')} ms)`;
}

/** Formato compacto solo ms + s */
export function formatMs(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const n = Math.round(Number(ms));
  return `${n.toLocaleString('es-CO')} ms`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const base = d.toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${base}.${ms}`;
  } catch {
    return iso;
  }
}

export function bandClass(band) {
  return `band-${band || 'media'}`;
}

export function automationClass(level) {
  return `auto-${level || 'humano_probable'}`;
}
