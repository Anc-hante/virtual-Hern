'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const agile = require('../agile');
const storage = require('../storage');
const history = require('../agile-history');
const printer = require('../printer');
const {
  receipt, printOrder, AgilePrintWorker, POLL_MS, SEEN_LIMIT, nextDelay
} = require('../agile-print');
const fixture = require('./fixtures/agile-pedido-1000018742.json');

const paid = fixture.orders[0];
const cancelled = fixture.orders[1];
const integrated = fixture.orders[2];
const customerId = fixture.customer.id;

function mapOrder(row) {
  return agile.safeTotemOrder(row, 'pedidos', { customerId });
}

test('sample pedido 1000018742 is printable before WinThor and carrinho/cancelado are not', () => {
  const order = mapOrder(paid);
  assert.equal(order.agile_id, '1000018742');
  assert.equal(order.confirmado, true);
  assert.equal(order.print_eligible, true);
  assert.equal(order.erp_order, '');
  assert.equal(order.transaction, '1000018742');
  assert.equal(order.amount, '159.99');
  assert.equal(order.cancelled, false);
  assert.equal(order.created_at, '2026-10-15T23:31:21.000Z');
  const fromMicrosoftDate = mapOrder({ ...paid, data: '/Date(1792107081000)/' });
  assert.equal(fromMicrosoftDate.created_at, order.created_at);
  assert.equal(mapOrder(paid) && agile.safeTotemOrder(paid, 'pedidos'), null);
  assert.equal(mapOrder({ ...paid, id_cliente: '00000000000' }), null);

  const cart = mapOrder({ ...paid, status: 'carrinho', confirmado: false, id_transacao: null });
  assert.equal(cart.print_eligible, false);
  assert.equal(cart.status, 'carrinho');
  const dropped = mapOrder(cancelled);
  assert.equal(dropped.agile_id, '1000018740');
  assert.equal(dropped.print_eligible, false);
  assert.equal(dropped.cancelled, true);
  const afterErp = mapOrder(integrated);
  assert.equal(afterErp.erp_order, '1960009485');
  assert.equal(afterErp.print_eligible, false);
});

test('sample item uses the json name and the charged price, never the list price', () => {
  const item = agile.safeItem(fixture.items[0]);
  assert.equal(item.product_id, '7993');
  assert.equal(item.product_name, 'MARGARINA ELOGIATA BALDE-15KG 60%');
  assert.equal(item.quantity, '1');
  assert.equal(item.price, '159.99');
  assert.equal(item.value, '159.99');
  assert.notEqual(item.price, '192.05');
  const blankName = agile.safeItem({
    ...fixture.items[0],
    json: '{"descricao":[{"descricao":""}]}'
  });
  assert.equal(blankName.product_name, '');
  assert.equal(blankName.product_id, '7993');

  const order = mapOrder(paid);
  const printed = receipt(order, [item]);
  assert.match(printed, /TRANSACAO AGILE: 1000018742/);
  assert.match(printed, /WINTHOR: AGUARDANDO INTEGRACAO/);
  assert.match(printed, /MARGARINA ELOGIATA BALDE-15KG 60%/);
  assert.match(printed, /Qtd: 1 x R\$ 159,99/);
  assert.match(printed, /TOTAL DO PEDIDO: R\$ 159,99/);
  assert.doesNotMatch(printed, /192,05/);
  const totalOnly = receipt({ ...order, payment_label: 'D R$ 159,99' }, []);
  assert.match(totalOnly, /ITENS INDISPONIVEIS NO AGILE/);
  assert.match(totalOnly, /PAGAMENTO: D R\$ 159,99/);
  assert.match(totalOnly, /TOTAL DO PEDIDO: R\$ 159,99/);
  assert.doesNotMatch(totalOnly, /MARGARINA|7993|192,05|Dinheiro|PIX|Cartao/i);
});

function ok(body) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
}

