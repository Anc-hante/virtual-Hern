'use strict';
// Direct, READ-ONLY Agile API. This module NEVER contacts HernandesDash.
// Credentials are encrypted by Windows DPAPI; JWT lives only in memory.
const storage = require('./storage');

const BASE = 'https://api-integracao.agileecommerce.com.br';
const CUSTOMER_CODE = '12678';
const RESOURCES = [
  'pedidos', 'pedidos_produtos', 'pedidos_pagamentos', 'clientes', 'produtos',
  'erp_pedidos', 'erp_pedidos_produtos'
];
const MAX_PAGE_SIZE = 25;
let session = { token: '', expiresAt: 0 };
let cooldownUntil = 0;
let rateLimitFailures = 0;
let customerCache = '';

function waitSeconds(headers) {
  const raw = headers?.get?.('retry-after') || '';
  let seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const deadline = Date.parse(raw);
    seconds = Number.isFinite(deadline)
      ? Math.ceil((deadline - Date.now()) / 1000) : 0;
  }
  if (seconds > 0) return Math.min(60, Math.max(1, Math.ceil(seconds)));
  return Math.min(60, 3 * 2 ** Math.min(rateLimitFailures, 4));
}
function safeError(status, resource) {
  if (status === 401) return new Error('Agile HTTP 401: Client ID/Secret incorretos ou JWT expirado.');
  if (status === 403) return new Error('Agile HTTP 403: habilite permissao GET para ' + resource + '.');
  if (status === 404) return new Error('Agile HTTP 404: recurso ' + resource + ' nao publicado nesta conta.');
  return new Error('Agile HTTP ' + status + ' ao consultar ' + resource + '.');
}
function allowedPath(path) {
  return /^\/api\/(usuario\/login|integracao\/[a-z_]+(?:\/[A-Za-z0-9_-]+)?)(\?|$)/.test(path);
}
async function query(path, { method = 'GET', body, token } = {}) {
  if (!allowedPath(path)) throw new Error('Rota Agile nao permitida.');
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
function expiresAtFrom(expiration) {
  const now = Date.now();
  const skew = 120000;
  const maxTtl = 30 * 60 * 1000;
  let absolute = NaN;
  if (typeof expiration === 'number' && Number.isFinite(expiration) && expiration > 0) {
    absolute = now + expiration * 1000;
  } else if (typeof expiration === 'string' && /^\d+(\.\d+)?$/.test(expiration.trim())) {
    absolute = now + Number(expiration) * 1000;
  } else if (expiration != null && expiration !== '') {
    absolute = Date.parse(expiration);
  }
  if (!Number.isFinite(absolute)) return now + 15 * 60 * 1000;
  const until = absolute - skew;
  if (until <= now) return now + 30000;
  return Math.min(until, now + maxTtl);
}
async function authenticate(force = false) {
  if (!force && session.token && Date.now() < session.expiresAt) return session.token;
  const credentials = storage.loadAgileCredentials();
  if (!credentials) throw new Error('Configure Client ID e Client Secret em Admin > Agile.');
  const response = await query('/api/usuario/login', { method: 'POST', body: credentials });
  const token = response.Token || response.token || response.access_token;
  if (typeof token !== 'string' || token.length < 10)
    throw new Error('Agile nao retornou JWT; verifique credenciais e aplicativo ativo.');
  session = { token, expiresAt: expiresAtFrom(response.Expiration) };
  return token;
}
function pageLimit(resource, limit) {
  const cap = resource === 'pedidos_produtos' || resource === 'pedidos_pagamentos' ? 100 : MAX_PAGE_SIZE;
  return Math.min(cap, Math.max(1, Math.floor(Number(limit) || 10)));
}
async function authorized(route) {
  let token = await authenticate();
  try {
    return await query(route, { token });
  } catch (error) {
    if (!/HTTP 401/.test(error.message)) throw error;
    token = await authenticate(true);
    return await query(route, { token });
  }
}
async function list(resource, filters = {}, page = 1, limit = MAX_PAGE_SIZE) {
  if (!RESOURCES.includes(resource)) throw new Error('Recurso Agile nao autorizado para o totem.');
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.floor(Number(page) || 1))),
    limit: String(pageLimit(resource, limit))
  });
  for (const [field, value] of Object.entries(filters)) {
    if (!/^[a-z_]+$/.test(field) || value == null || value === '') {
      throw new Error('Filtro Agile invalido.');
    }
    params.set(field, String(value));
  }
  const result = await authorized('/api/integracao/' + resource + '?' + params.toString());
  if (!Array.isArray(result.data))
    throw new Error('Agile ' + resource + ': resposta sem lista data.');
  return { data: result.data, meta: result.meta || {} };
}
async function getOne(resource, id) {
  if (!RESOURCES.includes(resource)) throw new Error('Recurso Agile nao autorizado para o totem.');
  const cleanId = text(id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(cleanId)) throw new Error('Identificador Agile invalido.');
  return authorized('/api/integracao/' + resource + '/' + cleanId);
}
function value(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}
function text(x) {
  if (x == null || typeof x === 'object') return '';
  return String(x).trim();
}
function normalizedStatus(raw) {
  return text(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function hasCancellationDate(raw) {
  const value = text(raw);
  return !!value && !/^(null|false|0+|0000-00-00(?:[ t]00:00:00)?)/i.test(value);
}
function isCancelledRecord(row) {
  if (!row || typeof row !== 'object') return false;
  if (hasCancellationDate(value(row, ['data_cancelamento', 'dt_cancelamento',
    'cancelled_at', 'canceled_at']))) return true;
  if (row.cancelado === true || row.cancelled === true) return true;
  const statuses = ['status', 'status_operacional', 'status_erp', 'situacao', 'status_pedido'];
  return statuses.some(field =>
    /cancel|rejeitad|estornad|excluid|inativ/.test(normalizedStatus(row[field]))
  );
}
function confirmedFlag(row) {
  if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, 'confirmado')) {
    return undefined;
  }
  if (row.confirmado === true || row.confirmado === 'true' || row.confirmado === 1) return true;
  if (row.confirmado === false || row.confirmado === 'false' || row.confirmado === 0) return false;
  return undefined;
}
function printEligibility(order) {
  // Pre-WinThor orders print only after Agile marks confirmado and leaves
  // the cart. ERP rows may omit that flag; cancellation and drafts never print.
  if (!order || !order.agile_id || order.cancelled || isCancelledRecord(order)) return false;
  const statuses = [order.status, order.status_agile, order.status_erp]
    .map(normalizedStatus).filter(Boolean);
  if (statuses.some(value =>
    /rascunh|draft|carrinho|em_edicao|nao_finalizad|cancel|rejeitad|estornad|excluid|inativ/.test(value)
  )) return false;
  if (order.confirmado === false) return false;
  if (order.source === 'pedidos' && order.confirmado !== true) return false;
  return true;
}
function belongsToTotem(row, customerId) {
  const code = text(value(row, ['codigo_cliente_erp', 'codcli', 'codcli_erp']));
  if (code) return code === CUSTOMER_CODE;
  const expected = text(customerId);
  return !!expected && text(row.id_cliente) === expected;
}
function parseAgileDate(raw) {
  const value = text(raw);
  if (!value) return '';
  const wrapped = /^\/Date\((\d+)\)\/$/.exec(value);
  if (wrapped) {
    const ms = Number(wrapped[1]);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
    const parsed = Date.parse(value.replace(' ', 'T') + '-03:00');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}
function safeTotemOrder(row, resource = 'erp_pedidos', context = {}) {
  if (!row || typeof row !== 'object') return null;
  if (!belongsToTotem(row, context.customerId)) return null;
  const id = text(value(row, ['id', 'id_pedido']));
  let erpOrder = text(value(row, ['id_pedido_erp', 'pedido_erp']));
  const codigo = text(row.codigo);
  if (!erpOrder && codigo && codigo !== CUSTOMER_CODE) erpOrder = codigo;
  if (!id && !erpOrder) return null;
  const cancelled = isCancelledRecord(row);
  const confirmado = confirmedFlag(row);
  const order = {
    agile_id: id || ('erp:' + erpOrder),
    external_order_id: text(value(row, ['external_order_id', 'id_pedido_rca'])),
    erp_order: erpOrder,
    transaction: text(value(row, ['id_transacao_venda', 'transacao', 'id_transacao', 'nsu_transacao'])),
    status: text(value(row, ['status', 'status_operacional', 'status_erp'])),
    status_agile: text(value(row, ['status', 'status_operacional'])),
    status_erp: text(value(row, ['status_erp'])),
    amount: text(value(row, ['valor_total', 'valor_pagar', 'valor'])),
    created_at: parseAgileDate(value(row, ['data_pedido', 'data', 'created_at', 'dt_hr_criacao'])),
    cancellation_date: text(value(row, ['data_cancelamento', 'dt_cancelamento', 'cancelled_at'])),
    cancelled,
    confirmado,
    source: resource
  };
  return { ...order, print_eligible: printEligibility(order) };
}
function snapshotName(row) {
  const raw = row?.json;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000000) return '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const nome = text(parsed.nome || parsed.name || parsed.titulo || parsed.descricao_curta);
  if (nome) return nome;
  if (typeof parsed.descricao === 'string' && text(parsed.descricao)) return text(parsed.descricao);
  if (Array.isArray(parsed.descricao)) {
    for (const entry of parsed.descricao) {
      const part = text(typeof entry === 'string' ? entry : (entry?.descricao || entry?.nome));
      if (part) return part;
    }
  }
  return '';
}
function safeItem(row) {
  if (!row || typeof row !== 'object') return null;
  const productId = text(value(row, ['id_produto', 'codigo_produto', 'codprod']));
  const name = text(value(row, ['descricao_produto_snapshot', 'produto', 'descricao', 'nome'])) ||
    snapshotName(row);
  const quantity = text(value(row, ['quantidade', 'qt', 'quantidade_atendida']));
  // preco_base is the list price, not the amount charged on the order.
  const price = text(value(row, ['valor_unitario', 'preco_unitario', 'pvenda', 'preco_venda', 'valor_embalagem']));
  const total = text(value(row, ['valor_total', 'valor_total_atendido']));
  if (!productId && !name) return null;
  return { product_id: productId, product_name: name, quantity, price, value: total };
}
function matchingItem(row, order) {
  const agileId = text(order?.agile_id);
  const rowOrder = text(row?.id_pedido);
  const rowErp = text(row?.id_pedido_erp);
  const erp = text(order?.erp_order);
  if (order?.source === 'pedidos') return !!agileId && rowOrder === agileId;
  if (erp && rowErp) return rowErp === erp;
  return order?.source === 'erp_pedidos' && !!agileId && rowOrder === agileId;
}
function recordFields(row) {
  return Object.keys(row || {})
    .filter(key => !/nome|telefone|endereco|cpf|cnpj|email|documento|^ip$|razao|fantasia/i.test(key))
    .slice(0, 35);
}
async function customerIdForTotem() {
  if (customerCache) return customerCache;
  const page = await list('clientes', { codigo: CUSTOMER_CODE }, 1, 5);
  const match = page.data.find(row => text(row?.codigo) === CUSTOMER_CODE && text(row?.id));
  if (!match) throw new Error('Cliente ERP ' + CUSTOMER_CODE + ' nao encontrado no Agile.');
  customerCache = text(match.id);
  return customerCache;
}
async function recentOrders() {
  const customerId = await customerIdForTotem();
  const page = await list('pedidos', {
    id_cliente: customerId,
    sort: 'data',
    order: 'DESC'
  }, 1, 5);
  return {
    orders: page.data
      .map(row => safeTotemOrder(row, 'pedidos', { customerId }))
      .filter(Boolean),
    meta: page.meta || {}
  };
}
async function orderById(id) {
  const cleanId = text(id);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(cleanId)) throw new Error('Identificador Agile invalido.');
  const customerId = await customerIdForTotem();
  try {
    const json = await getOne('pedidos', cleanId);
    const row = json?.data && !Array.isArray(json.data) ? json.data : null;
    const order = row && safeTotemOrder(row, 'pedidos', { customerId });
    if (order) return order;
  } catch (error) {
    if (!/HTTP 404/.test(error.message)) throw error;
  }
  try {
    const page = await list('erp_pedidos', { codigo_cliente_erp: CUSTOMER_CODE }, 1, MAX_PAGE_SIZE);
    return page.data
      .map(row => safeTotemOrder(row, 'erp_pedidos'))
      .find(order => order?.agile_id === cleanId) || null;
  } catch (_) {
    return null;
  }
}
async function productName(id) {
  try {
    const json = await getOne('produtos', id);
    const row = json?.data && typeof json.data === 'object' && !Array.isArray(json.data)
      ? json.data
      : (Array.isArray(json?.data) ? json.data[0] : json);
    return text(row?.nome || row?.name || row?.descricao_curta || row?.titulo);
  } catch (_) {
    return '';
  }
}
async function nativeItems(order) {
  const id = text(order?.agile_id);
  if (!id || id.startsWith('erp:')) return [];
  let response;
  try {
    response = await list('pedidos_produtos', { id_pedido: id }, 1, 100);
  } catch (_) {
    return [];
  }
  const items = [];
  let lookups = 0;
  for (const row of response.data) {
    if (!matchingItem(row, { ...order, source: 'pedidos' })) continue;
    const item = safeItem(row);
    if (!item) continue;
    if (!item.product_name && item.product_id && lookups < 20) {
      lookups += 1;
      item.product_name = await productName(item.product_id);
    }
    items.push(item);
  }
  return items;
}
async function erpItems(order) {
  const field = order.erp_order ? 'id_pedido_erp' : 'id_pedido';
  const id = order.erp_order || order.agile_id;
  if (!id) return [];
  const response = await list('erp_pedidos_produtos', { [field]: id }, 1, 100);
  const probe = { ...order, source: 'erp_pedidos' };
  return response.data.filter(row => matchingItem(row, probe)).map(safeItem).filter(Boolean);
}
async function itemsForOrder(order) {
  if (!order || (!order.erp_order && !order.agile_id)) return [];
  if (order.source === 'erp_pedidos') return erpItems(order);
  const native = await nativeItems(order);
  if (native.length || !order.erp_order) return native;
  try { return await erpItems(order); } catch (_) { return native; }
}
async function paymentsForOrder(order) {
  const id = text(order?.agile_id);
  if (!id || id.startsWith('erp:')) return [];
  try {
    const response = await list('pedidos_pagamentos', { id_pedido: id }, 1, 20);
    return response.data.filter(row => !text(row?.id_pedido) || text(row.id_pedido) === id);
  } catch (_) {
    return [];
  }
}
async function diagnose() {
  const sources = [];
  let orders = [];
  let itemSample = { count: 0, items: [], error: '' };
  let customerId = '';
  try {
    customerId = await customerIdForTotem();
    sources.push({
      resource: 'clientes', ok: true, checked: 1, total: 1, totem_found: 1,
      fields: ['id', 'codigo']
    });
  } catch (error) {
    sources.push({ resource: 'clientes', ok: false, error: error.message });
    return { connected: false, sources, orders, itemSample };
  }
  try {
    const page = await list('pedidos', {
      id_cliente: customerId, sort: 'data', order: 'DESC'
    }, 1, 5);
    orders = page.data.map(row => safeTotemOrder(row, 'pedidos', { customerId })).filter(Boolean);
    sources.push({
      resource: 'pedidos', ok: true, checked: page.data.length,
      total: Number(page.meta?.total) || 0,
      fields: recordFields(page.data[0]),
      totem_found: orders.length,
      cancelled: orders.filter(order => order.cancelled).length,
      awaiting_verification: orders.filter(order => !order.cancelled && !order.print_eligible).length
    });
  } catch (error) {
    sources.push({ resource: 'pedidos', ok: false, error: error.message });
    return { connected: false, sources, orders, itemSample };
  }
  const candidate = orders.find(order => order.print_eligible) ||
    orders.find(order => order.agile_id && !order.cancelled);
  if (candidate) {
    try {
      const items = await itemsForOrder(candidate);
      itemSample = {
        count: items.length, items: items.slice(0, 5),
        order_id: candidate.agile_id, erp_order: candidate.erp_order,
        link_field: 'id_pedido'
      };
      sources.push({
        resource: 'pedidos_produtos', ok: true, checked: items.length,
        totem_found: items.length, total: items.length
      });
    } catch (error) {
      itemSample = { count: 0, items: [], error: error.message };
      sources.push({ resource: 'pedidos_produtos', ok: false, error: error.message });
    }
  }
  try {
    const erp = await list('erp_pedidos', { codigo_cliente_erp: CUSTOMER_CODE }, 1, 5);
    sources.push({
      resource: 'erp_pedidos', ok: true, optional: true, checked: erp.data.length,
      total: Number(erp.meta?.total) || 0, fields: recordFields(erp.data[0])
    });
  } catch (error) {
    sources.push({ resource: 'erp_pedidos', ok: false, optional: true, error: error.message });
  }
  return {
    connected: true, sources, orders: orders.slice(0, 10), itemSample,
    warning: orders.some(order => !order.cancelled && !order.print_eligible)
      ? 'Alguns registros sao rascunhos ou nao tem identificacao valida; nao serao impressos.'
      : ''
  };
}
function configured() { return !!storage.loadAgileCredentials(); }
function resetSession() {
  session = { token: '', expiresAt: 0 };
  customerCache = '';
  cooldownUntil = 0;
  rateLimitFailures = 0;
}
module.exports = {
  BASE, CUSTOMER_CODE, authenticate, list, getOne, diagnose, configured, resetSession,
  safeTotemOrder, safeItem, itemsForOrder, paymentsForOrder, recentOrders, orderById,
  customerIdForTotem, isCancelledRecord, printEligibility, matchingItem, parseAgileDate
};
