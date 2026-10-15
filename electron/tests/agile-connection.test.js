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

test('Agile test uses JWT and reads orders without exposing other customers', async () => {
  const storage = require('../storage');
  const agile = require('../agile');
  const oldLoad = storage.loadAgileCredentials;
  const oldFetch = global.fetch;
  const requests = [];
  try {
    storage.loadAgileCredentials = () => ({ client_id:'LOCAL-TEST-ID', client_secret:'LOCAL-TEST-SECRET' });
    global.fetch = async (url, opts) => {
      requests.push({ url, ...opts });
      if (url.endsWith('/api/usuario/login')) {
        return { ok: true, status: 200, json: async () => ({
          Token: 'JWT-TEST-ONLY', Expiration: 3600
        }) };
      }
      return { ok: true, status: 200, json: async () => ({
        data: [
          { id_pedido: 'AGILE-1', codcli: '12678', pedido_erp: '', status: 'aberto' },
          { id_pedido: 'OTHER-SECRET', codcli:'88888', telefone:'00000' }
        ],
        meta: { total: 2 }
      }) };
    };
    agile.resetSession();
    const result = await agile.testConnection();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://api-integracao.agileecommerce.com.br/api/usuario/login');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[1].method, 'GET');
    assert.equal(requests[1].headers.Authorization, 'Bearer JWT-TEST-ONLY');
    assert.equal(result.totemOrders.length, 1);
    assert.equal(result.totemOrders[0].agile_id, 'AGILE-1');
    assert.equal(JSON.stringify(result).includes('OTHER-SECRET'), false);
    assert.equal(JSON.stringify(result).includes('00000'), false);
    assert.ok(!result.availableFields.includes('telefone'));
  } finally {
    storage.loadAgileCredentials = oldLoad;
    global.fetch = oldFetch;
    agile.resetSession();
  }
});

test('internal certificate pilot defaults to company API only and can be disabled', () => {
  const pathSource = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  assert.match(pathSource, /return true;\s*\n\s*}/); // Corporate HTTPS default
  assert.match(apiSource, /base === INTERNAL_CERT_BASE/);
  assert.doesNotMatch(apiSource, /NODE_TLS_REJECT_UNAUTHORIZED\s*=/);
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
