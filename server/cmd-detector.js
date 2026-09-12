#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const JSZip = require('jszip');
const { parseChatText, detectOrders, detectInteractions } = require('./parser');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

function color(code, value) {
  return process.env.NO_COLOR ? value : `${code}${value}${RESET}`;
}
function line(char = '─', size = 78) {
  return char.repeat(size);
}
function fmtMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const value = Math.max(0, Math.round(Number(ms)));
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000);
  const millis = value % 1000;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s ${String(millis).padStart(3, '0')} ms (${value.toLocaleString('en-US')} ms)`;
}
function fmtSeconds(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  return `${(Number(ms) / 1000).toFixed(6)} s`;
}
function precisionLabel(precision) {
  if (precision === 'ms') return 'exactitud de milisegundos';
  if (precision === 'minute') return 'rango: precisión de minuto';
  return 'exactitud de segundos (±1 s)';
}
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}
function printOrder(order, index) {
  const answered = order.response_ms != null;
  console.log(color(CYAN, `\n${line('═')}\nPEDIDO #${index + 1}\n${line('═')}`));
  console.log(`Cliente:       ${order.customer_name}`);
  console.log(`Pedido:        ${order.customer_message || '—'}`);
  console.log(`Hora pedido:   ${order.order_at}`);
  console.log(`Timestamp ini: ${order.order_at_ms ?? 'sin timestamp'} ms`);
  console.log(`Atendido por:  ${order.responder_name || 'SIN RESPUESTA'}`);
  console.log(`Hora respuesta:${order.responded_at ? ` ${order.responded_at}` : ' —'}`);
  if (!answered) {
    console.log(color(YELLOW, 'Estado:        PENDIENTE — todavía no existe una respuesta del operador'));
    return;
  }
  console.log(`Timestamp fin:  ${order.responded_at_ms} ms`);
  console.log(`Resta exacta:   ${order.responded_at_ms} - ${order.order_at_ms} = ${order.response_ms} ms`);
  const nominal = `${fmtMs(order.response_ms)} = ${fmtSeconds(order.response_ms)}`;
  if (order.timing_precision === 'minute' && order.response_min_ms != null) {
    console.log(`Tiempo real:   ${fmtSeconds(order.response_min_ms)} a ${fmtSeconds(order.response_max_ms)}`);
    console.log(`                (${fmtMs(order.response_min_ms)} a ${fmtMs(order.response_max_ms)})`);
    console.log(`                Tiempo nominal: ${nominal}`);
  } else {
    console.log(`Tiempo toma:   ${nominal}`);
  }
  console.log(`Precisión:     ${precisionLabel(order.timing_precision)}`);
  console.log(`Respuesta:     ${order.response_message || '—'}`);
  console.log(color(GREEN, 'Estado:        RESPONDIDO'));
}
function printInteraction(interaction, index) {
  const response = interaction.timing_precision === 'minute'
    ? `${fmtMs(interaction.response_min_ms)} a ${fmtMs(interaction.response_max_ms)} (nominal ${fmtMs(interaction.response_ms)})`
    : fmtMs(interaction.response_ms);
  console.log(`\nInteracción #${index + 1} — ${interaction.category}`);
  console.log(`  Recibido:    ${interaction.incoming_message.author} | ${interaction.incoming_message.timestamp}`);
  console.log(`  Mensaje:     ${interaction.incoming_message.body || '—'}`);
  console.log(`  Respondido:  ${interaction.response_message.author} | ${interaction.response_message.timestamp}`);
  console.log(`  Respuesta:   ${interaction.response_message.body || '—'}`);
  console.log(`  Diferencia:  ${response}`);
  console.log(`  Precisión:   ${precisionLabel(interaction.timing_precision)}`);
  console.log(`  Desde previo:${fmtMs(interaction.since_previous_ms)}`);
  console.log(`  Acumulado:   ${fmtMs(interaction.elapsed_from_start_ms)}`);
}
async function main() {
  const file = process.argv[2] || await prompt('Ruta del chat exportado (.txt o .zip): ');
  if (!file) throw new Error('Debes indicar un archivo .txt o .zip de WhatsApp.');
  const filePath = path.resolve(file.replace(/^"|"$/g, ''));
  if (!fs.existsSync(filePath)) throw new Error(`No existe el archivo: ${filePath}`);
  let text;
  if (filePath.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const entry = Object.values(zip.files).find((item) => item.name.toLowerCase().endsWith('.txt') && !item.dir);
    if (!entry) throw new Error('El ZIP no contiene un archivo .txt de chat.');
    text = await entry.async('string');
  } else {
    text = fs.readFileSync(filePath, 'utf8');
  }
  const operatorArg = process.argv.slice(3).join(' ') || await prompt('Nombre(s) del operador, separados por coma (Enter = detectar): ');
  const operatorNames = operatorArg.split(',').map((name) => name.trim()).filter(Boolean);
  const messages = parseChatText(text);
  const detected = detectOrders(messages, operatorNames.length ? { operatorNames } : {});
  const interactions = detectInteractions(messages, operatorNames.length ? { operatorNames } : { operatorNames: detected.operators });

  console.clear();
  console.log(color(BOLD, color(CYAN, 'RESPUESTATrack — DETALLE DE TOMA DE PEDIDOS')));
  console.log(`${DIM}Archivo: ${filePath}${RESET}`);
  console.log(`Mensajes leídos: ${messages.length}`);
  console.log(`Operadores: ${detected.operators.join(', ') || 'no detectados'}`);
  console.log(`Pedidos detectados: ${detected.orders.length}`);
  console.log(`Interacciones calculadas: ${interactions.length}`);
  for (const [index, order] of detected.orders.entries()) printOrder(order, index);
  if (interactions.length) {
    console.log(color(CYAN, `\n${line('═')}\nLÍNEA DE TIEMPO DE INTERACCIONES\n${line('═')}`));
    interactions.forEach(printInteraction);
  }
  console.log(color(CYAN, `\n${line()}\nFórmula: tiempo de respuesta = hora de respuesta − hora del mensaje recibido`));
  console.log(color(DIM, 'Nota: si la exportación no incluye milisegundos, el resultado no puede ser más exacto que la precisión original de WhatsApp.'));
}
main().catch((error) => {
  console.error(color(RED, `\nERROR: ${error.message}`));
  process.exitCode = 1;
});
