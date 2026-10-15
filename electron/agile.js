'use strict';
// Read-only connection test for Agile B2B, using credentials encrypted by
// Windows safeStorage (DPAPI). Never persist JWT or customer data locally.
const storage = require('./storage');

const BASE = 'https://api-integracao.agileecommerce.com.br';
const TOKEN_WINDOW_MS = 30 * 60 * 1000;
let session = { token: '', expiresAt: 0 };
let retryAt = 0;
let rateLimitCount = 0;

function safeError(response, action) {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new Error('Agile HTTP ' + status +
      ': credenciais incorretas ou permissao GET ausente.');
  }
  if (status === 404) {
    return new Error('Agile HTTP 404: recurso de pedidos indisponivel.');
  }
  return new Error('Agile HTTP ' + status + ' ao ' + action + '.');
}

function cooldown(response) {
  const raw = response.headers?.get?.('retry-after') || '';
  const value = Number(raw);
  const seconds = Number.isFinite(value) && value > 0
    ? Math.min(300, value)
    : Math.min(120, 15 * Math.pow(2, Math.min(++rateLimitCount - 1, 3)));
  retryAt = Date.now() + seconds * 1000;
  return new Error('Agile respondeu HTTP 429. Aguarde ' +
    Math.ceil(seconds) + ' segundo(s) para tentar novamente.');
}

async function agileRequest(route, options = {}) {
  const wait = Math.ceil((retryAt - Date.now()) / 1000);
  if (wait > 0) {
    throw new Error('Agile em pausa apos HTTP 429. Tente em ' + wait + ' segundo(s).');
  }
  // Prevent callers from supplying arbitrary remote URLs or redirects.
  if (!route.startsWith('/api/') || route.startsWith('//')) {
    throw new Error('Rota Agile nao permitida.');
  }
  let response;
  try {
    response = await fetch(BASE + route, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Agile nao respondeu em 12 segundos.');
    }
    throw new Error('Falha de rede ou certificado HTTPS ao conectar com o Agile.');
  }
  if (response.status === 429) throw cooldown(response);
  rateLimitCount = 0;
  retryAt = 0;
  if (!response.ok) throw safeError(response, 'consultar a API');
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Agile retornou JSON invalido.');
  }
  return payload;
}

async function authenticate(force = false) {
  if (!force && session.token && Date.now() < session.expiresAt) return session.token;
  const credentials = storage.loadAgileCredentials();
  if (!credentials) {
    throw new Error('Preencha Client ID e Client Secret na aba Agile.');
  }
  const result = await agileRequest('/api/usuario/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  const token = result.Token || result.token || result.access_token;
  if (!token || typeof token !== 'string') {
    throw new Error('Agile nao retornou token de acesso. Confira as credenciais.');
  }
  const seconds = Number(result.Expiration);
  const lifetime = Number.isFinite(seconds) && seconds > 0
    ? Math.min(TOKEN_WINDOW_MS, Math.max(30000, (seconds - 120) * 1000))
    : TOKEN_WINDOW_MS;
  session = { token, expiresAt: Date.now() + lifetime };
  return token;
}

function safeTotemOrder(row) {
  if (!row || typeof row !== 'object') return null;
  const code = row.codcli || row.codigo_cliente_erp ||
    row.codcli_erp || row.cliente_codigo_erp;
  if (String(code || '') !== '12678') return null;
  return {
    agile_id: String(row.id_pedido || row.id || ''),
    numero_erp: String(row.pedido_erp || row.id_pedido_erp || ''),
    status: String(row.status || row.status_operacional || ''),
    valor: row.valor_total == null ? null : Number(row.valor_total)
  };
}

async function testConnection() {
  let token = await authenticate();
  let result;
  const route = '/api/integracao/pedidos?page=1&limit=10';
  try {
    result = await agileRequest(route, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (error) {
    if (!/HTTP 401/.test(error.message)) throw error;
    token = await authenticate(true);
    result = await agileRequest(route, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
  }
  if (!Array.isArray(result.data)) {
    throw new Error('Agile nao retornou lista de pedidos; confira permissoes no Swagger.');
  }
  const matches = result.data.map(safeTotemOrder).filter(Boolean);
  return {
    connected: true,
    resource: 'pedidos',
    recordsChecked: result.data.length,
    totemOrders: matches,
    totalOnAgile: Number(result.meta?.total) || 0,
    // Keys only, no customer personal data.
    availableFields: Object.keys(result.data[0] || {})
      .filter(k => !/telefone|email|nome|endereco|documento|cpf|cnpj/i.test(k))
      .slice(0, 24)
  };
}

function configured() {
  return !!storage.loadAgileCredentials();
}

function resetSession() {
  session = { token: '', expiresAt: 0 };
}
module.exports = { BASE, authenticate, testConnection, configured,
  resetSession, safeTotemOrder };
