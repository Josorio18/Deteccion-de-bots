/**
 * Parser de chats exportados de WhatsApp (.txt).
 * Soporta formatos comunes ES/EN:
 *   [DD/MM/YYYY, HH:MM:SS] Nombre: mensaje
 *   DD/MM/YYYY, HH:MM - Nombre: mensaje
 *   [M/D/YY, H:MM:SS AM/PM] Name: message
 */

const ORDER_KEYWORDS = [
  'pedido',
  'quiero',
  'necesito',
  'me da',
  'me das',
  'ordenar',
  'domicilio',
  'delivery',
  'enviar',
  'manda',
  'trae',
  'menu',
  'menú',
  'combo',
  'hamburguesa',
  'pizza',
  'hola',
  'buenas',
  'buenos dias',
  'buenos días',
  'buenas tardes',
  'buenas noches',
];

const SYSTEM_PATTERNS = [
  /messages and calls are end-to-end encrypted/i,
  /los mensajes y las llamadas están cifrados/i,
  /creó el grupo/i,
  /created group/i,
  /se unió usando/i,
  /joined using/i,
  /cambió el asunto/i,
  /changed the subject/i,
  /eliminó este mensaje/i,
  /this message was deleted/i,
  /omitiste este mensaje/i,
  /^‎?<medios omitidos>/i,
  /^‎?<media omitted>/i,
];

const LINE_PATTERNS = [
  // [DD/MM/YYYY, HH:MM:SS.mmm] Name: msg
  /^\[(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d{1,3})?)?(?:\s*(?:[AP]M|a\.?\s*m\.?|p\.?\s*m\.?))?)\]\s*([^:]+):\s*(.*)$/i,
  // DD/MM/YYYY, HH:MM:SS.mmm a. m. - Name: msg
  /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d{1,3})?)?(?:\s*(?:[AP]M|a\.?\s*m\.?|p\.?\s*m\.))?)\s*[-–]\s*([^:]+):\s*(.*)$/i,
  // DD/MM/YYYY HH:MM:SS.mmm Name: msg
  /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d{1,3})?)?)\s+([^:]+):\s*(.*)$/i,
];

function parseDateTime(dateStr, timeStr) {
  const dateClean = dateStr.replace(/-/g, '/');
  const parts = dateClean.split('/').map((p) => parseInt(p, 10));
  let day;
  let month;
  let year;

  if (parts[0] > 12) {
    day = parts[0];
    month = parts[1];
    year = parts[2];
  } else if (parts[1] > 12) {
    month = parts[0];
    day = parts[1];
    year = parts[2];
  } else {
    day = parts[0];
    month = parts[1];
    year = parts[2];
  }

  if (year < 100) year += 2000;

  let time = timeStr.trim();
  let hours;
  let minutes;
  let seconds = 0;
  let ms = 0;
  let hasMs = false;

  const ampmMatch = time.match(/\s*(a\.?\s*m\.?|p\.?\s*m\.?|[AP]M)$/i);
  let isPM = false;
  let hasAmPm = false;
  if (ampmMatch) {
    hasAmPm = true;
    const marker = ampmMatch[1].toLowerCase().replace(/\s/g, '').replace(/\./g, '');
    isPM = marker === 'pm' || marker.startsWith('p');
    time = time.slice(0, ampmMatch.index).trim();
  }

  const msMatch = time.match(/[.,](\d{1,3})$/);
  if (msMatch) {
    hasMs = true;
    ms = parseInt(msMatch[1].padEnd(3, '0'), 10);
    time = time.slice(0, msMatch.index);
  }

  const tp = time.split(':').map((x) => parseInt(x, 10));
  hours = tp[0];
  minutes = tp[1] || 0;
  seconds = tp[2] || 0;
  const timePrecision = hasMs ? 'ms' : tp.length >= 3 ? 's' : 'minute';

  if (hasAmPm) {
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }

  const d = new Date(year, month - 1, day, hours, minutes, seconds, ms);
  if (Number.isNaN(d.getTime())) return null;
  return {
    iso: d.toISOString(),
    ms: d.getTime(),
    hasMs,
    timePrecision,
  };
}

function isSystemMessage(text, author) {
  if (!text) return true;
  if (SYSTEM_PATTERNS.some((p) => p.test(text))) return true;
  if (!author) return true;
  return false;
}

function looksLikeOrder(text) {
  if (!text || text.length < 2) return false;
  const lower = text.toLowerCase();
  return ORDER_KEYWORDS.some((k) => lower.includes(k));
}

const ORDER_TAKING_PATTERNS = [
  /^(bueno|bien|listo|perfecto|claro|de acuerdo)\b/i,
  /señor|señora|caballero/i,
  /ya (lo|te|le) (tomo|tengo|apunto|anoto)/i,
  /voy a (tomar|anotar|apuntar|revisar)/i,
  /qué desea|que desea|qué va a llevar|que va a llevar/i,
  /me confirma|confírmame|confirmame|dirección|direccion/i,
  /en cuánto|en cuanto|para cuándo|para cuando/i,
];

