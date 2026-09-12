import { useEffect, useMemo, useState } from 'react';
import { previewChat, uploadChatWithMeta, csvExportUrl } from '../api';
import {
  SIGNAL_CHANNELS,
  SIGNAL_ENVIRONMENTS,
  automationClass,
  bandClass,
  captureNetworkSignal,
  formatDateTime,
  formatDuration,
} from '../network';

const STEPS = ['Archivo', 'Contexto', 'Informe'];

const BUCKET_LABELS = {
  ultra_0_250ms: '0–250 ms',
  botish_251_500ms: '251–500 ms',
  subsecond_501_1000ms: '501–1000 ms',
  instant_1001_3000ms: '1.001–3 s',
  very_fast_3001_8000ms: '3.001–8 s',
  fast_8001_15000ms: '8.001–15 s',
  normal_15_60s: '15–60 s',
  ok_1_3m: '1–3 min',
  slow_3_10m: '3–10 min',
  very_slow_10m_plus: '>10 min',
};

const INTERACTION_LABELS = {
  toma_de_pedido: 'Tomó el pedido',
  confirmacion_reaccion: 'Confirmación / reacción',
  pregunta_del_operador: 'Pregunta del operador',
  respuesta_al_pedido: 'Respuesta al pedido',
  reaccion: 'Reacción',
};

