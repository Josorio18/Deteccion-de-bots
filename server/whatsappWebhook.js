const express = require('express');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

function verifySignature(req) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = req.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=') || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const actual = header.slice(7);
  return actual.length === expected.length && crypto.timingSafeEqual(
    Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8')
  );
}

function metaTimestamp(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

function messageBody(msg) {
  return msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || `[${msg.type || 'media'}]`;
}

function createWhatsAppRouter(db) {
  const router = express.Router();

  router.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === (process.env.WA_VERIFY_TOKEN || 'domicilios-verify')) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
  });

  router.post('/webhook', (req, res) => {
    if (!verifySignature(req)) return res.sendStatus(403);
    // Meta exige una respuesta rápida; el procesamiento queda después del ACK.
    res.sendStatus(200);
    try {
      const body = req.body;
      if (body.object !== 'whatsapp_business_account') return;
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          for (const msg of value.messages || []) handleInbound(db, msg, value);
          for (const status of value.statuses || []) handleStatus(db, status, value);
        }
      }
    } catch (err) {
      console.error('WhatsApp webhook processing error:', err.message);
    }
  });

  router.post('/send', async (req, res) => {
    const token = process.env.WA_ACCESS_TOKEN;
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const to = String(req.body?.to || '').replace(/[^0-9]/g, '');
    const text = String(req.body?.text || '').trim();
    if (!token || !phoneNumberId) return res.status(503).json({ error: 'Falta configurar WA_ACCESS_TOKEN y WA_PHONE_NUMBER_ID' });
    if (!to || !text) return res.status(400).json({ error: 'to y text son obligatorios' });
    try {
      const version = process.env.WA_GRAPH_VERSION || 'v23.0';
      const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } }),
      });
      const payload = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: 'Meta rechazó el envío', details: payload });
      res.status(201).json({ ...payload, note: 'El tiempo oficial de respuesta se cierra cuando llegue el webhook status=sent.' });
    } catch (err) {
      res.status(502).json({ error: 'No se pudo contactar a Meta', details: err.message });
    }
  });

  router.get('/setup', (_req, res) => res.json({
    phase: 2,
    description: 'WhatsApp Cloud API con timestamps oficiales de Meta, deduplicación y auditoría de estados.',
    verify_token_env: 'WA_VERIFY_TOKEN',
    required_env: ['WA_VERIFY_TOKEN', 'WA_APP_SECRET', 'WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN'],
    endpoints: { verify: 'GET /api/whatsapp/webhook', receive: 'POST /api/whatsapp/webhook' },
    steps: [
      'Crear la app de Meta con el producto WhatsApp y conectar la cuenta Business.',
      'Configurar un token permanente de System User y el App Secret.',
      'Apuntar el Callback URL a https://TU_DOMINIO/api/whatsapp/webhook.',
      'Usar el mismo WA_VERIFY_TOKEN y suscribir el campo messages.',
      'Probar un mensaje entrante y uno enviado por Cloud API antes de producción.',
      'Conservar el Phone Number ID y activar logs/alertas del webhook.',
    ],
    note: 'Los tiempos exactos requieren que el mensaje entrante y la respuesta saliente pasen por la plataforma/API. Un TXT exportado no puede recuperar esos segundos.',
  }));
  return router;
}

