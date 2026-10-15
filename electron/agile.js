'use strict';
// Direct, READ-ONLY Agile API. This module NEVER contacts HernandesDash.
// Credentials are encrypted by Windows DPAPI; JWT lives only in memory.
const storage = require('./storage');

const BASE = 'https://api-integracao.agileecommerce.com.br';
const CUSTOMER_CODE = '12678';
const MAX_PAGE_SIZE = 25;
let session = { token: '', expiresAt: 0 };
let cooldownUntil = 0;
let rateLimitFailures = 0;

function waitSeconds(headers) {
  const raw = headers?.get?.('retry-after') || '';
  let seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const deadline = Date.parse(raw);
    seconds = Number.isFinite(deadline)
      ? Math.ceil((deadline - Date.now()) / 1000) : 0;
  }
  return seconds > 0 ? Math.min(300, Math.ceil(seconds)) :
    Math.min(180, 15 * 2 ** Math.min(rateLimitFailures, 3));
}
function safeError(status, resource) {
  if (status === 401) return new Error('Agile HTTP 401: Client ID/Secret incorretos ou JWT expirado.');
  if (status === 403) return new Error('Agile HTTP 403: habilite permissao GET para ' + resource + '.');
  if (status === 404) return new Error('Agile HTTP 404: recurso ' + resource + ' nao publicado nesta conta.');
  return new Error('Agile HTTP ' + status + ' ao consultar ' + resource + '.');
}
async function query(path, { method = 'GET', body, token } = {}) {
  if (!/^\/api\/(usuario\/login|integracao\/[a-z_]+)(\?|$)/.test(path)) {
    throw new Error('Rota Agile nao permitida.');
  }
  const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
  if (remaining > 0) {
    throw new Error('Agile aguardando limite de consultas (429): tente em ' + remaining + 's.');
  }
  let response;
  try {
    response = await fetch(BASE + path, {
      method, redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12000)
    });
  } catch (err) {
    throw new Error(
      err?.name === 'TimeoutError'
        ? 'Agile nao respondeu em 12 segundos.'
        : 'Falha de rede ou certificado TLS da API Agile.'
    );
  }
  if (response.status === 429) {
    rateLimitFailures += 1;
    const seconds = waitSeconds(response.headers);
    cooldownUntil = Date.now() + seconds * 1000;
    throw new Error('Agile HTTP 429: limite atingido. Nova consulta em ' + seconds + 's.');
  }
  if (!response.ok) throw safeError(response.status, path.split('?')[0]);
  rateLimitFailures = 0;
  cooldownUntil = 0;
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') throw new Error('Agile retornou JSON invalido.');
  return json;
}
async function authenticate(force = false) {
  if (!force && session.token && Date.now() < session.expiresAt) return session.token;
  const credentials = storage.loadAgileCredentials();
  if (!credentials) throw new Error('Configure Client ID e Client Secret em Admin > Agile.');
  const response = await query('/api/usuario/login', { method: 'POST', body: credentials });
  const token = response.Token || response.token || response.access_token;
  if (typeof token !== 'string' || token.length < 10)
    throw new Error('Agile nao retornou JWT; verifique credenciais e aplicativo ativo.');
  const seconds = Number(response.Expiration);
  const ttl = Number.isFinite(seconds) && seconds > 0
    ? Math.max(30000, Math.min(30 * 60 * 1000, (seconds - 120) * 1000))
    : 15 * 60 * 1000;
  session = { token, expiresAt: Date.now() + ttl };
  return token;
}
async function list(resource, filters = {}, page = 1, limit = MAX_PAGE_SIZE) {
  if (!['pedidos', 'erp_pedidos', 'erp_pedidos_produtos'].includes(resource))
    throw new Error('Recurso Agile nao autorizado para o totem.');
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.floor(Number(page) || 1))),
    limit: String(Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(limit) || 10))))
  });
  for (const [field, value] of Object.entries(filters)) {
    if (!/^[a-z_]+$/.test(field) || value == null) throw new Error('Filtro Agile invalido.');
    params.set(field, String(value));
  }
  let token = await authenticate();
  let result;
  const route = '/api/integracao/' + resource + '?' + params.toString();
  try {
    result = await query(route, { token });
  } catch (e) {
    if (!/HTTP 401/.test(e.message)) throw e;
    token = await authenticate(true);
    result = await query(route, { token });
  }
  if (!Array.isArray(result.data))
    throw new Error('Agile ' + resource + ': resposta sem lista data.');
  return { data: result.data, meta: result.meta || {} };
}
function value(row, keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return '';
}
function text(x) { return String(x == null ? '' : x).trim(); }
function safeTotemOrder(row, resource = 'pedidos') {
  if (!row || typeof row !== 'object') return null;
  const code = text(value(row, ['codcli', 'codigo_cliente_erp', 'codcli_erp']));
  // id_cliente is Agile's internal UUID: it is NOT the ERP customer code.
  if (code !== CUSTOMER_CODE) return null;
  const agileId = text(value(row, ['id_pedido', 'id', 'external_order_id']));
  if (!agileId) return null;
  return {
    agile_id: agileId,
    erp_order: text(value(row, ['pedido_erp', 'id_pedido_erp'])),
    transaction: text(value(row, ['transacao', 'id_transacao_venda', 'nsu_transacao'])),
    status: text(value(row, ['status', 'status_operacional', 'status_erp'])),
    amount: text(value(row, ['valor_total', 'valor'])),
    created_at: text(value(row, ['dt_hr_criacao', 'data_pedido', 'created_at'])),
    source: resource
  };
}
function safeItem(row) {
  if (!row || typeof row !== 'object') return null;
  const productId = text(value(row, ['id_produto', 'codigo_produto', 'codprod']));
  const name = text(value(row, ['descricao_produto_snapshot', 'produto', 'descricao', 'nome']));
  const quantity = text(value(row, ['quantidade', 'qt', 'quantidade_atendida']));
  const price = text(value(row, ['valor_unitario', 'preco_unitario', 'pvenda']));
  const total = text(value(row, ['valor_total', 'valor']));
  if (!productId && !name) return null;
  return { product_id:productId, product_name:name,
    quantity, price, value:total };
}
// This is a bounded *diagnostic* operation: never prints, never persists
// secrets or raw rows. It never tries other customer's IDs as totem sales.
async function diagnose() {
  const sources = [];
  const samples = [];
  const resources = ['pedidos', 'erp_pedidos', 'erp_pedidos_produtos'];
  for (const resource of resources) {
    try {
      const filters = resource === 'pedidos' ? { codcli: CUSTOMER_CODE }
        : resource === 'erp_pedidos' ? { codigo_cliente_erp: CUSTOMER_CODE }
        : {};
      const response = await list(resource, filters, 1, 12);
      const fields = Object.keys(response.data[0] || {})
        .filter(k => !/nome|telefone|endereco|cpf|cnpj|email|documento/i.test(k))
        .slice(0, 32);
      const selected = resource === 'erp_pedidos_produtos'
        ? []
        : response.data.map(r => safeTotemOrder(r, resource)).filter(Boolean);
      sources.push({
        resource, ok:true, checked:response.data.length,
        total:Number(response.meta?.total) || 0, fields,
        totem_found:selected.length
      });
      samples.push(...selected.slice(0, 10));
    } catch (error) {
      sources.push({ resource, ok:false, error:error.message });
      if (/429/.test(error.message)) break; // Do not hammer a throttled API.
    }
  }
  // Fetch items for at most one matched order, to keep API consumption low.
  let itemSample = { count:0, items:[], error:'' };
  const candidate = samples.find(order => order.source === 'pedidos') ||
    samples.find(order => order.agile_id);
  if (candidate && !sources.some(source => /429/.test(source.error || ''))) {
    try {
      const items = await itemsForOrder(candidate);
      itemSample = {
        count:items.length, items:items.slice(0, 5),
        order_id:candidate.agile_id, erp_order:candidate.erp_order
      };
    } catch (e) {
      itemSample = { count:0, items:[], error:e.message };
    }
  }
  return { connected:sources.some(s => s.ok), sources, orders:samples, itemSample };
}
// Best effort, filtered server-side. Fallback to an unfiltered small page
// only when Agile rejects the filter as a 400. Never fetch all clients.
async function itemsForOrder(order) {
  if (!order || (!order.agile_id && !order.erp_order)) return [];
  const result = [];
  for (const field of ['id_pedido', 'id_pedido_erp']) {
    const id = field === 'id_pedido' ? order.agile_id : order.erp_order;
    if (!id) continue;
    try {
      const r = await list('erp_pedidos_produtos', { [field]: id }, 1, MAX_PAGE_SIZE);
      for (const row of r.data) {
        const matches =
          text(row.id_pedido) === text(order.agile_id) ||
          (order.erp_order && text(row.id_pedido_erp) === text(order.erp_order));
        if (!matches) continue;
        const item = safeItem(row);
        if (item) result.push(item);
      }
      if (result.length) break;
    } catch (e) {
      if (/429/.test(e.message)) throw e;
      if (!/HTTP (400|403|404)/.test(e.message)) throw e;
    }
  }
  return result;
}
function configured() { return !!storage.loadAgileCredentials(); }
function resetSession() { session = { token:'', expiresAt:0 }; }
module.exports = {
  BASE, CUSTOMER_CODE, authenticate, list, diagnose, configured, resetSession,
  safeTotemOrder, safeItem, itemsForOrder
};
