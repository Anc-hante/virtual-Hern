'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Agile ID and secret stored encrypted, never plaintext', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'hernandes-agile-'));
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  const storagePath = require.resolve('../storage');
  delete require.cache[storagePath];
  try {
    const storage = require('../storage');
    const protector = {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from('DPAPI-TEST-' + Buffer.from(value).toString('base64')),
      decryptString: b => Buffer.from(
        b.toString().slice('DPAPI-TEST-'.length), 'base64'
      ).toString('utf8')
    };
    storage.saveAgileCredentials('test-client-id', 'test-client-secret', protector);
    const raw = fs.readFileSync(path.join(storage.folder, 'agile-credentials.dpapi'));
    assert.equal(raw.includes(Buffer.from('test-client-secret')), false);
    assert.deepEqual(storage.loadAgileCredentials(protector), {
      client_id: 'test-client-id', client_secret: 'test-client-secret'
    });
    assert.throws(
      () => storage.saveAgileCredentials('test', '', protector),
      /Preencha Client ID/
    );
  } finally {
    delete require.cache[storagePath];
    if (old === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = old;
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test('Agile diagnosis uses the working ERP response and skips incompatible pedidos endpoint', async () => {
  const storage = require('../storage');
  const agile = require('../agile');
  const oldLoad = storage.loadAgileCredentials;
  const oldFetch = global.fetch;
  const requests = [];
  try {
    storage.loadAgileCredentials = () => ({
      client_id:'LOCAL-TEST-ID', client_secret:'LOCAL-TEST-SECRET'
    });
    global.fetch = async (url, opts) => {
      requests.push({ url, ...opts });
      if (url.endsWith('/api/usuario/login')) {
        return { ok:true, status:200, json:async()=>({
          Token:'JWT-TEST-ONLY', Expiration:3600
        }) };
      }
      if (url.includes('/erp_pedidos_produtos')) {
        return { ok:true, status:200, json:async()=>({
          data:[
            { id_pedido_erp:'67890', id_produto:'4702', quantidade:'2',
              descricao_produto_snapshot:'Ketchup', valor_total:'25.50' },
            { id_pedido_erp:'OTHER-CLIENT', id_produto:'333',
              descricao_produto_snapshot:'Another customer product' }
          ],meta:{total:406532}
        }) };
      }
      if (url.includes('/erp_pedidos')) {
        return { ok:true, status:200, json:async()=>({
          data:[
            { id:'ERP-INTERNAL-1', codigo_cliente_erp:'12678',
              id_pedido_erp:'67890', id_transacao_venda:'TX1',
              status_erp:'em_separacao', data_cancelamento:'2026-10-15' },
            { id:'ERP-INTERNAL-2', codigo_cliente_erp:'12678',
              id_pedido_erp:'67891', status_erp:'em_separacao' },
            { id:'ERP-OTHER', codigo_cliente_erp:'88888',
              id_pedido_erp:'99999', telefone:'SECRET-PII' }
          ],meta:{total:3}
        }) };
      }
      throw new Error('Unexpected Agile path: ' + url);
    };
    agile.resetSession();
    const result = await agile.diagnose();
    assert.equal(requests.length, 3); // login, ERP orders, products
    assert.equal(requests[0].url,
      'https://api-integracao.agileecommerce.com.br/api/usuario/login');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[1].headers.Authorization, 'Bearer JWT-TEST-ONLY');
    assert.equal(requests.some(r => /\/integracao\/pedidos\?/.test(r.url)), false);
    assert.equal(result.connected, true);
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].totem_found, 2);
    assert.equal(result.sources[0].cancelled, 1);
    assert.equal(result.sources[0].awaiting_verification, 1);
    assert.equal(result.orders[0].erp_order, '67890');
    assert.equal(result.orders[0].transaction, 'TX1');
    assert.equal(result.orders[0].cancelled, true);
    assert.equal(result.orders[0].print_eligible, false);
    assert.equal(result.orders[1].print_eligible, false);
    assert.equal(result.itemSample.count, 1);
    assert.equal(JSON.stringify(result).includes('SECRET-PII'), false);
    assert.deepEqual(await agile.itemsForOrder(result.orders[0]), [{
      product_id:'4702', product_name:'Ketchup',
      quantity:'2', price:'', value:'25.50'
    }]);
  } finally {
    storage.loadAgileCredentials = oldLoad;
    global.fetch = oldFetch;
    agile.resetSession();
  }
});

test('Cancel date overrides stale em_separacao and only confirmed ERP statuses print', () => {
  const agile = require('../agile');
  const canceled = agile.safeTotemOrder({
    id:'1',codigo_cliente_erp:'12678',id_pedido_erp:'1960009389',
    status_erp:'em_separacao',data_cancelamento:'2026-10-15T10:22:00'
  });
  assert.equal(canceled.cancelled, true);
  assert.equal(canceled.print_eligible, false);
  const uncertain = agile.safeTotemOrder({
    id:'2',codigo_cliente_erp:'12678',id_pedido_erp:'1960009399',
    status_erp:'em_separacao',data_cancelamento:null
  });
  assert.equal(uncertain.cancelled, false);
  assert.equal(uncertain.print_eligible, false);
  const confirmed = agile.safeTotemOrder({
    id:'3',codigo_cliente_erp:'12678',id_pedido_erp:'1960009485',
    status_erp:'confirmado',data_cancelamento:null
  });
  assert.equal(confirmed.print_eligible, true);
  assert.equal(agile.safeTotemOrder({
    id:'4',codigo_cliente_erp:'7777',status_erp:'confirmado'
  }), null);
});

test('direct Agile transport uses strict TLS and old proxy default is disabled', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const agileSource = fs.readFileSync(path.join(__dirname, '..', 'agile.js'), 'utf8');
  assert.match(source, /return false;\s*\n\s*}/);
  assert.match(agileSource, /redirect: 'error'/);
  assert.doesNotMatch(agileSource, /rejectUnauthorized:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('admin provides both Agile credential fields and explicit read-only connection test', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell/index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const id of ['agile-client-id', 'agile-client-secret', 'agile-save', 'agile-test']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /id="agile-client-secret" type="password"/);
  for (const route of ['admin:agile-status', 'admin:agile-save', 'admin:agile-test']) {
    assert.match(main, new RegExp("case '" + route + "': \\{\\s*if \\(screen !== 'printers'\\)"));
  }
  assert.match(main, /storage\.saveAgileCredentials\(payload\?\.clientId, payload\?\.clientSecret\)/);
  assert.doesNotMatch(main, /console\.(log|info)\([^\n]*clientSecret/);
});
