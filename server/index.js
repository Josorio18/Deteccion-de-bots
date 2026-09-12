const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const JSZip = require('jszip');
const db = require('./db');
const {
  parseChatText,
  detectOrders,
  detectInteractions,
  extractChatTitle,
} = require('./parser');
const { createWhatsAppRouter } = require('./whatsappWebhook');
const {
  computeImportStats,
  classifySignal,
  buildStructuredReport,
} = require('./analytics');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => {
    if (req.originalUrl.startsWith('/api/whatsapp/webhook')) req.rawBody = Buffer.from(buffer);
  },
}));

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function rowToOrder(row) {
  if (!row) return null;
  return {
    ...row,
    save_data: Boolean(row.save_data),
  };
}

// --- Operators ---
app.get('/api/operators', (_req, res) => {
  const rows = db.prepare('SELECT * FROM operators ORDER BY name').all();
  res.json(rows);
});

app.post('/api/operators', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO operators (id, name) VALUES (?, ?)').run(id, name);
    res.status(201).json({ id, name });
  } catch {
    res.status(409).json({ error: 'Ya existe un operador con ese nombre' });
  }
});

// --- Import chat export ---
async function readChatFromFile(filePath, originalName) {
  const lower = (originalName || '').toLowerCase();
  if (lower.endsWith('.zip')) {
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);
    const txtEntry = Object.keys(zip.files).find(
      (n) => n.toLowerCase().endsWith('.txt') && !zip.files[n].dir
    );
    if (!txtEntry) throw new Error('El ZIP no contiene un archivo .txt de chat');
    const text = await zip.files[txtEntry].async('string');
    return { text, filename: path.basename(txtEntry) };
  }
  const text = fs.readFileSync(filePath, 'utf8');
  return { text, filename: originalName };
}

function parseOperatorNames(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
  } catch {
    /* comma-separated fallback */
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureOperatorByName(name) {
  if (!name) return null;
  const existing = db
    .prepare('SELECT * FROM operators WHERE lower(name) = lower(?)')
    .get(name.trim());
  if (existing) return existing;
  const id = randomUUID();
  db.prepare('INSERT INTO operators (id, name) VALUES (?, ?)').run(
    id,
    name.trim()
  );
  return { id, name: name.trim() };
}

// Preview: parse without saving — para pedir operadores / señal
app.post('/api/imports/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido (.txt o .zip)' });
  try {
    const { text, filename } = await readChatFromFile(
      req.file.path,
      req.file.originalname
    );
    const chatTitle = extractChatTitle(filename, text);
    const messages = parseChatText(text);
    const detected = detectOrders(messages, {});

    fs.unlink(req.file.path, () => {});

    if (!messages.length) {
      return res.status(400).json({
        error:
          'No se detectaron mensajes. Exporta el chat desde WhatsApp (formato .txt).',
      });
    }

    res.json({
      chat_title: chatTitle,
      filename: req.file.originalname,
      message_count: messages.length,
      authors: detected.authors,
      suggested_operators: detected.operators,
      sample_messages: messages.slice(0, 5).map((m) => ({
        author: m.author,
        body: m.body.slice(0, 120),
        timestamp: m.timestamp,
      })),
      needs: {
        operators:
          'Marca quiénes son operadores de la empresa (quienes responden pedidos).',
        signal:
          'Registra el tipo de canal (WiFi, datos, hotspot, Termux/bot, API) y la calidad de red.',
        registrar:
          'Indica tu nombre (quien está subiendo y midiendo la señal ahora).',
        automation:
          'El informe incluirá indicios de bots/Termux/menús automáticos según tiempos y textos.',
      },
      signal_channels: [
        { id: 'auto', label: 'Detectar automáticamente' },
        { id: 'wifi', label: 'WiFi fijo / oficina' },
        { id: 'mobile_data', label: 'Datos móviles' },
        { id: 'hotspot', label: 'Hotspot compartido' },
        { id: 'termux_host', label: 'Termux / sesión de bot en celular' },
        { id: 'vps_cloud', label: 'VPS / nube' },
        { id: 'whatsapp_business_api', label: 'WhatsApp Business API' },
      ],
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message || 'Error al leer el chat' });
  }
});