export default function Analyze() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedOps, setSelectedOps] = useState([]);
  const [registrarName, setRegistrarName] = useState(
    () => localStorage.getItem('rt_registrar') || ''
  );
  const [signal, setSignal] = useState(() => captureNetworkSignal());
  const [signalChannel, setSignalChannel] = useState('auto');
  const [signalBars, setSignalBars] = useState('');
  const [signalEnvironment, setSignalEnvironment] = useState('');
  const [signalNote, setSignalNote] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setSignal(captureNetworkSignal()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (registrarName) localStorage.setItem('rt_registrar', registrarName);
  }, [registrarName]);

  const channels = preview?.signal_channels || SIGNAL_CHANNELS;

  const canConfirm = useMemo(() => {
    const hasNet = Boolean(signal.effective_type || signal.network_type);
    const hasChannel = signalChannel && signalChannel !== 'auto';
    return (
      selectedOps.length > 0 &&
      registrarName.trim().length > 1 &&
      (hasNet || hasChannel)
    );
  }, [selectedOps, registrarName, signal, signalChannel]);

  async function handleFile(selected) {
    if (!selected) return;
    setFile(selected);
    setError('');
    setBusy(true);
    setResult(null);
    try {
      const data = await previewChat(selected);
      setPreview(data);
      setSelectedOps(data.suggested_operators || []);
      setStep(1);
    } catch (e) {
      setError(e.message);
      setPreview(null);
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  function toggleOp(name) {
    setSelectedOps((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  async function onConfirm(e) {
    e.preventDefault();
    if (!file) return;
    if (!selectedOps.length) {
      setError('Marca al menos un operador (quien responde pedidos).');
      return;
    }
    if (!registrarName.trim()) {
      setError('Escribe tu nombre para registrar la señal.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const net = captureNetworkSignal();
      setSignal(net);
      const data = await uploadChatWithMeta(file, {
        operatorNames: selectedOps,
        registrarName: registrarName.trim(),
        signal: net,
        signal_quality: signalNote || net.quality_label,
        signal_channel: signalChannel,
        signal_bars: signalBars,
        signal_environment: signalEnvironment,
      });
      setResult(data);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(0);
    setFile(null);
    setPreview(null);
    setSelectedOps([]);
    setResult(null);
    setError('');
    setSignalNote('');
    setSignalChannel('auto');
    setSignalBars('');
    setSignalEnvironment('');
    setSignal(captureNetworkSignal());
  }

  const stats = result?.stats;
  const sig = result?.signal;
  const auto = result?.automation;
  const buckets = stats?.buckets_ms || stats?.buckets || {};

  return (
    <div className="page analyze">
      <header className="page-header">
        <div>
          <h1>Informe de atención WhatsApp</h1>
          <p className="lede">
            Sube el chat. Pedimos operadores, canal/señal y generamos un informe
            estructurado: SLA, calidad de red y posibles bots (Termux, menús,
            sesiones).
          </p>
        </div>
      </header>

      <ol className="wizard-steps" aria-label="Progreso">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={i === step ? 'active' : i < step ? 'done' : ''}
          >
            <span className="wizard-num">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && <p className="alert">{error}</p>}

      {step === 0 && (
        <section
          className={`dropzone ${dragOver ? 'over' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
        >
          <p className="drop-title">Arrastra aquí el chat exportado</p>
          <p className="muted">
            Archivo <code>.txt</code> o <code>.zip</code> · Sin multimedia
          </p>
          <label className="btn file-btn">
            {busy ? 'Leyendo…' : 'Elegir archivo'}
            <input
              type="file"
              accept=".txt,.zip,text/plain,application/zip"
              hidden
              disabled={busy}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <details className="howto">
            <summary>¿Cómo exporto el chat?</summary>
            <ol>
              <li>Abre el chat o grupo en WhatsApp.</li>
              <li>Menú (⋮) → Más → Exportar chat.</li>
              <li>
                Elige <strong>Sin archivos</strong>.
              </li>
              <li>Guarda el archivo y súbelo aquí.</li>
            </ol>
          </details>
        </section>
      )}

      {step === 1 && preview && (
        <form className="wizard-form" onSubmit={onConfirm}>
          <section className="panel">
            <div className="section-kicker">Paso 2 · Contexto obligatorio</div>
            <h2>{preview.chat_title}</h2>
            <p className="muted">
              {preview.message_count} mensajes · <code>{preview.filename}</code>
            </p>

            <div className="ask-box">
              <h3>A. Operadores del chat</h3>
              <p>{preview.needs.operators}</p>
              <ul className="author-pick">
                {(preview.authors || []).map((a) => (
                  <li key={a.name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedOps.includes(a.name)}
                        onChange={() => toggleOp(a.name)}
                      />
                      <span>
                        <strong>{a.name}</strong>
                        <em>{a.count} mensajes</em>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ask-box">
              <h3>B. Quién registra este análisis</h3>
              <p>{preview.needs.registrar}</p>
              <label>
                Tu nombre
                <input
                  required
                  value={registrarName}
                  onChange={(e) => setRegistrarName(e.target.value)}
                  placeholder="Ej. Ana"
                />
              </label>
            </div>

            <div className="ask-box">
              <h3>C. Canal y tipo de señal</h3>
              <p>{preview.needs.signal}</p>
              <div className="field-grid">
                <label>
                  Canal de atención
                  <select
                    value={signalChannel}
                    onChange={(e) => setSignalChannel(e.target.value)}
                  >
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Barras percibidas (1–5)
                  <select
                    value={signalBars}
                    onChange={(e) => setSignalBars(e.target.value)}
                  >
                    <option value="">No sé / N/A</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} barra{n > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Entorno
                  <select
                    value={signalEnvironment}
                    onChange={(e) => setSignalEnvironment(e.target.value)}
                  >
                    {SIGNAL_ENVIRONMENTS.map((e) => (
                      <option key={e.id || 'none'} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="signal-banner compact">
                <div>
                  <p className="signal-label">Medición del navegador ahora</p>
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
                    <dd>
                      {signal.downlink != null ? `${signal.downlink} Mbps` : '—'}
                    </dd>
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
                  Volver a medir
                </button>
              </div>

              <label>
                Nota libre (opcional)
                <input
                  value={signalNote}
                  onChange={(e) => setSignalNote(e.target.value)}
                  placeholder="Ej. Termux en moto, WiFi cocina caído, API Meta…"
                />
              </label>
              <p className="hint">{preview.needs.automation}</p>
            </div>
          </section>

          <div className="wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Otro archivo
            </button>
            <button type="submit" className="btn" disabled={busy || !canConfirm}>
              {busy ? 'Generando informe…' : 'Generar informe estructurado'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && result && (
        <div className="results report">
          <section className="panel">
            <div className="results-head">
              <div>
                <div className="section-kicker">Informe</div>
                <h2>{result.chat_title}</h2>
                <p className="muted">
                  {result.order_count} pedidos detectados · {result.message_count} mensajes analizados ·
                  operadores: {(result.operators || []).join(', ')}
                </p>
              </div>
              <div className="wizard-actions">
                <a className="btn btn-secondary" href={csvExportUrl()} download>
                  CSV
                </a>
                <button type="button" className="btn" onClick={reset}>
                  Nuevo análisis
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="section-kicker">1 · Tiempos de respuesta (SLA)</div>
            <h2>Resumen de velocidad</h2>
            <div className="stats">
              <div className="stat accent">
                <span className="stat-label">Promedio</span>
                <strong className="stat-value">
                  {formatDuration(stats?.avg_response_seconds, 's')}
                </strong>
              </div>
              <div className="stat">
                <span className="stat-label">Mediana</span>
                <strong className="stat-value">
                  {formatDuration(stats?.median_response_seconds, 's')}
                </strong>
              </div>
              <div className="stat">
                <span className="stat-label">Mín / Máx</span>
                <strong className="stat-value">
                  {formatDuration(stats?.min_response_seconds, 's')} /{' '}
                  {formatDuration(stats?.max_response_seconds, 's')}
                </strong>
              </div>
              <div className="stat">
                <span className="stat-label">Desv. estándar</span>
                <strong className="stat-value">
                  {stats?.stddev_response_seconds != null
                    ? `${stats.stddev_response_seconds}s`
                    : '—'}
                </strong>
              </div>
              <div className="stat">
                <span className="stat-label">≤15 s / ≤1 min / ≤3 min</span>
                <strong className="stat-value">
                  {stats?.pct_under_15s ?? 0}% / {stats?.pct_under_60s ?? 0}% /{' '}
                  {stats?.pct_under_180s ?? 0}%
                </strong>
              </div>
            </div>

            <h3 className="subhead">Distribución</h3>
            <ul className="bucket-bars">
              {Object.entries(BUCKET_LABELS).map(([key, label]) => {
                const count = buckets[key] || 0;
                const total = stats?.total_orders || 1;
                const pct = Math.round((count / total) * 100);
                return (
                  <li key={key}>
                    <span className="bucket-label">{label}</span>
                    <div className="bucket-track">
                      <div
                        className="bucket-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="bucket-count">
                      {count} ({pct}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <div className="section-kicker">2 · Señal y canal</div>
            <h2>
              Calidad:{' '}
              <span className={`pill ${bandClass(sig?.band)}`}>
                {sig?.band_label || '—'} ({sig?.score ?? '—'} / 100)
              </span>
            </h2>
            <p className="muted">{sig?.risk_for_orders}</p>
            <dl className="signal-report">
              <div>
                <dt>Canal</dt>
                <dd>{sig?.signal_channel_label || sig?.signal_channel}</dd>
              </div>
              <div>
                <dt>Red efectiva</dt>
                <dd>
                  {sig?.network_type} / {sig?.effective_type}
                </dd>
              </div>
              <div>
                <dt>Downlink</dt>
                <dd>
                  {sig?.downlink != null ? `${sig.downlink} Mbps` : '—'}
                </dd>
              </div>
              <div>
                <dt>RTT</dt>
                <dd>{sig?.rtt != null ? `${sig.rtt} ms` : '—'}</dd>
              </div>
              <div>
                <dt>Barras</dt>
                <dd>
                  {sig?.signal_bars != null ? `${sig.signal_bars}/5` : '—'}
                </dd>
              </div>
              <div>
                <dt>Entorno</dt>
                <dd>{sig?.signal_environment || '—'}</dd>
              </div>
              <div>
                <dt>Registró</dt>
                <dd>{sig?.registrar}</dd>
              </div>
              <div>
                <dt>Momento</dt>
                <dd>{formatDateTime(sig?.signal_captured_at)}</dd>
              </div>
            </dl>
            {!!sig?.factors?.length && (
              <>
                <h3 className="subhead">Factores de la puntuación</h3>
                <ul className="factor-list">
                  {sig.factors.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="panel">
            <div className="section-kicker">3 · Automatización / bots</div>
            <h2>
              <span className={`pill ${automationClass(auto?.level)}`}>
                {auto?.level_label || 'Sin datos'}
              </span>
              <span className="score-inline">
                {' '}
                · score {auto?.score ?? 0}/100
              </span>
            </h2>
            <p className="muted">{auto?.disclaimer}</p>

            <div className="mini-metrics">
              <div>
                <span>Msgs operadores</span>
                <strong>{auto?.metrics?.operator_messages ?? 0}</strong>
              </div>
              <div>
                <span>≤3 s</span>
                <strong>{auto?.metrics?.instant_replies ?? 0}</strong>
              </div>
              <div>
                <span>≤8 s</span>
                <strong>{auto?.metrics?.very_fast_replies ?? 0}</strong>
              </div>
              <div>
                <span>Plantillas</span>
                <strong>{auto?.metrics?.repeated_template_count ?? 0}</strong>
              </div>
              <div>
                <span>Frases bot</span>
                <strong>{auto?.metrics?.bot_phrase_hits ?? 0}</strong>
              </div>
            </div>

            <ul className="findings">
              {(auto?.findings || []).map((f) => (
                <li key={f.code} className={`finding sev-${f.severity}`}>
                  <strong>{f.title}</strong>
                  <p>{f.detail}</p>
                  {f.samples?.length > 0 && (
                    <ul className="samples">
                      {f.samples.map((s, i) => (
                        <li key={i}>
                          <em>{s.author}:</em> {s.excerpt}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {!auto?.findings?.length && (
                <li className="muted">
                  No se detectaron patrones fuertes de bot/Termux en este export.
                </li>
              )}
            </ul>
          </section>

          <section className="panel table-panel">
            <div className="section-kicker">4 · Pedidos detectados</div>
            <h2>Detalle de pedidos (vista derivada del chat)</h2>
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
                    <th>Canal / Señal</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.orders || []).map((o) => (
                    <tr key={o.id || `${o.customer_name}-${o.order_at}`}>
                      <td>{formatDateTime(o.order_at)}</td>
                      <td>
                        <strong>{o.customer_name}</strong>
                      </td>
                      <td className="truncate">{o.customer_message}</td>
                      <td>
                        <strong>{o.responder_name || o.operator_name || '—'}</strong>
                      </td>
                      <td>{o.responded_at ? formatDateTime(o.responded_at) : '—'}</td>
                      <td>
                        <strong
                          className={
                            o.response_seconds != null && o.response_seconds <= 3
                              ? 'text-warn'
                              : ''
                          }
                        >
                          {o.timing_precision === 'minute' && o.response_ms != null
                            ? `${formatDuration(o.response_min_ms)} – ${formatDuration(o.response_max_ms)}`
                            : formatDuration(
                                o.response_ms ??
                                  (o.response_seconds != null
                                    ? o.response_seconds * 1000
                                    : null)
                              )}
                        </strong>
                        {o.timing_precision && (
                          <small className="muted">
                            {o.timing_precision === 'ms'
                              ? 'Exactitud: milisegundos'
                              : o.timing_precision === 'minute'
                                ? 'Rango estimado: precisión de minuto'
                                : 'Exactitud: segundos'}
                          </small>
                        )}
                      </td>
                      <td>
                        {sig?.signal_channel_label ||
                          o.effective_type ||
                          '—'}
                        {o.downlink != null ? ` · ${o.downlink} Mbps` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.orders?.length && (
              <p className="muted">
                No se detectaron pedidos con los criterios actuales. El chat completo
                aparece en la transcripción de abajo y no se descartó ningún mensaje.
              </p>
            )}
          </section>

          <section className="panel table-panel">
            <div className="section-kicker">5 · Transcripción completa</div>
            <h2>Todos los mensajes del chat</h2>
            <p className="muted">
              Se muestran todos los mensajes detectados, incluidos mensajes cortos,
              adjuntos y mensajes de sistema excluidos de los cálculos de respuesta.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Hora</th>
                    <th>Remitente</th>
                    <th>Mensaje / adjunto</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.messages || []).map((message) => (
                    <tr key={message.id}>
                      <td>{message.id}</td>
                      <td>{formatDateTime(message.timestamp)}</td>
                      <td><strong>{message.author}</strong></td>
                      <td className="message-cell">{message.body || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel table-panel">
            <div className="section-kicker">6 · Reacciones y toma del pedido</div>
            <h2>Línea de tiempo detallada de cada interacción</h2>
            <p className="muted">
              Cada fila relaciona un mensaje de otra persona con la primera respuesta
              posterior del operador seleccionado. Por ejemplo, “Bueno señor” se
              clasifica como confirmación o reacción; no se inventa una cita de WhatsApp.
              El tiempo se calcula con los datos que realmente trae la exportación.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th># / tipo</th>
                    <th>Mensaje recibido (hora exacta)</th>
                    <th>Respuesta del operador (hora exacta)</th>
                    <th>Tiempo de respuesta</th>
                    <th>Detalle de intervalos</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.interactions || []).map((interaction) => (
                    <tr key={interaction.id}>
                      <td>
                        <strong>#{interaction.id}</strong><br />
                        {INTERACTION_LABELS[interaction.category] || interaction.category}
                      </td>
                      <td>
                        <strong>{interaction.incoming.author}</strong><br />
                        <small>{formatDateTime(interaction.incoming.timestamp)}</small><br />
                        <span className="message-cell">{interaction.incoming.body || '—'}</span>
                      </td>
                      <td>
                        <strong>{interaction.response.author}</strong><br />
                        <small>{formatDateTime(interaction.response.timestamp)}</small><br />
                        <span className="message-cell">{interaction.response.body || '—'}</span>
                      </td>
                      <td>
                        <strong>
                          {interaction.timing_precision === 'minute'
                            ? `${formatDuration(interaction.response_min_ms)} – ${formatDuration(interaction.response_max_ms)}`
                            : formatDuration(interaction.response_ms)}
                        </strong><br />
                        <small>
                          {interaction.timing_precision === 'minute'
                            ? 'Rango posible: WhatsApp solo exportó minutos'
                            : interaction.timing_precision === 'ms'
                              ? 'Precisión: milisegundos'
                              : 'Precisión: segundos (±1 s)'}
                        </small>
                      </td>
                      <td>
                        <small>
                          Desde mensaje anterior: {formatDuration(interaction.since_previous_ms)}<br />
                          Acumulado desde inicio: {formatDuration(interaction.elapsed_from_start_ms)}<br />
                          {interaction.same_minute
                            ? 'Mismo minuto exportado; no se puede saber el orden dentro del minuto.'
                            : 'Minutos distintos en la exportación.'}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.interactions?.length && (
              <p className="muted">No hay interacciones para los operadores seleccionados.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