test('poll resolves 12678 once, caches the token, and loads items and payment by id_pedido', async () => {
  const oldFetch = global.fetch;
  const oldLoad = storage.loadAgileCredentials;
  const calls = [];
  try {
    storage.loadAgileCredentials = () => ({
      client_id: 'local-test-id', client_secret: 'local-test-secret'
    });
    global.fetch = async (url, opts) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith('/api/usuario/login')) {
        return ok({ Token: 'mock-jwt-token-value', Expiration: '2099-06-01T00:00:00.000Z' });
      }
      if (target.includes('/integracao/clientes?')) {
        assert.match(target, /codigo=12678/);
        return ok({ data: [fixture.customer, { id: '44444444444', codigo: '12678', cpf: '444.444.444-44' }], meta: { total: 2 } });
      }
      if (target.includes('/integracao/pedidos?')) {
        return ok({ data: fixture.orders.map(row => ({ ...row, id_cliente: '44444444444' })), meta: { total: fixture.orders.length } });
      }
      if (target.includes('/integracao/pedidos_produtos?')) {
        return ok({ data: fixture.items, meta: { total: 1 } });
      }
      if (target.includes('/integracao/pedidos_pagamentos?')) {
        return ok({ data: [fixture.payment], meta: { total: 1 } });
      }
      if (target.includes('/integracao/produtos/7993')) {
        return ok({ data: { id: '7993', nome: 'MARGARINA ELOGIATA BALDE-15KG 60%' } });
      }
      throw new Error('Unexpected Agile path: ' + target);
    };
    agile.resetSession();
    const first = await agile.recentOrders();
    const second = await agile.recentOrders();
    assert.equal(calls.filter(url => url.endsWith('/api/usuario/login')).length, 1);
    assert.equal(calls.filter(url => url.includes('/integracao/clientes?')).length, 1);
    assert.equal(calls.filter(url => url.includes('/integracao/pedidos?')).length, 2);
    const pedidosUrl = calls.find(url => url.includes('/integracao/pedidos?'));
    assert.match(pedidosUrl, /id_cliente=44444444444/);
    assert.match(pedidosUrl, /sort=data/);
    assert.match(pedidosUrl, /order=DESC/);
    assert.match(pedidosUrl, /limit=5/);
    assert.equal(first.orders[0].agile_id, '1000018742');
    assert.equal(first.orders[0].print_eligible, true);
    assert.equal(second.orders[1].print_eligible, false);

    const items = await agile.itemsForOrder(first.orders[0]);
    assert.equal(items.length, 1);
    assert.equal(items[0].product_name, 'MARGARINA ELOGIATA BALDE-15KG 60%');
    assert.equal(items[0].price, '159.99');
    const productUrl = calls.find(url => url.includes('pedidos_produtos'));
    assert.match(productUrl, /pedidos_produtos\?/);
    assert.match(productUrl, /id_pedido=1000018742/);
    assert.equal(calls.some(url => /pedidos_produtos\/1000018742/.test(url)), false);
    assert.equal(calls.some(url => url.includes('/produtos/7993')), false);

    const payments = await agile.paymentsForOrder(first.orders[0]);
    assert.equal(payments[0].id_forma_pagamento, 'D');
    assert.equal(payments[0].valor, 159.99);
    assert.match(calls.find(url => url.includes('pedidos_pagamentos')), /id_pedido=1000018742/);

    calls.length = 0;
    global.fetch = async (url) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith('/api/usuario/login')) {
        return ok({ Token: 'mock-jwt-token-value', Expiration: '2099-06-01T00:00:00.000Z' });
      }
      if (target.includes('/integracao/pedidos_produtos?')) {
        return ok({
          data: [{ ...fixture.items[0], json: '{"descricao":[{"descricao":""}]}' }],
          meta: { total: 1 }
        });
      }
      if (target.includes('/integracao/produtos/7993')) {
        return ok({ data: { nome: 'MARGARINA ELOGIATA BALDE-15KG 60%' } });
      }
      throw new Error('Unexpected Agile path: ' + target);
    };
    const named = await agile.itemsForOrder(first.orders[0]);
    assert.equal(named[0].product_name, 'MARGARINA ELOGIATA BALDE-15KG 60%');
    assert.equal(named[0].product_id, '7993');
    assert.ok(calls.some(url => url.endsWith('/api/integracao/produtos/7993')));

    global.fetch = async () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });
    assert.deepEqual(await agile.itemsForOrder(first.orders[0]), []);
    assert.deepEqual(await agile.paymentsForOrder(first.orders[0]), []);
  } finally {
    global.fetch = oldFetch;
    storage.loadAgileCredentials = oldLoad;
    agile.resetSession();
  }
});