const ACKNOWLEDGEMENT_PATTERNS = [
  /^(bueno|bien|listo|perfecto|ok|okay|vale|claro|entendido|de acuerdo)\b/i,
  /^(sí|si),?\s*(señor|señora)?[.!]?$/i,
  /recibido|entendido|ya reviso|ya miro/i,
];

function classifyInteraction(customerText, operatorText) {
  const customer = String(customerText || '').trim();
  const operator = String(operatorText || '').trim();
  if (ORDER_TAKING_PATTERNS.some((pattern) => pattern.test(operator))) {
    return looksLikeOrder(customer) ? 'toma_de_pedido' : 'confirmacion_reaccion';
  }
  if (ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(operator))) {
    return 'confirmacion_reaccion';
  }
  if (/[?¿]/.test(operator)) return 'pregunta_del_operador';
  return looksLikeOrder(customer) ? 'respuesta_al_pedido' : 'reaccion';
}

function precisionUnitMs(message) {
  if (message?.time_precision === 'ms') return 1;
  if (message?.time_precision === 's') return 1000;
  return 60000;
}

function detectInteractions(messages, options = {}) {
  const operatorNames = new Set(options.operatorNames || []);
  if (!operatorNames.size) return [];

  const interactions = [];
  for (let i = 0; i < messages.length; i += 1) {
    const incoming = messages[i];
    if (operatorNames.has(incoming.author)) continue;
    const previous = i > 0 ? messages[i - 1] : null;
    for (let j = i + 1; j < messages.length; j += 1) {
      const outgoing = messages[j];
      if (outgoing.author === incoming.author) break;
      if (operatorNames.has(outgoing.author)) {
        const incomingMs = incoming.timestamp_ms ?? Date.parse(incoming.timestamp);
        const outgoingMs = outgoing.timestamp_ms ?? Date.parse(outgoing.timestamp);
        const previousMs = previous?.timestamp_ms ?? (previous ? Date.parse(previous.timestamp) : null);
        const firstMs = messages[0]?.timestamp_ms ?? (messages[0] ? Date.parse(messages[0].timestamp) : null);
        const responseNominalMs = incomingMs != null && outgoingMs != null
          ? Math.max(0, outgoingMs - incomingMs)
          : null;
        const incomingUnitMs = precisionUnitMs(incoming);
        const outgoingUnitMs = precisionUnitMs(outgoing);
        interactions.push({
          incoming_message: incoming,
          response_message: outgoing,
          category: classifyInteraction(incoming.body, outgoing.body),
          response_ms: responseNominalMs,
          response_min_ms: responseNominalMs != null
            ? Math.max(0, responseNominalMs - incomingUnitMs)
            : null,
          response_max_ms: responseNominalMs != null
            ? responseNominalMs + outgoingUnitMs
            : null,
          since_previous_ms: previousMs != null && incomingMs != null
            ? Math.max(0, incomingMs - previousMs)
            : null,
          elapsed_from_start_ms: firstMs != null && outgoingMs != null
            ? Math.max(0, outgoingMs - firstMs)
            : null,
          timing_precision: incoming.time_precision === 'minute' || outgoing.time_precision === 'minute'
            ? 'minute'
            : incoming.time_precision === 's' || outgoing.time_precision === 's'
              ? 's'
              : 'ms',
          same_minute: incoming.rawDate === outgoing.rawDate && incoming.rawTime === outgoing.rawTime,
        });
        break;
      }
    }
  }
  return interactions;
}

function parseChatText(rawText) {
  const lines = rawText.replace(/^\uFEFF/, '').split(/\r?\n/);
  const messages = [];
  let current = null;

  for (const line of lines) {
    let matched = false;
    for (const pattern of LINE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        if (current) messages.push(current);
        const parsed = parseDateTime(m[1], m[2]);
        current = {
          timestamp: parsed ? parsed.iso : null,
          timestamp_ms: parsed ? parsed.ms : null,
          has_ms: parsed ? parsed.hasMs : false,
          time_precision: parsed ? parsed.timePrecision : 'unknown',
          rawDate: m[1],
          rawTime: m[2],
          author: m[3].trim(),
          body: m[4] || '',
        };
        matched = true;
        break;
      }
    }
    if (!matched && current) {
      current.body += `\n${line}`;
    }
  }
  if (current) messages.push(current);

  return messages.filter(
    (msg) => msg.timestamp && !isSystemMessage(msg.body, msg.author)
  );
}

/**
 * Detecta "operadores" como los autores más frecuentes que responden
 * (o lista explícita). Clientes = el resto.
 */
