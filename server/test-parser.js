const { parseChatText, detectOrders } = require('./parser');

const sample = `10/09/2026, 9:00:00 a. m. - Juan Cliente: Hola, quiero un combo 2
10/09/2026, 9:01:15 a. m. - Ana Operadora: Claro, ¿dirección?
10/09/2026, 9:02:00 a. m. - Juan Cliente: Calle 5 #10
10/09/2026, 9:02:30 a. m. - Ana Operadora: Listo, 25 min
10/09/2026, 10:15:00 a. m. - María: Buenas, pedido de pizza familiar
10/09/2026, 10:18:00 a. m. - Ana Operadora: ¿Algún adicional?
`;

const messages = parseChatText(sample);
const result = detectOrders(messages);

console.log('Mensajes:', messages.length);
console.log('Operadores inferidos:', result.operators);
console.log('Pedidos:', result.orders.length);
for (const o of result.orders) {
  console.log(
    `- ${o.customer_name} → ${o.responder_name || 'sin respuesta'} (${o.response_seconds}s)`
  );
}

if (result.orders.length < 2) {
  console.error('FAIL: se esperaban al menos 2 pedidos');
  process.exit(1);
}
if (result.orders[0].response_seconds !== 75) {
  console.error('FAIL: primer SLA debería ser 75s, got', result.orders[0].response_seconds);
  process.exit(1);
}
console.log('OK parser');