test('a mismatched clientes row is not treated as totem customer 12678', async () => {
  const oldFetch = global.fetch;
  const oldLoad = storage.loadAgileCredentials;
  try {
    storage.loadAgileCredentials = () => ({
      client_id: 'local-test-id', client_secret: 'local-test-secret'
    });
    global.fetch = async (url) => {
      if (String(url).endsWith('/api/usuario/login')) {
        return ok({ Token: 'mock-jwt-token-value', Expiration: 3600 });
      }
      return ok({ data: [{ id: '99999999999', codigo: '1' }], meta: { total: 1 } });
    };
    agile.resetSession();
    await assert.rejects(() => agile.recentOrders(), /12678/);
  } finally {
    global.fetch = oldFetch;
    storage.loadAgileCredentials = oldLoad;
    agile.resetSession();
  }
});

test('confirmed sample order prints once with items, and without items prints the total only', async () => {
  const old = {
    configured: agile.configured,
    recent: agile.recentOrders,
    items: agile.itemsForOrder,
    payments: agile.paymentsForOrder,
    selected: storage.selectedPrinter,
    printers: printer.installedPrinters,
    print: printer.printReceipt,
    get: history.get,
    update: history.update,
    initialized: history.monitorInitialized,
    init: history.initializeMonitor
  };
  const rows = new Map();
  const output = [];
  let phase = 'boot';
  let initialized = false;
  const live = () => ({ ...paid, data: new Date().toISOString() });
  try {
    agile.configured = () => true;
    storage.selectedPrinter = () => 'ELGIN';
    printer.installedPrinters = async () => [{ name: 'ELGIN' }];
    printer.printReceipt = async (_name, text) => { output.push(text); };
    history.monitorInitialized = () => initialized;
    history.initializeMonitor = () => { initialized = true; };
    history.get = id => rows.get(String(id)) || null;
    history.update = (order, changes = {}) => {
      const current = { ...(rows.get(order.agile_id) || {}), ...order, ...changes };
      rows.set(order.agile_id, current);
      return current;
    };
    agile.paymentsForOrder = async () => [fixture.payment];
    agile.itemsForOrder = async () => [agile.safeItem(fixture.items[0])];
    agile.recentOrders = async () => {
      if (phase === 'boot') return { orders: [] };
      const row = phase === 'cart'
        ? { ...live(), status: 'carrinho', confirmado: false, id_transacao: null }
        : live();
      const order = mapOrder(row);
      return { orders: order ? [order] : [] };
    };
    const worker = new AgilePrintWorker({});
    await worker.tick();
    phase = 'cart';
    await worker.tick();
    assert.equal(output.length, 0);
    assert.equal(rows.get('1000018742').print_status, 'watching');
    assert.equal(rows.get('1000018742').auto_pending, false);
    phase = 'paid';
    await worker.tick();
    assert.equal(output.length, 1);
    assert.match(output[0], /MARGARINA ELOGIATA BALDE-15KG 60%/);
    assert.match(output[0], /Qtd: 1 x R\$ 159,99/);
    assert.match(output[0], /TOTAL DO PEDIDO: R\$ 159,99/);
    assert.match(output[0], /PAGAMENTO: D/);
    assert.match(output[0], /WINTHOR: AGUARDANDO INTEGRACAO/);
    assert.doesNotMatch(output[0], /192,05/);
    assert.equal(rows.get('1000018742').print_count, 1);
    await worker.tick();
    assert.equal(output.length, 1);

    output.length = 0;
    rows.clear();
    initialized = false;
    phase = 'boot';
    agile.itemsForOrder = async () => [];
    const second = new AgilePrintWorker({});
    await second.tick();
    phase = 'paid';
    await second.tick();
    assert.equal(output.length, 1);
    assert.match(output[0], /ITENS INDISPONIVEIS NO AGILE/);
    assert.match(output[0], /TOTAL DO PEDIDO: R\$ 159,99/);
    assert.doesNotMatch(output[0], /MARGARINA|7993/);
    await second.tick();
    assert.equal(output.length, 1);

    const blocked = mapOrder({ ...live(), id: cancelled.id, status: 'cancelado', cancelado: true });
    rows.clear();
    initialized = true;
    agile.recentOrders = async () => ({ orders: [blocked] });
    await second.tick();
    assert.equal(output.length, 1);
    assert.equal(rows.get(cancelled.id).print_status, 'cancelled');
  } finally {
    agile.configured = old.configured;
    agile.recentOrders = old.recent;
    agile.itemsForOrder = old.items;
    agile.paymentsForOrder = old.payments;
    storage.selectedPrinter = old.selected;
    printer.installedPrinters = old.printers;
    printer.printReceipt = old.print;
    history.get = old.get;
    history.update = old.update;
    history.monitorInitialized = old.initialized;
    history.initializeMonitor = old.init;
  }
});

