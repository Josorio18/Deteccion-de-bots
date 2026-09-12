import { useCallback, useEffect, useState } from 'react';
import {
  createManualOrder,
  createOperator,
  getOperators,
  getOrders,
  takeOrder,
} from '../api';
import {
  captureNetworkSignal,
  formatDateTime,
  formatDuration,
} from '../network';

export default function TakeOrder() {
  const [operators, setOperators] = useState([]);
  const [operatorId, setOperatorId] = useState(
    () => localStorage.getItem('rt_operator_id') || ''
  );
  const [pending, setPending] = useState([]);
  const [signal, setSignal] = useState(() => captureNetworkSignal());
  const [newOpName, setNewOpName] = useState('');
  const [manual, setManual] = useState({
    customer_name: '',
    customer_message: '',
    chat_title: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [ops, orders] = await Promise.all([
      getOperators(),
      getOrders({ status: 'pending' }),
    ]);
    setOperators(ops);
    setPending(orders);
    if (!operatorId && ops[0]) setOperatorId(ops[0].id);
  }, [operatorId]);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const id = setInterval(() => setSignal(captureNetworkSignal()), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (operatorId) localStorage.setItem('rt_operator_id', operatorId);
  }, [operatorId]);

  async function onTake(orderId) {
    if (!operatorId) {
      setError('Selecciona tu nombre de operador');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const net = captureNetworkSignal();
      setSignal(net);
      await takeOrder(orderId, { operator_id: operatorId, ...net });
      setMessage('Pedido tomado y señal registrada');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onManual(e) {
    e.preventDefault();
    if (!operatorId) {
      setError('Selecciona tu nombre de operador');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const net = captureNetworkSignal();
      setSignal(net);
      await createManualOrder({
        ...manual,
        operator_id: operatorId,
        ...net,
      });
      setMessage('Pedido manual registrado con señal de red');
      setManual({ customer_name: '', customer_message: '', chat_title: '' });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onAddOperator(e) {
    e.preventDefault();
    if (!newOpName.trim()) return;
    try {
      const op = await createOperator(newOpName.trim());
      setNewOpName('');
      await refresh();
      setOperatorId(op.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Tomar pedido</h1>
          <p className="lede">
            Al confirmar, se guarda la calidad de tu conexión en ese instante.
          </p>
        </div>
      </header>

      <section className="signal-banner">
        <div>
          <p className="signal-label">Señal actual del dispositivo</p>
          <p className="signal-value">{signal.quality_label}</p>
        </div>
        <dl className="signal-meta">
          <div>
            <dt>Tipo</dt>
            <dd>{signal.network_type}</dd>
          </div>
          <div>
            <dt>Efectiva</dt>
            <dd>{signal.effective_type}</dd>
          </div>
          <div>
            <dt>Downlink</dt>
            <dd>{signal.downlink != null ? `${signal.downlink} Mbps` : '—'}</dd>
          </div>
          <div>
            <dt>RTT</dt>
            <dd>{signal.rtt != null ? `${signal.rtt} ms` : '—'}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setSignal(captureNetworkSignal())}
        >
          Medir ahora
        </button>
      </section>

      <section className="panel">
        <label>
          Operador activo
          <select
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
              </option>
            ))}
          </select>
        </label>
        <form className="inline-form" onSubmit={onAddOperator}>
          <input
            type="text"
            placeholder="Nuevo operador"
            value={newOpName}
            onChange={(e) => setNewOpName(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary">
            Agregar
          </button>
        </form>
      </section>

      {error && <p className="alert">{error}</p>}
      {message && <p className="ok">{message}</p>}

      <section className="panel">
        <h2>Pendientes (sin respuesta / sin señal)</h2>
        <ul className="order-actions">
          {pending.map((o) => (
            <li key={o.id}>
              <div>
                <strong>{o.customer_name}</strong>
                <span className="muted"> · {formatDateTime(o.order_at)}</span>
                <p className="truncate">{o.customer_message}</p>
                {o.response_seconds != null && (
                    <small>SLA chat: {formatDuration(o.response_seconds, 's')}</small>
                )}
              </div>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onTake(o.id)}
              >
                Tomar + señal
              </button>
            </li>
          ))}
          {!pending.length && (
            <li className="muted">No hay pedidos pendientes</li>
          )}
        </ul>
      </section>

      <section className="panel form-panel">
        <h2>Registro manual</h2>
        <p className="muted">
          Úsalo si tomas el pedido en vivo y quieres dejar constancia de la red.
        </p>
        <form className="stack-form" onSubmit={onManual}>
          <label>
            Cliente
            <input
              value={manual.customer_name}
              onChange={(e) =>
                setManual((m) => ({ ...m, customer_name: e.target.value }))
              }
              required
            />
          </label>
          <label>
            Mensaje / pedido
            <textarea
              rows={3}
              value={manual.customer_message}
              onChange={(e) =>
                setManual((m) => ({ ...m, customer_message: e.target.value }))
              }
            />
          </label>
          <label>
            Chat / grupo
            <input
              value={manual.chat_title}
              onChange={(e) =>
                setManual((m) => ({ ...m, chat_title: e.target.value }))
              }
            />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            Registrar con señal actual
          </button>
        </form>
      </section>
    </div>
  );
}
