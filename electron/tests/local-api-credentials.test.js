'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('API token is encrypted on disk, never stored as plain text', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'hernandes-token-test-'));
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  const modulePath = require.resolve('../storage');
  delete require.cache[modulePath];

  const secret = 'TEST-TOKEN-PRIVATE-12345678';
  const protector = {
    isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from('TEST-PROTECTED:' + Buffer.from(text).toString('base64')),
    decryptString: value => Buffer.from(
      value.toString().replace(/^TEST-PROTECTED:/, ''),
      'base64'
    ).toString('utf8')
  };
  try {
    const storage = require('../storage');
    storage.saveAgentToken(secret, protector);
    const data = fs.readFileSync(storage.agentTokenFile);
    assert.equal(storage.loadAgentToken(protector), secret);
    assert.equal(data.includes(Buffer.from(secret)), false);
    assert.ok(data.length > 16);
    assert.throws(() => storage.saveAgentToken('short', protector), /token valido/);
    assert.ok(!fs.existsSync(path.join(storage.folder, 'api-token.txt')));
  } finally {
    delete require.cache[modulePath];
    if (old === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = old;
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test('API admin credential controls are protected and secrets are not echoed', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'shell', 'renderer.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  for (const action of ['admin:api-status', 'admin:api-save', 'admin:api-test']) {
    const matcher = new RegExp("case '" + action + "': \\{\\s*if \\(screen !== 'printers'\\)");
    assert.match(main, matcher);
  }
  assert.match(main, /storage\.saveAgentToken\(payload\?\.token\)/);
  assert.doesNotMatch(main, /console\.(log|info|debug)\([^\n]*payload\?\.token/);
  assert.match(api, /storage\.loadAgentToken\(\)/);
  assert.match(api, /'X-Totem-Token'/);
  assert.match(html, /id="api-token-input" type="password"/);
  assert.match(renderer, /'admin:api-save'/);
  assert.match(renderer, /'admin:api-test'/);
  assert.match(renderer, /\$\('api-token-input'\)\.value = ''/);
});