app.post('/api/imports', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido (.txt o .zip)' });

  try {
    const operatorNames = parseOperatorNames(req.body.operatorNames);
    const registrarName = (req.body.registrarName || '').trim();
    const network_type = req.body.network_type || null;
    const effective_type = req.body.effective_type || null;
    const downlink =
      req.body.downlink !== undefined && req.body.downlink !== ''
        ? Number(req.body.downlink)
        : null;
    const rtt =
      req.body.rtt !== undefined && req.body.rtt !== ''
        ? Number(req.body.rtt)
        : null;
    const save_data =
      req.body.save_data === '1' ||
      req.body.save_data === 'true' ||
      req.body.save_data === true;
    const signal_quality = (req.body.signal_quality || '').trim() || null;
    const signal_channel = (req.body.signal_channel || 'auto').trim();
    const signal_bars =
      req.body.signal_bars !== undefined && req.body.signal_bars !== ''
        ? Number(req.body.signal_bars)
        : null;
    const signal_environment = (req.body.signal_environment || '').trim() || null;
    const signal_captured_at =
      req.body.signal_captured_at || new Date().toISOString();

    if (!operatorNames.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: 'Indica al menos un operador (quien responde en el chat).',
      });
    }
    if (!registrarName) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: 'Indica tu nombre (quien registra la señal).',
      });
    }
    if (!effective_type && !network_type && signal_channel === 'auto') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        error: 'Registra la señal/red o elige un canal (Termux, WiFi, API…).',
      });
    }

    const registrar = ensureOperatorByName(registrarName);
    for (const name of operatorNames) ensureOperatorByName(name);

    const signalInput = {
      network_type,
      effective_type,
      downlink,
      rtt,
      save_data,
      signal_quality,
      signal_channel,
      signal_bars,
      signal_environment,
    };
    const signalClassified = classifySignal(signalInput);

    const { text, filename } = await readChatFromFile(
      req.file.path,
      req.file.originalname
    );
    const chatTitle = extractChatTitle(filename, text);
    const messages = parseChatText(text);
    const detected = detectOrders(messages, { operatorNames });
    const interactions = detectInteractions(messages, { operatorNames });

    const importId = randomUUID();
    const qualityStore = JSON.stringify({
      note: signal_quality,
      channel: signalClassified.signal_channel,
      bars: signalClassified.signal_bars,
      environment: signal_environment,
      score: signalClassified.score,
      band: signalClassified.band,
    });

    const insertImport = db.prepare(`
      INSERT INTO imports (id, filename, chat_title, message_count, order_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, import_id, source, customer_name, customer_message, order_at,
        responder_name, response_message, responded_at, response_seconds,
        response_ms, timing_precision,
        operator_id, network_type, effective_type, downlink, rtt, save_data,
        signal_captured_at, status, chat_title
      ) VALUES (?, ?, 'export', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const savedOrders = [];

    const tx = db.transaction(() => {
      insertImport.run(
        importId,
        req.file.originalname,
        chatTitle,
        messages.length,
        detected.orders.length
      );
      for (const o of detected.orders) {
        const id = randomUUID();
        const responseMs =
          o.response_ms != null
            ? Math.round(o.response_ms)
            : o.response_seconds != null
              ? Math.round(o.response_seconds * 1000)
              : null;
        const responseSeconds =
          responseMs != null ? responseMs / 1000 : null;
        insertOrder.run(
          id,
          importId,
          o.customer_name,
          o.customer_message,
          o.order_at,
          o.responder_name,
          o.response_message,
          o.responded_at,
          responseSeconds,
          responseMs,
          o.timing_precision || 's',
          registrar.id,
          network_type || signalClassified.network_type,
          effective_type || signalClassified.effective_type,
          Number.isFinite(downlink) ? downlink : signalClassified.downlink,
          Number.isFinite(rtt) ? rtt : signalClassified.rtt,
          save_data ? 1 : 0,
          signal_captured_at,
          o.status,
          chatTitle
        );
        savedOrders.push({
          id,
          ...o,
          response_ms: responseMs,
          response_seconds: responseSeconds,
          operator_id: registrar.id,
          operator_name: registrar.name,
          network_type: network_type || signalClassified.network_type,
          effective_type: effective_type || signalClassified.effective_type,
          downlink: Number.isFinite(downlink) ? downlink : signalClassified.downlink,
          rtt: Number.isFinite(rtt) ? rtt : signalClassified.rtt,
          signal_quality: qualityStore,
          signal_captured_at,
        });
      }
    });
    tx();

    fs.unlink(req.file.path, () => {});

    const report = buildStructuredReport({
      chatTitle,
      messages,
      orders: savedOrders,
      operators: detected.operators,
      authors: detected.authors,
      signalInput: {
        ...signalInput,
        signal_captured_at,
      },
      registrar: registrar.name,
    });

    res.status(201).json({
      id: importId,
      chat_title: chatTitle,
      message_count: messages.length,
      order_count: detected.orders.length,
      operators: detected.operators,
      authors: detected.authors,
      // La exportación se analiza completa; los pedidos son solo una vista derivada.
      messages: messages.map((message, index) => ({
        id: index + 1,
        author: message.author,
        body: message.body,
        timestamp: message.timestamp,
        timestamp_ms: message.timestamp_ms,
        has_ms: message.has_ms,
      })),
      interactions: interactions.map((interaction, index) => ({
        id: index + 1,
        category: interaction.category,
        response_ms: interaction.response_ms,
        response_min_ms: interaction.response_min_ms,
        response_max_ms: interaction.response_max_ms,
        since_previous_ms: interaction.since_previous_ms,
        elapsed_from_start_ms: interaction.elapsed_from_start_ms,
        timing_precision: interaction.timing_precision,
        same_minute: interaction.same_minute,
        incoming: {
          author: interaction.incoming_message.author,
          body: interaction.incoming_message.body,
          timestamp: interaction.incoming_message.timestamp,
        },
        response: {
          author: interaction.response_message.author,
          body: interaction.response_message.body,
          timestamp: interaction.response_message.timestamp,
        },
      })),
      orders: savedOrders,
      signal: {
        ...report.signal,
        signal_captured_at,
        registrar: registrar.name,
      },
      stats: report.stats,
      automation: report.automation,
      report,
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message || 'Error al procesar el chat' });
  }
});

app.get('/api/imports', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM imports ORDER BY imported_at DESC')
    .all();
  res.json(rows);
});

app.get('/api/imports/:id', (req, res) => {
  const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(req.params.id);
  if (!imp) return res.status(404).json({ error: 'Importación no encontrada' });
  const orders = db
    .prepare(
      `SELECT o.*, op.name AS operator_name
       FROM orders o LEFT JOIN operators op ON op.id = o.operator_id
       WHERE o.import_id = ?
       ORDER BY o.order_at ASC`
    )
    .all(req.params.id)
    .map(rowToOrder);
  res.json({
    ...imp,
    orders,
    stats: computeImportStats(orders),
    signal: orders[0]
      ? {
          network_type: orders[0].network_type,
          effective_type: orders[0].effective_type,
          downlink: orders[0].downlink,
          rtt: orders[0].rtt,
          signal_captured_at: orders[0].signal_captured_at,
          registrar: orders[0].operator_name,
        }
      : null,
  });
});

// --- Orders ---
app.get('/api/orders', (req, res) => {
  const { operator_id, from, to, status } = req.query;
  let sql = `
    SELECT o.*, op.name AS operator_name
    FROM orders o
    LEFT JOIN operators op ON op.id = o.operator_id
    WHERE 1=1
  `;
  const params = [];
  if (operator_id) {
    sql += ' AND o.operator_id = ?';
    params.push(operator_id);
  }
  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }
  if (from) {
    sql += ' AND date(o.order_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(o.order_at) <= date(?)';
    params.push(to);
  }
  sql += ' ORDER BY o.order_at DESC';
  const rows = db.prepare(sql).all(...params).map(rowToOrder);
  res.json(rows);
});

// CSV debe ir antes de /:id
app.get('/api/orders/export.csv', (req, res) => {
  const { from, to, operator_id } = req.query;
  let sql = `
    SELECT o.*, op.name AS operator_name
    FROM orders o
    LEFT JOIN operators op ON op.id = o.operator_id
    WHERE 1=1
  `;
  const params = [];
  if (operator_id) {
    sql += ' AND o.operator_id = ?';
    params.push(operator_id);
  }
  if (from) {
    sql += ' AND date(o.order_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(o.order_at) <= date(?)';
    params.push(to);
  }
  sql += ' ORDER BY o.order_at DESC';
  const rows = db.prepare(sql).all(...params);

  const headers = [
    'id',
    'source',
    'chat_title',
    'customer_name',
    'customer_message',
    'order_at',
    'responder_name',
    'operator_name',
    'responded_at',
    'response_ms',
    'response_seconds',
    'timing_precision',
    'status',
    'network_type',
    'effective_type',
    'downlink',
    'rtt',
    'signal_captured_at',
  ];

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="pedidos-whatsapp.csv"'
  );
  res.send('\uFEFF' + lines.join('\n'));
});

/** Crear pedido manual (sin import) + señal */
app.post('/api/orders/manual', (req, res) => {
  const {
    customer_name,
    customer_message,
    operator_id,
    network_type,
    effective_type,
    downlink,
    rtt,
    save_data,
    chat_title,
  } = req.body;

  if (!operator_id) {
    return res.status(400).json({ error: 'operator_id requerido' });
  }
  const op = db.prepare('SELECT * FROM operators WHERE id = ?').get(operator_id);
  if (!op) return res.status(400).json({ error: 'Operador no válido' });

  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO orders (
      id, source, customer_name, customer_message, order_at,
      responder_name, responded_at, response_seconds, response_ms, timing_precision,
      operator_id, network_type, effective_type, downlink, rtt, save_data,
      signal_captured_at, status, chat_title
    ) VALUES (?, 'manual', ?, ?, ?, ?, ?, 0, 0, 'ms', ?, ?, ?, ?, ?, ?, ?, 'answered', ?)
  `).run(
    id,
    customer_name || 'Cliente',
    customer_message || '',
    now,
    op.name,
    now,
    operator_id,
    network_type || null,
    effective_type || null,
    downlink ?? null,
    rtt ?? null,
    save_data ? 1 : 0,
    now,
    chat_title || 'Manual'
  );

  const row = db
    .prepare(
      `SELECT o.*, op.name AS operator_name
       FROM orders o LEFT JOIN operators op ON op.id = o.operator_id
       WHERE o.id = ?`
    )
    .get(id);

  res.status(201).json(rowToOrder(row));
});

