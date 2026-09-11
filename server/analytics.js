/**
 * Análisis estructurado en milisegundos: SLA, señal y automatización/bots.
 */

const BOT_TEXT_PATTERNS = [
  /\bbot\b/i,
  /\bautom[aá]tico\b/i,
  /mensaje automatico/i,
  /no respondas a este mensaje/i,
  /powered by/i,
  /whatsapp.?web\.?js/i,
  /\bbaileys\b/i,
  /\btermux\b/i,
  /\bopenwa\b/i,
  /\bvenom[- ]bot\b/i,
  /\bwwebjs\b/i,
  /^\/(start|menu|help|pedido)\b/i,
  /escribe\s*[«"']?\d+[»"']?\s*para/i,
  /responde con el n[uú]mero/i,
  /opci[oó]n\s*\d+\s*:/i,
  /men[uú]\s*:/i,
  /\[bot\]/i,
  /🤖/,
];

const TEMPLATE_NORMALIZE = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}\p{N}\s#]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

function toMs(order) {
  if (order.response_ms != null && Number.isFinite(Number(order.response_ms))) {
    return Number(order.response_ms);
  }
  if (order.response_seconds != null && Number.isFinite(Number(order.response_seconds))) {
    return Math.round(Number(order.response_seconds) * 1000);
  }
  return null;
}

function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums) {
  if (nums.length < 2) return null;
  const m = mean(nums);
  const v = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function percentile(nums, p) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return Math.round(a[lo] + (a[hi] - a[lo]) * (idx - lo));
}

