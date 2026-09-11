const express = require('express');
const { randomUUID } = require('crypto');

/**
 * Fase 2 — WhatsApp Cloud API (Meta)
 *
 * Configuración esperada (variables de entorno):
 *   WA_VERIFY_TOKEN     — token que defines tú para verificar el webhook
 *   WA_APP_SECRET       — app secret de Meta (opcional, para validar firma)
 *   WA_PHONE_NUMBER_ID  — ID del número Business
 *
 * Flujo:
 *   1. Meta GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *   2. Mensajes entrantes/salientes llegan por POST; se crean pedidos y se mide t_respuesta.
 *   3. La captura de señal sigue en POST /api/orders/:id/take desde la app del operador.
 */
function createWhatsAppRouter(db) {
  const router = express.Router();

  router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = process.env.WA_VERIFY_TOKEN || 'domicilios-verify';

    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  router.post('/webhook', (req, res) => {
    // Responder 200 rápido (requisito Meta)
    res.sendStatus(200);

    try {
      const body = req.body;
      if (body.object !== 'whatsapp_business_account') return;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const contacts = value.contacts || [];
          const contactName =
            contacts[0]?.profile?.name || contacts[0]?.wa_id || 'Cliente';

          for (const msg of value.messages || []) {
            handleInbound(db, msg, contactName, value);
          }

          for (const status of value.statuses || []) {
            // statuses = delivered/read; no abren pedido, solo auditoría
            db.prepare(`
              INSERT INTO wa_events (id, wa_message_id, direction, from_number, to_number, body, timestamp, raw_json)
              VALUES (?, ?, 'status', ?, ?, ?, ?, ?)
            `).run(
              randomUUID(),
              status.id || null,
              status.recipient_id || null,
              null,
              status.status || null,
              status.timestamp
                ? new Date(Number(status.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              JSON.stringify(status)
            );
          }
        }
      }
    } catch (err) {
      console.error('WhatsApp webhook error:', err.message);
    }
  });

  /** Documentación de integración para el panel */
  router.get('/setup', (_req, res) => {
    res.json({
      phase: 2,
      description:
        'Webhook oficial WhatsApp Cloud API para medir tiempos en tiempo casi real.',
      verify_token_env: 'WA_VERIFY_TOKEN',
      endpoints: {
        verify: 'GET /api/whatsapp/webhook',
        receive: 'POST /api/whatsapp/webhook',
      },
      steps: [
        'Crear app en Meta for Developers y producto WhatsApp.',
        'Configurar número Business y Phone Number ID.',
        'Apuntar el Callback URL a https://TU_DOMINIO/api/whatsapp/webhook',
        'Usar el mismo Verify Token que WA_VERIFY_TOKEN.',
        'Suscribir el webhook al campo "messages".',
        'Los mensajes entrantes crean pedidos; la primera respuesta saliente (o "Tomar pedido") cierra el SLA.',
        'El operador registra señal de red con POST /api/orders/:id/take.',
      ],
      note:
        'No se usan clientes no oficiales (Baileys / whatsapp-web.js) para evitar riesgo de ban.',
    });
  });

  return router;
}

function handleInbound(db, msg, contactName, value) {
  const from = msg.from;
  const body =
    msg.text?.body ||
    msg.button?.text ||
    msg.interactive?.button_reply?.title ||
    `[${msg.type || 'media'}]`;
  const ts = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const eventId = randomUUID();
  db.prepare(`
    INSERT INTO wa_events (id, wa_message_id, direction, from_number, to_number, body, timestamp, raw_json)
    VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?)
  `).run(
    eventId,
    msg.id || null,
    from,
    value.metadata?.display_phone_number || null,
    body,
    ts,
    JSON.stringify(msg)
  );

  // Buscar pedido pendiente reciente del mismo cliente (< 2h)
  const pending = db
    .prepare(
      `SELECT * FROM orders
       WHERE source = 'whatsapp_api'
         AND customer_name = ?
         AND status = 'pending'
         AND datetime(order_at) > datetime('now', '-2 hours')
       ORDER BY order_at DESC LIMIT 1`
    )
    .get(contactName);

  if (pending) {
    db.prepare('UPDATE wa_events SET order_id = ? WHERE id = ?').run(
      pending.id,
      eventId
    );
    return;
  }

  const orderId = randomUUID();
  db.prepare(`
    INSERT INTO orders (
      id, source, customer_name, customer_message, order_at, status, chat_title
    ) VALUES (?, 'whatsapp_api', ?, ?, ?, 'pending', ?)
  `).run(
    orderId,
    contactName,
    body.slice(0, 500),
    ts,
    from || 'WhatsApp API'
  );

  db.prepare('UPDATE wa_events SET order_id = ? WHERE id = ?').run(
    orderId,
    eventId
  );
}

/**
 * Llamar cuando la empresa envía un mensaje (si se integra envío vía API)
 * o cuando el operador marca "tomar pedido".
 */
function markWhatsAppResponse(db, orderId, responderName, at = new Date().toISOString()) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || order.status === 'answered') return order;

  const seconds = Math.max(
    0,
    Math.round((new Date(at) - new Date(order.order_at)) / 1000)
  );

  db.prepare(`
    UPDATE orders SET
      responder_name = ?,
      responded_at = ?,
      response_seconds = ?,
      status = 'answered'
    WHERE id = ?
  `).run(responderName || 'Empresa', at, seconds, orderId);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

module.exports = { createWhatsAppRouter, markWhatsAppResponse };
