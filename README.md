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

## WhatsApp API (fase 2)

```
WA_VERIFY_TOKEN=domicilios-verify
WA_PHONE_NUMBER_ID=...
PORT=3001
```

## Stack

- Frontend: React + Vite
- Backend: Express + SQLite (`better-sqlite3`)
