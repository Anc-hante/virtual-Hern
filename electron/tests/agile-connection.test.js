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

test('Agile diagnosis prefers pedidos for customer 12678 and keeps ERP optional', async () => {
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
      requests.push({ url:String(url), ...opts });
      const target = String(url);
      if (target.endsWith('/api/usuario/login')) {
        return { ok:true, status:200, json:async()=>({
          Token:'JWT-TEST-ONLY', Expiration:'2099-01-01T00:00:00.000Z'
        }) };
      }
      if (target.includes('/integracao/clientes?')) {
        return { ok:true, status:200, json:async()=>({
          data:[
            { id:'01450747221', codigo:'12678', cpf:'014.507.472-21', telefone:'SECRET-PII' },
            { id:'44444444444', codigo:'12678', cpf:'444.444.444-44' }
          ], meta:{total:2}
        }) };
      }
      if (target.includes('/integracao/pedidos?')) {
        return { ok:true, status:200, json:async()=>({
          data:[
            { id:'1000018742', id_cliente:'44444444444', confirmado:true,
              status:'recebido', valor_total:159.99, id_transacao:'1000018742', codigo:null },
            { id:'1000018740', id_cliente:'44444444444', confirmado:true,
              status:'cancelado', cancelado:true, valor_total:159.99 }
          ], meta:{total:2}
        }) };
      }
      if (target.includes('/integracao/pedidos_produtos?')) {
        return { ok:true, status:200, json:async()=>({
          data:[{ id_pedido:'1000018742', id_produto:'7993', quantidade:1,
            valor_total:159.99, json:'{"nome":"MARGARINA ELOGIATA BALDE-15KG 60%"}' }],
          meta:{total:1}
        }) };
      }
      if (target.includes('/integracao/erp_pedidos')) {
        return { ok:false, status:404, json:async()=>({ message:'missing' }) };
      }
      throw new Error('Unexpected Agile path: ' + target);
    };
    agile.resetSession();
    const result = await agile.diagnose();
    assert.equal(requests[0].url,
      'https://api-integracao.agileecommerce.com.br/api/usuario/login');
    assert.equal(requests[0].redirect, 'error');
    const pedidos = requests.find(r => /\/integracao\/pedidos\?/.test(r.url));
    assert.ok(pedidos);
    assert.match(pedidos.url, /id_cliente=44444444444/);
    assert.match(pedidos.url, /sort=data/);
    assert.match(pedidos.url, /order=DESC/);
    assert.match(pedidos.url, /limit=5/);
    assert.equal(pedidos.headers.Authorization, 'Bearer JWT-TEST-ONLY');
    assert.equal(result.connected, true);
    assert.equal(result.orders[0].agile_id, '1000018742');
    assert.equal(result.orders[0].print_eligible, true);
    assert.equal(result.orders[0].erp_order, '');
    assert.equal(result.orders[1].print_eligible, false);
    assert.equal(result.itemSample.count, 1);
    assert.equal(result.itemSample.items[0].product_name, 'MARGARINA ELOGIATA BALDE-15KG 60%');
    assert.equal(JSON.stringify(result).includes('SECRET-PII'), false);
    assert.equal(result.sources.some(s => s.resource === 'erp_pedidos' && s.optional && !s.ok), true);
  } finally {
    storage.loadAgileCredentials = oldLoad;
    global.fetch = oldFetch;
    agile.resetSession();
  }
});

test('Cancelled records are blocked; pending ERP status does not block an Agile receipt', () => {
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
  assert.equal(uncertain.print_eligible, true);
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
