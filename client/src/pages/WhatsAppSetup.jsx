import { useEffect, useState } from 'react';
import { getWhatsAppSetup } from '../api';

export default function WhatsAppSetup() {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getWhatsAppSetup()
      .then(setSetup)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>WhatsApp Cloud API</h1>
          <p className="lede">
            Fase 2: medición casi en tiempo real sin clientes no oficiales.
          </p>
        </div>
      </header>

      {error && <p className="alert">{error}</p>}

      {setup && (
        <section className="panel">
          <p>{setup.description}</p>
          <p className="note">{setup.note}</p>

          <h2>Endpoints</h2>
          <ul className="simple-list">
            <li>
              <span>Verificación</span>
              <code>{setup.endpoints.verify}</code>
            </li>
            <li>
              <span>Recepción</span>
              <code>{setup.endpoints.receive}</code>
            </li>
          </ul>

          <h2>Pasos</h2>
          <ol className="steps">
            {setup.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>

          <h2>Variables de entorno</h2>
          <pre className="code-block">{`WA_VERIFY_TOKEN=domicilios-verify
WA_PHONE_NUMBER_ID=tu_phone_number_id
WA_APP_SECRET=opcional
PORT=3001`}</pre>
        </section>
      )}
    </div>
  );
}
