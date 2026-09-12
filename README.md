# RespuestaTrack — Informe WhatsApp (domicilios)

Analiza chats exportados: tiempos de respuesta, calidad/tipo de señal y posibles bots (Termux, menús, sesiones).

## Qué incluye

- Flujo guiado: archivo → contexto → **informe estructurado**
- SLA: promedio, mediana, desviación, distribución por rangos
- Señal: WiFi, datos, hotspot, Termux/bot, VPS, API + barras/entorno + score 0–100
- Automatización: respuestas instantáneas, plantillas, frases de bot/Termux/Baileys
- Historial, CSV y webhook Cloud API (fase 2)

## Arranque

```bash
# Terminal 1 — API
cd server
npm install
npm run dev

# Terminal 2 — UI
cd client
npm install
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:3001

Ejemplos: `server/sample-chat.txt` (humano) y `server/sample-chat-bot.txt` (bot/Termux).

## Flujo principal

1. **Analizar** → sube el `.txt` / `.zip`.
2. Completa contexto: operadores, quien registra, canal de señal, barras, entorno.
3. Informe en 4 secciones: SLA · Señal · Bots/automatización · Detalle.

## WhatsApp Cloud API: medición exacta

El modo histórico `.txt/.zip` no puede recuperar segundos que WhatsApp no exportó. Para tiempos exactos, el mensaje entrante y la respuesta deben pasar por WhatsApp Business Platform. El webhook guarda el timestamp oficial de Meta, deduplica reintentos, valida `X-Hub-Signature-256`, registra estados `sent/delivered/read/failed` y cierra el SLA al recibir `sent`.

La métrica principal es **timestamp del mensaje entrante → timestamp `sent` de la respuesta en Meta**. Esto mide el tiempo de atención hasta que la plataforma registra el envío; no mide cuánto tardó una persona en empezar a escribir.

### Variables de producción

```
WA_VERIFY_TOKEN=domicilios-verify
WA_PHONE_NUMBER_ID=...
WA_ACCESS_TOKEN=...
WA_APP_SECRET=...
WA_GRAPH_VERSION=v23.0
NODE_ENV=production
PORT=3001
```

### Configuración en Meta

1. Crear una aplicación en Meta for Developers con el producto WhatsApp.
2. Conectar la cuenta WhatsApp Business y conservar el `Phone Number ID`.
3. Crear un System User y un token permanente con los permisos de WhatsApp necesarios.
4. Configurar `https://TU_DOMINIO/api/whatsapp/webhook` como Callback URL.
5. Usar el mismo `WA_VERIFY_TOKEN` y suscribir el campo `messages`.
6. Probar primero un mensaje entrante y una respuesta enviada por Cloud API.

El endpoint `POST /api/whatsapp/send` permite enviar texto mediante Cloud API. La respuesta del endpoint confirma que Meta aceptó el envío; el tiempo se considera cerrado únicamente cuando llega el webhook `status=sent`.

### Condición para que sea exacto

Si el operador responde desde una aplicación que no entrega el mensaje saliente a Cloud API/webhook, el sistema no puede conocer el instante real de esa respuesta. En ese caso solo puede medir el momento manual de toma o mostrar un rango histórico. Para una medición impecable, las respuestas que se desean medir deben salir por Cloud API o por una configuración oficial de coexistencia que también emita el evento saliente.

## Stack

- Frontend: React + Vite
- Backend: Express + SQLite (`better-sqlite3`)
