async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const nb = (name) => `/api/notebooks/${encodeURIComponent(name)}`;

export const api = {
  notebooks: () => call('GET', '/api/notebooks'),
  createNotebook: (body) => call('POST', '/api/notebooks', body),
  notebook: (name) => call('GET', nb(name)),
  ask: (name, body) => call('POST', `${nb(name)}/ask`, body),
  cancel: (name) => call('POST', `${nb(name)}/cancel`),
  reset: (name) => call('POST', `${nb(name)}/reset`),
  permission: (name, requestId, optionId) => call('POST', `${nb(name)}/permission`, { requestId, optionId }),
  agents: () => call('GET', '/api/agents'),
  testAgent: (id) => call('POST', `/api/agents/${encodeURIComponent(id)}/test`),
  modes: () => call('GET', '/api/modes'),
  settings: () => call('GET', '/api/settings'),
  saveSettings: (patch) => call('PUT', '/api/settings', patch),
  events: (name) => new EventSource(`${nb(name)}/events`),
};
