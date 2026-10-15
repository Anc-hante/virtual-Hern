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
function printEligibility(order) {
  if (!order || order.cancelled) return false;
  // "em_separacao" is NOT positive proof: cancelled orders have been observed
  // still reporting that ERP status while synchronization catches up.
  const state = normalizedStatus(order.status);
  return /(^|[_\s-])(aprovad|confirmad|faturad|liberad|concluid|autorizad)/.test(state);
}
function safeTotemOrder(row, resource = 'erp_pedidos') {
  if (!row || typeof row !== 'object') return null;
  const code = text(value(row, ['codigo_cliente_erp', 'codcli', 'codcli_erp']));
  // id_cliente is Agile's internal UUID: it is NOT the WinThor customer code.
  if (code !== CUSTOMER_CODE) return null;
  const id = text(value(row, ['id', 'id_pedido', 'external_order_id']));
  const erpOrder = text(value(row, ['id_pedido_erp', 'pedido_erp']));
  if (!id && !erpOrder) return null;
  const cancelled = isCancelledRecord(row);
  const order = {
    agile_id: id || ('erp:' + erpOrder),
    erp_order: erpOrder,
    transaction: text(value(row, ['id_transacao_venda', 'transacao', 'nsu_transacao'])),
    status: text(value(row, ['status_erp', 'status_operacional', 'status'])),
    amount: text(value(row, ['valor_total', 'valor'])),
    created_at: text(value(row, ['data_pedido', 'created_at', 'dt_hr_criacao'])),
    cancellation_date: text(value(row, ['data_cancelamento', 'dt_cancelamento', 'cancelled_at'])),
    cancelled,
    source: resource
  };
  return { ...order, print_eligible: printEligibility(order) };
}
function safeItem(row) {
  if (!row || typeof row !== 'object') return null;
  const productId = text(value(row, ['id_produto', 'codigo_produto', 'codprod']));
  const name = text(value(row, ['descricao_produto_snapshot', 'produto', 'descricao', 'nome']));
  const quantity = text(value(row, ['quantidade', 'qt', 'quantidade_atendida']));
  const price = text(value(row, ['valor_unitario', 'preco_unitario', 'pvenda']));
  const total = text(value(row, ['valor_total', 'valor_total_atendido', 'valor']));
  if (!productId && !name) return null;
  return { product_id:productId, product_name:name,
    quantity, price, value:total };
}
function matchingItem(row, order) {
  const erp = text(order?.erp_order);
  if (erp) return text(row?.id_pedido_erp) === erp;
  // Without an ERP number the internal record ID is not necessarily
  // an Agile order ID; do not associate a product by guessing.
  return order?.source === 'pedidos' &&
    text(row?.id_pedido) === text(order?.agile_id);
}

// The user's Agile account returns ERP orders and products, but the
// /pedidos response currently has no documented {data: []} shape.
// One authoritative ERP request plus at most one filtered items request.
// No broad scan of the entire 400k+ product table, no printing.
async function diagnose() {
  const sources = [];
  let matches = [];
  let itemSample = { count:0, items:[], error:'' };
  try {
    const response = await list('erp_pedidos',
      { codigo_cliente_erp: CUSTOMER_CODE }, 1, MAX_PAGE_SIZE);
    matches = response.data.map(row => safeTotemOrder(row, 'erp_pedidos')).filter(Boolean);
    sources.push({
      resource:'erp_pedidos', ok:true, checked:response.data.length,
      total:Number(response.meta?.total) || 0,
      fields:Object.keys(response.data[0] || {})
        .filter(k => !/nome|telefone|endereco|cpf|cnpj|email|documento/i.test(k))
        .slice(0, 35),
      totem_found:matches.length,
      cancelled:matches.filter(x=>x.cancelled).length,
      awaiting_verification:matches.filter(x=>!x.cancelled && !x.print_eligible).length
    });
  } catch (error) {
    sources.push({ resource:'erp_pedidos', ok:false, error:error.message });
    return { connected:false, sources, orders:[], itemSample };
  }
  const candidate = matches.find(order => order.erp_order);
  if (candidate) {
    try {
      const rows = await list('erp_pedidos_produtos',
        { id_pedido_erp: candidate.erp_order }, 1, MAX_PAGE_SIZE);
      const items = rows.data.filter(row => matchingItem(row, candidate))
        .map(safeItem).filter(Boolean);
      itemSample = {
        count:items.length, items:items.slice(0, 5),
        order_id:candidate.agile_id, erp_order:candidate.erp_order
      };
      sources.push({
        resource:'erp_pedidos_produtos', ok:true, checked:rows.data.length,
        total:Number(rows.meta?.total) || 0,
        totem_found:items.length,
        fields:Object.keys(rows.data[0] || {})
          .filter(k => !/nome|telefone|endereco|cpf|cnpj|email|documento/i.test(k))
          .slice(0, 35)
      });
    } catch (e) {
      sources.push({ resource:'erp_pedidos_produtos', ok:false, error:e.message });
      itemSample = { count:0, items:[], error:e.message };
    }
  }
  return {
    connected:true, sources, orders:matches.slice(0, 10), itemSample,
    warning:matches.some(x=>!x.cancelled && !x.print_eligible)
      ? 'Alguns pedidos ERP ainda nao tem confirmacao segura. Nao serao impressos automaticamente.'
      : ''
  };
}
async function itemsForOrder(order) {
  if (!order || (!order.erp_order && !order.agile_id)) return [];
  const field = order.erp_order ? 'id_pedido_erp' : 'id_pedido';
  const id = order.erp_order || order.agile_id;
  if (!order.erp_order && order.source !== 'pedidos') return [];
  const response = await list('erp_pedidos_produtos', { [field]:id },
    1, MAX_PAGE_SIZE);
  return response.data.filter(row => matchingItem(row, order)).map(safeItem).filter(Boolean);
}
function configured() { return !!storage.loadAgileCredentials(); }
function resetSession() { session = { token:'', expiresAt:0 }; }
module.exports = {
  BASE, CUSTOMER_CODE, authenticate, list, diagnose, configured, resetSession,
  safeTotemOrder, safeItem, itemsForOrder, isCancelledRecord, printEligibility, matchingItem
};