app.get('/api/orders/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT o.*, op.name AS operator_name
       FROM orders o LEFT JOIN operators op ON op.id = o.operator_id
       WHERE o.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(rowToOrder(row));
});

/** Registrar toma de pedido + señal de red del operador */
app.post('/api/orders/:id/take', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  const {
    operator_id,
    network_type,
    effective_type,
    downlink,
    rtt,
    save_data,
    signal_captured_at,
  } = req.body;

  if (!operator_id) {
    return res.status(400).json({ error: 'operator_id requerido' });
  }

  const op = db.prepare('SELECT * FROM operators WHERE id = ?').get(operator_id);
  if (!op) return res.status(400).json({ error: 'Operador no válido' });

  const capturedAt = signal_captured_at || new Date().toISOString();
  let responseSeconds = order.response_seconds;
  let responseMs = order.response_ms;
  let respondedAt = order.responded_at;
  let status = order.status;
  let timingPrecision = order.timing_precision || 's';

  if (!respondedAt) {
    respondedAt = capturedAt;
    responseMs = Math.max(
      0,
      new Date(capturedAt).getTime() - new Date(order.order_at).getTime()
    );
    responseSeconds = responseMs / 1000;
    timingPrecision = 'ms';
    status = 'answered';
  }

  db.prepare(`
    UPDATE orders SET
      operator_id = ?,
      network_type = ?,
      effective_type = ?,
      downlink = ?,
      rtt = ?,
      save_data = ?,
      signal_captured_at = ?,
      responder_name = COALESCE(responder_name, ?),
      responded_at = ?,
      response_seconds = ?,
      response_ms = ?,
      timing_precision = ?,
      status = ?
    WHERE id = ?
  `).run(
    operator_id,
    network_type || null,
    effective_type || null,
    downlink ?? null,
    rtt ?? null,
    save_data ? 1 : 0,
    capturedAt,
    op.name,
    respondedAt,
    responseSeconds,
    responseMs,
    timingPrecision,
    status,
    req.params.id
  );

  const updated = db
    .prepare(
      `SELECT o.*, op.name AS operator_name
       FROM orders o LEFT JOIN operators op ON op.id = o.operator_id
       WHERE o.id = ?`
    )
    .get(req.params.id);

  res.json(rowToOrder(updated));
});