function detectOrders(messages, options = {}) {
  const {
    operatorNames = [],
    gapMinutes = 30,
    requireKeyword = false,
  } = options;

  const authorCounts = {};
  for (const msg of messages) {
    authorCounts[msg.author] = (authorCounts[msg.author] || 0) + 1;
  }

  const sortedAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);
  const inferredOperators = new Set(
    operatorNames.length
      ? operatorNames
      : sortedAuthors.slice(0, Math.min(3, Math.max(1, Math.floor(sortedAuthors.length / 2)))).map(([n]) => n)
  );

  // If many unique authors (group), treat less frequent as customers
  if (!operatorNames.length && sortedAuthors.length > 4) {
    inferredOperators.clear();
    // Top 20% of message volume as operators
    const total = messages.length;
    let acc = 0;
    for (const [name, count] of sortedAuthors) {
      inferredOperators.add(name);
      acc += count;
      if (acc / total >= 0.35) break;
    }
  }

  const orders = [];
  let i = 0;
  let lastOrderCustomer = null;
  let lastOrderClosedAt = null;

  while (i < messages.length) {
    const msg = messages[i];
    const isOp = inferredOperators.has(msg.author);

    if (!isOp) {
      const prev = i > 0 ? messages[i - 1] : null;
      const afterGap =
        !prev ||
        new Date(msg.timestamp) - new Date(prev.timestamp) > gapMinutes * 60 * 1000;

      // Continuación del mismo cliente tras respuesta del operador (dirección, etc.)
      const sameThreadContinuation =
        lastOrderCustomer === msg.author &&
        lastOrderClosedAt &&
        new Date(msg.timestamp) - new Date(lastOrderClosedAt) < gapMinutes * 60 * 1000 &&
        !afterGap;

      const afterIdle =
        !lastOrderClosedAt ||
        new Date(msg.timestamp) - new Date(lastOrderClosedAt) > gapMinutes * 60 * 1000;

      const shouldStart =
        !sameThreadContinuation &&
        (afterGap || afterIdle || orders.length === 0 || looksLikeOrder(msg.body));

      if (shouldStart && (!requireKeyword || looksLikeOrder(msg.body))) {
        let response = null;
        for (let j = i + 1; j < messages.length; j++) {
          if (inferredOperators.has(messages[j].author)) {
            response = messages[j];
            break;
          }
          if (
            new Date(messages[j].timestamp) - new Date(msg.timestamp) >
            gapMinutes * 60 * 1000
          ) {
            break;
          }
        }

        const orderAt = msg.timestamp;
        const orderAtMs = msg.timestamp_ms ?? Date.parse(orderAt);
        const respondedAt = response ? response.timestamp : null;
        const respondedAtMs = response
          ? response.timestamp_ms ?? Date.parse(response.timestamp)
          : null;
        let responseMs = null;
        let responseSeconds = null;
        let responseMinMs = null;
        let responseMaxMs = null;
        if (respondedAtMs != null && orderAtMs != null) {
          responseMs = Math.max(0, respondedAtMs - orderAtMs);
          responseSeconds = responseMs / 1000;
          const incomingUnitMs = precisionUnitMs(msg);
          const responseUnitMs = precisionUnitMs(response);
          responseMinMs = Math.max(0, responseMs - incomingUnitMs);
          responseMaxMs = responseMs + responseUnitMs;
        }

        const timingPrecision =
          msg.time_precision === 'minute' || response?.time_precision === 'minute'
            ? 'minute'
            : (msg.has_ms || (response && response.has_ms)) ? 'ms' : 's';

        orders.push({
          customer_name: msg.author,
          customer_message: msg.body.slice(0, 500),
          order_at: orderAt,
          order_at_ms: orderAtMs,
          responder_name: response ? response.author : null,
          response_message: response ? response.body.slice(0, 500) : null,
          responded_at: respondedAt,
          responded_at_ms: respondedAtMs,
          response_ms: responseMs,
          response_seconds: responseSeconds,
          response_min_ms: responseMinMs,
          response_max_ms: responseMaxMs,
          timing_precision: timingPrecision,
          status: response ? 'answered' : 'pending',
        });

        lastOrderCustomer = msg.author;
        lastOrderClosedAt = respondedAt || orderAt;

        if (response) {
          i = messages.indexOf(response);
        }
      }
    }
    i += 1;
  }

  return {
    messages,
    orders,
    operators: [...inferredOperators],
    authors: sortedAuthors.map(([name, count]) => ({ name, count })),
  };
}

function extractChatTitle(filename, text) {
  const fromName = filename
    .replace(/\.txt$/i, '')
    .replace(/^WhatsApp Chat (with|con) /i, '')
    .replace(/^Chat de WhatsApp con /i, '');
  if (fromName && fromName !== filename) return fromName;

  const firstLines = text.split(/\r?\n/).slice(0, 5).join(' ');
  const groupMatch = firstLines.match(/"([^"]+)"/);
  return groupMatch ? groupMatch[1] : fromName || 'Chat importado';
}

module.exports = {
  parseChatText,
  detectOrders,
  detectInteractions,
  extractChatTitle,
  ORDER_KEYWORDS,
};
