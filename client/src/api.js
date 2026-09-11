const API = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    let message = 'Error de red';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) return res.json();
  return res.text();
}

export function getOperators() {
  return request('/operators');
}

export function createOperator(name) {
  return request('/operators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function getOrders(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  return request(`/orders${qs ? `?${qs}` : ''}`);
}

export function getMetrics(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  return request(`/metrics${qs ? `?${qs}` : ''}`);
}

export function getImports() {
  return request('/imports');
}

export async function previewChat(file) {
  const form = new FormData();
  form.append('file', file);
  return request('/imports/preview', { method: 'POST', body: form });
}

export async function uploadChat(file, operatorNames = []) {
  const form = new FormData();
  form.append('file', file);
  if (operatorNames.length) {
    form.append('operatorNames', JSON.stringify(operatorNames));
  }
  return request('/imports', { method: 'POST', body: form });
}

export async function uploadChatWithMeta(file, meta) {
  const form = new FormData();
  form.append('file', file);
  form.append('operatorNames', JSON.stringify(meta.operatorNames || []));
  form.append('registrarName', meta.registrarName || '');
  const s = meta.signal || {};
  if (s.network_type != null) form.append('network_type', s.network_type);
  if (s.effective_type != null) form.append('effective_type', s.effective_type);
  if (s.downlink != null) form.append('downlink', String(s.downlink));
  if (s.rtt != null) form.append('rtt', String(s.rtt));
  form.append('save_data', s.save_data ? '1' : '0');
  if (s.signal_captured_at) form.append('signal_captured_at', s.signal_captured_at);
  if (meta.signal_quality) form.append('signal_quality', meta.signal_quality);
  if (meta.signal_channel) form.append('signal_channel', meta.signal_channel);
  if (meta.signal_bars != null && meta.signal_bars !== '') {
    form.append('signal_bars', String(meta.signal_bars));
  }
  if (meta.signal_environment) {
    form.append('signal_environment', meta.signal_environment);
  }
  return request('/imports', { method: 'POST', body: form });
}

export function takeOrder(orderId, payload) {
  return request(`/orders/${orderId}/take`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function createManualOrder(payload) {
  return request('/orders/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getWhatsAppSetup() {
  return request('/whatsapp/setup');
}

export function csvExportUrl(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString();
  return `${API}/orders/export.csv${qs ? `?${qs}` : ''}`;
}
