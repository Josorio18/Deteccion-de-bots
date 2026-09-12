import { useCallback, useEffect, useState } from 'react';
import { csvExportUrl, getMetrics, getOperators, getOrders } from '../api';
import { formatDateTime, formatDuration } from '../network';

export default function Dashboard() {
  const [operators, setOperators] = useState([]);
  const [orders, setOrders] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    operator_id: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ops, ords, mets] = await Promise.all([
        getOperators(),
        getOrders(filters),
        getMetrics(filters),
      ]);
      setOperators(ops);
      setOrders(ords);
      setMetrics(mets);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = metrics?.summary;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Historial</h1>
          <p className="lede">Pedidos guardados, SLA y calidad de red de análisis anteriores.</p>
        </div>
        <a
          className="btn btn-secondary"
          href={csvExportUrl(filters)}
          download
        >
          Exportar CSV
        </a>
      </header>

      <section className="filters">
        <label>
          Desde
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
        <label>
          Operador
          <select
            value={filters.operator_id}
            onChange={(e) =>
              setFilters((f) => ({ ...f, operator_id: e.target.value }))
            }
          >
            <option value="">Todos</option>
            {operators.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={load}>
          Actualizar
        </button>
      </section>

      {error && <p className="alert">{error}</p>}
      {loading && <p className="muted">Cargando…</p>}

      {summary && (
        <section className="stats">
          <div className="stat">
            <span className="stat-label">Pedidos</span>
            <strong className="stat-value">{summary.total_orders || 0}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Respondidos</span>
            <strong className="stat-value">{summary.answered || 0}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Pendientes</span>
            <strong className="stat-value">{summary.pending || 0}</strong>
          </div>
          <div className="stat accent">
            <span className="stat-label">Promedio respuesta</span>
            <strong className="stat-value">
              {formatDuration(summary.avg_response_seconds, 's')}
            </strong>
          </div>
          <div className="stat">
            <span className="stat-label">Máximo</span>
            <strong className="stat-value">
              {formatDuration(summary.max_response_seconds, 's')}
            </strong>
          </div>
        </section>
      )}

      <div className="split">
        <section className="panel">
          <h2>Por red</h2>
          <ul className="simple-list">
            {(metrics?.by_network || []).map((row) => (
              <li key={row.network}>
                <span>{row.network}</span>
                <span>
                  {row.count} · avg {formatDuration(row.avg_response_seconds, 's')}
                </span>
              </li>
            ))}
            {!metrics?.by_network?.length && (
              <li className="muted">Sin datos de red aún</li>
            )}
          </ul>
        </section>
        <section className="panel">
          <h2>Por operador</h2>
          <ul className="simple-list">
            {(metrics?.by_operator || []).map((row) => (
              <li key={row.operator}>
                <span>{row.operator}</span>
                <span>
                  {row.count} · avg {formatDuration(row.avg_response_seconds, 's')}
                </span>
              </li>
            ))}
            {!metrics?.by_operator?.length && (
              <li className="muted">Sin operadores aún</li>
            )}
          </ul>
        </section>
      </div>

      <section className="panel table-panel">
        <h2>Detallado de Pedidos Guardados</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora Pedido</th>
                <th>Remitente (Mandó pedido)</th>
                <th>Mensaje</th>
                <th>Atendedor (Tomó pedido)</th>
                <th>Hora Toma</th>
                <th>Tiempo en tomar pedido</th>
                <th>Red / Canal</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{formatDateTime(o.order_at)}</td>
                  <td>
                    <strong>{o.customer_name}</strong>
                  </td>
                  <td className="truncate">{o.customer_message}</td>
                  <td>
                    <strong>{o.operator_name || o.responder_name || '—'}</strong>
                  </td>
                  <td>{o.responded_at ? formatDateTime(o.responded_at) : '—'}</td>
                  <td>
                    <strong>
                      {formatDuration(
                        o.response_ms ??
                          (o.response_seconds != null
                            ? o.response_seconds * 1000
                            : null)
                          )}
                    </strong>
                    {o.observed_response_ms != null && (
                      <small className="muted">
                        <br />API observado: {formatDuration(o.observed_response_ms)}
                      </small>
                    )}
                  </td>
                  <td>
                    {o.effective_type || o.network_type || '—'}
                    {o.downlink != null ? ` · ${o.downlink} Mbps` : ''}
                    {o.rtt != null ? ` · ${o.rtt} ms` : ''}
                  </td>
                  <td>
                    <span className={`badge badge-${o.status}`}>{o.status}</span>
                  </td>
                </tr>
              ))}
              {!orders.length && !loading && (
                <tr>
                  <td colSpan={8} className="muted">
                    No hay pedidos. Importa un chat o registra uno manualmente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