function round1(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function msBundle(ms) {
  if (ms == null) return null;
  return {
    ms: Math.round(ms),
    seconds: Math.round((ms / 1000) * 1000) / 1000,
  };
}

function computeImportStats(orders) {
  const answered = orders.filter((o) => toMs(o) != null);
  const times = answered.map((o) => toMs(o));
  const avg = mean(times);
  const med = median(times);
  const sd = stdDev(times);
  const max = times.length ? Math.max(...times) : null;
  const min = times.length ? Math.min(...times) : null;

  const under500 = times.filter((t) => t <= 500).length;
  const under1000 = times.filter((t) => t <= 1000).length;
  const under3000 = times.filter((t) => t <= 3000).length;
  const under8000 = times.filter((t) => t <= 8000).length;
  const under15000 = times.filter((t) => t <= 15000).length;
  const under60000 = times.filter((t) => t <= 60000).length;
  const under180000 = times.filter((t) => t <= 180000).length;
  const over600000 = times.filter((t) => t > 600000).length;

  const buckets_ms = {
    ultra_0_250ms: times.filter((t) => t <= 250).length,
    botish_251_500ms: times.filter((t) => t > 250 && t <= 500).length,
    subsecond_501_1000ms: times.filter((t) => t > 500 && t <= 1000).length,
    instant_1001_3000ms: times.filter((t) => t > 1000 && t <= 3000).length,
    very_fast_3001_8000ms: times.filter((t) => t > 3000 && t <= 8000).length,
    fast_8001_15000ms: times.filter((t) => t > 8000 && t <= 15000).length,
    normal_15_60s: times.filter((t) => t > 15000 && t <= 60000).length,
    ok_1_3m: times.filter((t) => t > 60000 && t <= 180000).length,
    slow_3_10m: times.filter((t) => t > 180000 && t <= 600000).length,
    very_slow_10m_plus: times.filter((t) => t > 600000).length,
  };

  // Compat buckets antiguos (segundos)
  const buckets = {
    instant_0_5s: times.filter((t) => t <= 5000).length,
    very_fast_6_15s: times.filter((t) => t > 5000 && t <= 15000).length,
    fast_16_60s: times.filter((t) => t > 15000 && t <= 60000).length,
    normal_1_3m: times.filter((t) => t > 60000 && t <= 180000).length,
    slow_3_10m: times.filter((t) => t > 180000 && t <= 600000).length,
    very_slow_10m_plus: times.filter((t) => t > 600000).length,
  };

  const precisionCounts = { ms: 0, s: 0 };
  for (const o of answered) {
    if (o.timing_precision === 'ms') precisionCounts.ms += 1;
    else precisionCounts.s += 1;
  }

  const pct = (n) =>
    orders.length ? Math.round((n / orders.length) * 1000) / 10 : 0;

  return {
    unit: 'ms',
    total_orders: orders.length,
    answered: answered.length,
    pending: orders.length - answered.length,
    avg_response_ms: avg != null ? Math.round(avg) : null,
    median_response_ms: med,
    stddev_response_ms: sd != null ? Math.round(sd) : null,
    min_response_ms: min,
    max_response_ms: max,
    p50_ms: percentile(times, 50),
    p75_ms: percentile(times, 75),
    p90_ms: percentile(times, 90),
    p95_ms: percentile(times, 95),
    p99_ms: percentile(times, 99),
    avg_response_seconds: avg != null ? round1(avg / 1000) : null,
    median_response_seconds: med != null ? round1(med / 1000) : null,
    stddev_response_seconds: sd != null ? round1(sd / 1000) : null,
    min_response_seconds: min != null ? round1(min / 1000) : null,
    max_response_seconds: max != null ? round1(max / 1000) : null,
    pct_under_500ms: pct(under500),
    pct_under_1000ms: pct(under1000),
    pct_under_3000ms: pct(under3000),
    pct_under_8000ms: pct(under8000),
    pct_under_15s: pct(under15000),
    pct_under_60s: pct(under60000),
    pct_under_180s: pct(under180000),
    pct_over_10m: pct(over600000),
    buckets_ms,
    buckets,
    timing_precision: precisionCounts,
    note:
      precisionCounts.ms === 0
        ? 'El export de WhatsApp suele traer precisión de 1s; los ms se muestran exactos como múltiplos de 1000. Usa captura en vivo/API para ms reales.'
        : 'Algunos timestamps incluyen milisegundos reales.',
  };
}

function classifySignal(input = {}) {
  const network_type = input.network_type || 'unknown';
  const effective_type = input.effective_type || 'unknown';
  const downlink =
    input.downlink != null && input.downlink !== ''
      ? Number(input.downlink)
      : null;
  const rtt =
    input.rtt != null && input.rtt !== '' ? Number(input.rtt) : null;
  const channel = input.signal_channel || input.channel || 'auto';
  const bars =
    input.signal_bars != null && input.signal_bars !== ''
      ? Number(input.signal_bars)
      : null;
  const environment = input.signal_environment || input.environment || null;
  const note = input.signal_quality || input.signal_note || null;
  const save_data = Boolean(input.save_data);

  let score = 50;
  const factors = [];

  if (effective_type === 'offline' || network_type === 'offline') {
    score = 0;
    factors.push('Dispositivo sin conexión');
  } else if (effective_type === 'slow-2g' || effective_type === '2g') {
    score = 20;
    factors.push('Red 2G / slow-2g (muy débil para WhatsApp fluido)');
  } else if (effective_type === '3g') {
    score = 45;
    factors.push('Red 3G (latencia media-alta)');
  } else if (effective_type === '4g') {
    score = 75;
    factors.push('Red 4G efectiva');
  } else if (network_type === 'wifi' || effective_type === 'wifi') {
    score = 80;
    factors.push('Canal WiFi');
  } else {
    factors.push(`Tipo efectivo: ${effective_type}`);
  }

  if (downlink != null && Number.isFinite(downlink)) {
    if (downlink >= 10) {
      score += 10;
      factors.push(`Downlink alto (${downlink} Mbps)`);
    } else if (downlink >= 1.5) {
      score += 5;
      factors.push(`Downlink medio (${downlink} Mbps)`);
    } else if (downlink < 0.5) {
      score -= 20;
      factors.push(`Downlink bajo (${downlink} Mbps)`);
    } else {
      factors.push(`Downlink ${downlink} Mbps`);
    }
  }

  if (rtt != null && Number.isFinite(rtt)) {
    if (rtt <= 50) {
      score += 8;
      factors.push(`RTT excelente (${rtt} ms)`);
    } else if (rtt <= 150) {
      score += 3;
      factors.push(`RTT bueno (${rtt} ms)`);
    } else if (rtt <= 300) {
      factors.push(`RTT aceptable (${rtt} ms)`);
    } else if (rtt <= 600) {
      score -= 10;
      factors.push(`RTT alto (${rtt} ms)`);
    } else {
      score -= 25;
      factors.push(`RTT crítico (${rtt} ms)`);
    }
  }

  if (save_data) {
    score -= 5;
    factors.push('Modo ahorro de datos activo');
  }

  if (bars != null && Number.isFinite(bars)) {
    if (bars >= 4) score += 5;
    else if (bars === 3) score += 0;
    else if (bars === 2) score -= 10;
    else if (bars <= 1) score -= 20;
    factors.push(`Barras reportadas: ${bars}/5`);
  }

  const channelMeta = describeChannel(channel);
  if (channelMeta.scoreAdj) score += channelMeta.scoreAdj;
  if (channelMeta.factor) factors.push(channelMeta.factor);

  score = Math.max(0, Math.min(100, Math.round(score)));

  let band = 'media';
  if (score >= 80) band = 'excelente';
  else if (score >= 65) band = 'buena';
  else if (score >= 45) band = 'media';
  else if (score >= 25) band = 'mala';
  else band = 'critica';

  return {
    network_type,
    effective_type,
    downlink: Number.isFinite(downlink) ? downlink : null,
    rtt: Number.isFinite(rtt) ? rtt : null,
    save_data,
    signal_channel: channel,
    signal_channel_label: channelMeta.label,
    signal_bars: Number.isFinite(bars) ? bars : null,
    signal_environment: environment,
    signal_quality: note || channelMeta.label,
    score,
    band,
    band_label: bandLabel(band),
    factors,
    risk_for_orders:
      band === 'critica' || band === 'mala'
        ? 'Alto riesgo de demoras o mensajes no enviados'
        : band === 'media'
          ? 'Riesgo moderado en horarios pico'
          : 'Condiciones adecuadas para tomar pedidos',
  };
}

function describeChannel(channel) {
  switch (channel) {
    case 'wifi':
      return { label: 'WiFi fijo / oficina', scoreAdj: 5, factor: 'Canal WiFi declarado' };
    case 'mobile_data':
      return { label: 'Datos móviles', scoreAdj: 0, factor: 'Canal datos móviles' };
    case 'hotspot':
      return {
        label: 'Hotspot compartido',
        scoreAdj: -8,
        factor: 'Hotspot (suele ser inestable)',
      };
    case 'termux_host':
      return {
        label: 'Host Termux / sesión automatizada',
        scoreAdj: -5,
        factor:
          'Canal Termux u host de bot (señal del celular que corre la sesión)',
      };
    case 'vps_cloud':
      return {
        label: 'VPS / nube (API o bot remoto)',
        scoreAdj: 10,
        factor: 'Infraestructura cloud (señal del dispositivo local no aplica igual)',
      };
    case 'whatsapp_business_api':
      return {
        label: 'WhatsApp Business Cloud API',
        scoreAdj: 12,
        factor: 'API oficial (sin depender de WiFi del operador)',
      };
    case 'unknown':
    case 'auto':
    default:
      return {
        label: 'Detectado automáticamente',
        scoreAdj: 0,
        factor: null,
      };
  }
}

function bandLabel(band) {
  const map = {
    excelente: 'Excelente',
    buena: 'Buena',
    media: 'Media',
    mala: 'Mala',
    critica: 'Crítica',
  };
  return map[band] || band;
}

function analyzeAutomation(messages, orders, operatorNames = []) {
  const opSet = new Set(operatorNames);
  const opMessages = messages.filter((m) => opSet.has(m.author));
  const findings = [];
  let score = 0;

  const times = (orders || []).map((o) => toMs(o)).filter((t) => t != null);
  const ultra = times.filter((t) => t <= 500).length;
  const subsec = times.filter((t) => t <= 1000).length;
  const instant = times.filter((t) => t <= 3000).length;
  const veryFast = times.filter((t) => t <= 8000).length;

  if (times.length >= 3 && ultra / times.length >= 0.4) {
    score += 40;
    findings.push({
      code: 'ultra_fast_ms',
      severity: 'high',
      title: 'Respuestas en ≤500 ms',
      detail: `${ultra}/${times.length} en ≤500 ms — casi imposible humano; típico bot Termux/API.`,
    });
  } else if (times.length >= 3 && subsec / times.length >= 0.5) {
    score += 35;
    findings.push({
      code: 'subsecond_replies',
      severity: 'high',
      title: 'Respuestas en ≤1000 ms',
      detail: `${subsec}/${times.length} en ≤1 s (patrón de automatización).`,
    });
  } else if (times.length >= 3 && instant / times.length >= 0.5) {
    score += 30;
    findings.push({
      code: 'instant_replies',
      severity: 'high',
      title: 'Respuestas en ≤3000 ms',
      detail: `${instant}/${times.length} respuestas en ≤3 s (típico de bot en Termux/sesión web).`,
    });
  } else if (times.length >= 3 && veryFast / times.length >= 0.6) {
    score += 22;
    findings.push({
      code: 'very_fast_replies',
      severity: 'medium',
      title: 'Respuestas muy rápidas (≤8000 ms)',
      detail: `${veryFast}/${times.length} en ≤8 s. Puede ser bot o plantillas con atajos.`,
    });
  }

  const sd = stdDev(times);
  const med = median(times);
  if (times.length >= 5 && sd != null && sd < 400 && med != null && med <= 10000) {
    score += 18;
    findings.push({
      code: 'low_variance_ms',
      severity: 'medium',
      title: 'Tiempos muy uniformes (ms)',
      detail: `Desviación ${Math.round(sd)} ms con mediana ${med} ms — patrón mecánico.`,
    });
  }

  const templates = {};
  for (const m of opMessages) {
    const key = TEMPLATE_NORMALIZE(m.body);
    if (key.length < 8) continue;
    templates[key] = (templates[key] || 0) + 1;
  }
  const repeated = Object.entries(templates)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1]);
  if (repeated.length) {
    score += Math.min(25, repeated[0][1] * 4);
    findings.push({
      code: 'repeated_templates',
      severity: repeated[0][1] >= 5 ? 'high' : 'medium',
      title: 'Mensajes plantilla repetidos',
      detail: `El texto más repetido aparece ${repeated[0][1]} veces (menús/bots suelen hacer esto).`,
    });
  }

  let botPhraseHits = 0;
  const phraseSamples = [];
  for (const m of opMessages) {
    for (const p of BOT_TEXT_PATTERNS) {
      if (p.test(m.body)) {
        botPhraseHits += 1;
        if (phraseSamples.length < 5) {
          phraseSamples.push({
            author: m.author,
            excerpt: m.body.slice(0, 140),
          });
        }
        break;
      }
    }
  }
  if (botPhraseHits >= 1) {
    score += Math.min(30, 10 + botPhraseHits * 5);
    findings.push({
      code: 'bot_phrases',
      severity: botPhraseHits >= 3 ? 'high' : 'medium',
      title: 'Lenguaje típico de bot / menú',
      detail: `${botPhraseHits} mensajes con patrones de bot, Termux, Baileys, menú numérico o comandos.`,
      samples: phraseSamples,
    });
  }

  const nightOps = opMessages.filter((m) => {
    const h = new Date(m.timestamp).getHours();
    return h >= 0 && h < 6;
  });
  if (opMessages.length >= 10 && nightOps.length / opMessages.length >= 0.25) {
    score += 12;
    findings.push({
      code: 'night_activity',
      severity: 'low',
      title: 'Actividad nocturna elevada',
      detail: `${Math.round((nightOps.length / opMessages.length) * 100)}% de mensajes de operadores entre 00:00 y 06:00.`,
    });
  }

  const exactDupes = {};
  for (const m of opMessages) {
    const k = m.body.trim();
    if (k.length < 12) continue;
    exactDupes[k] = exactDupes[k] || new Set();
    exactDupes[k].add(m.author);
  }
  const multiAuthorSame = Object.values(exactDupes).filter((s) => s.size > 1);
  if (multiAuthorSame.length) {
    score += 10;
    findings.push({
      code: 'shared_copy',
      severity: 'low',
      title: 'Mismo texto desde varios nombres',
      detail:
        'Posible sesión compartida, reenvíos masivos o bot que firma con distintos alias.',
    });
  }

  score = Math.max(0, Math.min(100, score));
  let level = 'humano_probable';
  if (score >= 70) level = 'bot_probable';
  else if (score >= 40) level = 'mixto_sospechoso';
  else if (score >= 20) level = 'indicios_leves';

  const level_label = {
    humano_probable: 'Atención humana probable',
    indicios_leves: 'Indicios leves de automatización',
    mixto_sospechoso: 'Mixto / sospechoso (humano + bot o Termux)',
    bot_probable: 'Automatización / bot probable',
  }[level];

  return {
    score,
    level,
    level_label,
    findings,
    metrics: {
      operator_messages: opMessages.length,
      ultra_fast_le_500ms: ultra,
      subsecond_le_1000ms: subsec,
      instant_le_3000ms: instant,
      very_fast_le_8000ms: veryFast,
      repeated_template_count: repeated.length,
      bot_phrase_hits: botPhraseHits,
      response_stddev_ms: sd != null ? Math.round(sd) : null,
      response_median_ms: med,
      response_avg_ms: mean(times) != null ? Math.round(mean(times)) : null,
    },
    disclaimer:
      'Heurística sobre el export en milisegundos. No prueba al 100% Termux/Baileys; sirve para auditoría interna.',
  };
}

function buildStructuredReport({
  chatTitle,
  messages,
  orders,
  operators,
  authors,
  signalInput,
  registrar,
}) {
  const stats = computeImportStats(orders);
  const signal = classifySignal(signalInput);
  const automation = analyzeAutomation(messages, orders, operators);

  return {
    meta: {
      chat_title: chatTitle,
      generated_at: new Date().toISOString(),
      registrar: registrar || null,
      operators,
      authors,
      message_count: messages.length,
      order_count: orders.length,
    },
    sections: {
      sla: {
        title: 'Tiempos de respuesta (SLA en ms)',
        summary: stats,
      },
      signal: {
        title: 'Señal y canal de conexión',
        summary: signal,
      },
      automation: {
        title: 'Automatización / bots (Termux, menús, sesiones)',
        summary: automation,
      },
      orders: {
        title: 'Detalle por pedido',
        items: orders,
      },
    },
    stats,
    signal,
    automation,
  };
}

module.exports = {
  computeImportStats,
  classifySignal,
  analyzeAutomation,
  buildStructuredReport,
  toMs,
  msBundle,
};