test('monitor stays bounded: 3s poll, 60s cap, 500 remembered ids, trimmed history', () => {
  assert.equal(POLL_MS, 3000);
  assert.equal(SEEN_LIMIT, 500);
  assert.equal(nextDelay(1), 6000);
  assert.equal(nextDelay(4), 48000);
  assert.equal(nextDelay(5), 60000);
  assert.equal(nextDelay(12), 60000);
  const worker = new AgilePrintWorker({});
  for (let i = 0; i < 520; i += 1) worker.remember(String(i), 's' + i);
  assert.equal(worker.seen.size, 500);
  assert.equal(worker.seen.has('0'), false);
  assert.equal(worker.seen.has('19'), false);
  assert.equal(worker.seen.has('20'), true);
  assert.equal(worker.seen.has('519'), true);
  worker.stop();
  const source = fs.readFileSync(path.join(__dirname, '..', 'agile-print.js'), 'utf8');
  const ledger = fs.readFileSync(path.join(__dirname, '..', 'agile-history.js'), 'utf8');
  assert.match(source, /this\.printing = true/);
  assert.match(source, /if \(!this\.stopped\) this\.schedule\(delay\)/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(ledger, /MAX_RECORDS = 500/);
  assert.match(ledger, /slice\(-MAX_RECORDS\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const hash = crypto.createHash('sha256').update('admin123').digest('hex');
  assert.match(main, new RegExp("ADMIN_HASH = '" + hash + "'"));
});

test('printOrder does not require a product list when the Agile total is known', async () => {
  const old = {
    items: agile.itemsForOrder,
    payments: agile.paymentsForOrder,
    selected: storage.selectedPrinter,
    printers: printer.installedPrinters,
    print: printer.printReceipt,
    get: history.get,
    update: history.update
  };
  const output = [];
  try {
    agile.itemsForOrder = async () => { throw new Error('pedidos_produtos indisponivel'); };
    agile.paymentsForOrder = async () => [];
    storage.selectedPrinter = () => 'ELGIN';
    printer.installedPrinters = async () => [{ name: 'ELGIN' }];
    printer.printReceipt = async (_name, text) => { output.push(text); };
    history.get = () => null;
    history.update = (order, changes = {}) => ({ ...order, ...changes });
    const order = mapOrder({ ...paid, data: new Date().toISOString() });
    const result = await printOrder(order, {});
    assert.equal(result.printed, true);
    assert.match(output[0], /ITENS INDISPONIVEIS NO AGILE/);
    assert.match(output[0], /TOTAL DO PEDIDO: R\$ 159,99/);
    assert.match(output[0], /1000018742/);
    assert.doesNotMatch(output[0], /MARGARINA|7993|192,05/);
  } finally {
    agile.itemsForOrder = old.items;
    agile.paymentsForOrder = old.payments;
    storage.selectedPrinter = old.selected;
    printer.installedPrinters = old.printers;
    printer.printReceipt = old.print;
    history.get = old.get;
    history.update = old.update;
  }
});