function handleInbound(db, msg, value) {
  if (!msg.id) return;
  const webhookReceivedAt = new Date().toISOString();
  const webhookReceivedAtMs = Date.now();
  const exists = db.prepare('SELECT id FROM wa_events WHERE wa_message_id = ? AND direction = ?').get(msg.id, 'inbound');
  if (exists) return;
  const from = msg.from || null;
  const contact = (value.contacts || []).find((c) => c.wa_id === from) || value.contacts?.[0];
  const name = contact?.profile?.name || from || 'Cliente';
  const body = messageBody(msg);
  const timestamp = metaTimestamp(msg.timestamp);
  const eventId = randomUUID();
  db.prepare(`INSERT INTO wa_events (id, wa_message_id, direction, from_number, to_number, body, timestamp, order_id, raw_json)
    VALUES (?, ?, 'inbound', ?, ?, ?, ?, NULL, ?)`).run(
    eventId, msg.id, from, value.metadata?.display_phone_number || null, body, timestamp, JSON.stringify(msg)
  );

  let pending = db.prepare(`SELECT * FROM orders WHERE source = 'whatsapp_api' AND customer_phone = ? AND status = 'pending' ORDER BY order_at DESC LIMIT 1`).get(from);
  if (!pending) {
    const orderId = randomUUID();
    db.prepare(`INSERT INTO orders (id, source, customer_name, customer_phone, customer_message, order_at, status, chat_title, inbound_wa_message_id, timing_precision, webhook_received_at, webhook_received_at_ms)
      VALUES (?, 'whatsapp_api', ?, ?, ?, ?, 'pending', ?, ?, 's', ?, ?)`).run(
      orderId, name, from, body.slice(0, 500), timestamp, from || 'WhatsApp API', msg.id, webhookReceivedAt, webhookReceivedAtMs
    );
    pending = { id: orderId };
  }
  db.prepare('UPDATE wa_events SET order_id = ? WHERE id = ?').run(pending.id, eventId);
}

function handleStatus(db, status, value) {
  if (!status.id || !status.status) return;
  const ackAt = new Date().toISOString();
  const ackAtMs = Date.now();
  const timestamp = metaTimestamp(status.timestamp);
  const existing = db.prepare('SELECT id, raw_json FROM wa_events WHERE wa_message_id = ? AND direction = ?').get(status.id, 'status');
  if (!existing) {
    db.prepare(`INSERT INTO wa_events (id, wa_message_id, direction, from_number, to_number, body, timestamp, raw_json)
      VALUES (?, ?, 'status', ?, ?, ?, ?, ?)`).run(
      randomUUID(), status.id, value.metadata?.display_phone_number || null, status.recipient_id || null,
      status.status, timestamp, JSON.stringify(status)
    );
  } else {
    db.prepare('UPDATE wa_events SET timestamp = ?, body = ?, raw_json = ? WHERE id = ?').run(timestamp, status.status, JSON.stringify(status), existing.id);
  }

  // El estado sent es el momento oficial en que Meta registra el envío de la respuesta.
  if (status.status !== 'sent') return;
  const order = db.prepare(`SELECT * FROM orders WHERE source = 'whatsapp_api' AND customer_phone = ? AND status = 'pending' ORDER BY order_at DESC LIMIT 1`).get(status.recipient_id || '');
  if (!order) return;
  const responseMs = Math.max(0, new Date(timestamp).getTime() - new Date(order.order_at).getTime());
  const observedResponseMs = order.webhook_received_at_ms != null
    ? Math.max(0, ackAtMs - order.webhook_received_at_ms)
    : null;
  db.prepare(`UPDATE orders SET responder_name = COALESCE(responder_name, 'Empresa/API'), responded_at = COALESCE(responded_at, ?), response_seconds = COALESCE(response_seconds, ?), response_ms = COALESCE(response_ms, ?), response_message = COALESCE(response_message, '[mensaje enviado por API]'), response_wa_message_id = COALESCE(response_wa_message_id, ?), response_ack_at = COALESCE(response_ack_at, ?), response_ack_at_ms = COALESCE(response_ack_at_ms, ?), observed_response_ms = COALESCE(observed_response_ms, ?), timing_precision = 's', status = 'answered' WHERE id = ?`).run(
    timestamp, responseMs / 1000, responseMs, status.id, ackAt, ackAtMs, observedResponseMs, order.id
  );
  db.prepare('UPDATE wa_events SET order_id = ? WHERE wa_message_id = ? AND direction = ?').run(order.id, status.id, 'status');
}

function markWhatsAppResponse(db, orderId, responderName, at = new Date().toISOString()) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status === 'answered') return order;
  const responseMs = Math.max(0, new Date(at).getTime() - new Date(order.order_at).getTime());
  db.prepare(`UPDATE orders SET responder_name = ?, responded_at = ?, response_seconds = ?, response_ms = ?, timing_precision = 'ms', status = 'answered' WHERE id = ?`).run(responderName || 'Empresa', at, responseMs / 1000, responseMs, orderId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

module.exports = {
  createWhatsAppRouter,
  markWhatsAppResponse,
  verifySignature,
  handleInboundForTest: handleInbound,
  handleStatusForTest: handleStatus,
};