// --- Metrics ---
app.get('/api/metrics', (req, res) => {
  const { from, to, operator_id } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (from) {
    where += ' AND date(order_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    where += ' AND date(order_at) <= date(?)';
    params.push(to);
  }
  if (operator_id) {
    where += ' AND operator_id = ?';
    params.push(operator_id);
  }

  const summary = db
    .prepare(
      `SELECT
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        AVG(CASE WHEN COALESCE(response_ms, response_seconds * 1000) IS NOT NULL
          THEN COALESCE(response_ms, response_seconds * 1000) END) AS avg_response_ms,
        MAX(COALESCE(response_ms, response_seconds * 1000)) AS max_response_ms,
        MIN(CASE WHEN COALESCE(response_ms, response_seconds * 1000) IS NOT NULL
          THEN COALESCE(response_ms, response_seconds * 1000) END) AS min_response_ms
      FROM orders ${where}`
    )
    .get(...params);

  const byNetwork = db
    .prepare(
      `SELECT
        COALESCE(effective_type, network_type, 'desconocido') AS network,
        COUNT(*) AS count,
        AVG(COALESCE(response_ms, response_seconds * 1000)) AS avg_response_ms
      FROM orders ${where}
      GROUP BY network
      ORDER BY count DESC`
    )
    .all(...params);

  const byOperator = db
    .prepare(
      `SELECT
        COALESCE(op.name, o.responder_name, 'Sin asignar') AS operator,
        COUNT(*) AS count,
        AVG(COALESCE(o.response_ms, o.response_seconds * 1000)) AS avg_response_ms
      FROM orders o
      LEFT JOIN operators op ON op.id = o.operator_id
      ${where.replace(/order_at/g, 'o.order_at').replace(/operator_id/g, 'o.operator_id')}
      GROUP BY operator
      ORDER BY count DESC`
    )
    .all(...params);

  const roundMs = (v) => (v != null ? Math.round(v) : null);

  res.json({
    summary: {
      ...summary,
      avg_response_ms: roundMs(summary.avg_response_ms),
      max_response_ms: roundMs(summary.max_response_ms),
      min_response_ms: roundMs(summary.min_response_ms),
      avg_response_seconds: summary.avg_response_ms != null
        ? Math.round(summary.avg_response_ms) / 1000
        : null,
      max_response_seconds: summary.max_response_ms != null
        ? Math.round(summary.max_response_ms) / 1000
        : null,
      min_response_seconds: summary.min_response_ms != null
        ? Math.round(summary.min_response_ms) / 1000
        : null,
    },
    by_network: byNetwork.map((r) => ({
      ...r,
      avg_response_ms: roundMs(r.avg_response_ms),
      avg_response_seconds:
        r.avg_response_ms != null ? Math.round(r.avg_response_ms) / 1000 : null,
    })),
    by_operator: byOperator.map((r) => ({
      ...r,
      avg_response_ms: roundMs(r.avg_response_ms),
      avg_response_seconds:
        r.avg_response_ms != null ? Math.round(r.avg_response_ms) / 1000 : null,
    })),
  });
});

// Phase 2: WhatsApp Cloud API webhooks
app.use('/api/whatsapp', createWhatsAppRouter(db));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'RespuestaTrack API - Detección de Bots',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      operators: '/api/operators',
      orders: '/api/orders',
      metrics: '/api/metrics',
      imports: '/api/imports',
    },
  });
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
