'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../api');
const storage = require('../storage');

test('internal HTTPS exception is disabled by default and never affects other API hosts', () => {
  const old = storage.allowInternalCertificate;
  try {
    storage.allowInternalCertificate = () => false;
    assert.equal(api.canUseInternalCertificate(), false);
    storage.allowInternalCertificate = () => true;
    assert.equal(api.canUseInternalCertificate('https://attacker.example:3000/api/ecommerce/totem'), false);
    assert.equal(api.canUseInternalCertificate('http://hernandesvpn.dyndns.org:3000/api/ecommerce/totem'), false);
    assert.equal(
      api.canUseInternalCertificate('https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem'),
      process.platform === 'win32'
    );
  } finally {
    storage.allowInternalCertificate = old;
  }
});

test('insecure transport is restricted to HTTPS totem path on the exact company server', async () => {
  await assert.rejects(
    api.postWithInternalCertificate('https://other.example:3000/api/ecommerce/totem/printer/history', {}, '{}'),
    /Excecao de certificado nao autorizada/
  );
  await assert.rejects(
    api.postWithInternalCertificate('http://hernandesvpn.dyndns.org:3000/api/ecommerce/totem/printer/history', {}, '{}'),
    /Excecao de certificado nao autorizada/
  );
  await assert.rejects(
    api.postWithInternalCertificate('https://hernandesvpn.dyndns.org:3000/api/ecommerce/other', {}, '{}'),
    /Excecao de certificado nao autorizada/
  );

  const original = https.request;
  let actual;
  let jsonBody;
  try {
    https.request = (options, onResponse) => {
      actual = options;
      const req = new EventEmitter();
      req.end = body => {
        jsonBody = body;
        const res = new EventEmitter();
        res.statusCode = 200;
        process.nextTick(() => {
          onResponse(res);
          res.emit('data', Buffer.from('{"ok":true,"orders":[]}'));
          res.emit('end');
        });
      };
      return req;
    };
    const response = await api.postWithInternalCertificate(
      'https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem/printer/history',
      { 'X-Totem-Token': 'private-mocked-only' },
      '{"device_id":"TOTEM-TEST"}'
    );
    assert.equal(actual.rejectUnauthorized, false);
    assert.equal(actual.hostname, 'hernandesvpn.dyndns.org');
    assert.equal(actual.port, 3000);
    assert.equal(actual.path, '/api/ecommerce/totem/printer/history');
    assert.equal(actual.method, 'POST');
    assert.equal(actual.headers['X-Totem-Token'], 'private-mocked-only');
    assert.equal(jsonBody, '{"device_id":"TOTEM-TEST"}');
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), { ok: true, orders: [] });
  } finally {
    https.request = original;
  }
});

test('the certificate exception is admin-gated, with clear warning, no global TLS bypass', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  assert.match(main, /case 'admin:api-certificate-mode':\s*\{\s*if \(screen !== 'printers'\)/);
  assert.match(main, /storage\.setInternalCertificateMode\(payload\.enabled\)/);
  assert.match(html, /id="api-internal-cert-mode"/);
  assert.match(html, /id="api-cert-mode-save"/);
  assert.match(html, /somente testes na rede da empresa/);
  assert.doesNotMatch(client, /NODE_TLS_REJECT_UNAUTHORIZED\s*=/);
  assert.doesNotMatch(main, /ignore-certificate-errors/);
});
