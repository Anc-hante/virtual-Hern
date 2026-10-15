'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const api = require('../api');
const storage = require('../storage');

test('Hernandes API 429 respects retry-after and does not hammer printer/history endpoints', async () => {
  const oldFetch = global.fetch;
  const oldRead = storage.loadAgentToken;
  let calls = 0;
  try {
    storage.loadAgentToken = () => 'TEST-NOT-REAL';
    global.fetch = async () => {
      calls++;
      return {
        status: 429, ok: false,
        headers: { get: name => name === 'retry-after' ? '30' : null }
      };
    };
    await assert.rejects(() => api.orderHistory(), /429.*30 segundo/);
    assert.equal(calls, 1);
    await assert.rejects(() => api.orderHistory(), /temporariamente limitada.*429/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = oldFetch;
    storage.loadAgentToken = oldRead;
  }
});

test('rate-limited HTTPS shim forwards response headers including retry-after', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
  assert.match(source, /res\.headers\?\.\[String\(name\)\.toLowerCase\(\)\]/);
  assert.match(source, /const seconds = rateLimitSeconds\(response\)/);
  assert.match(source, /rateLimitedUntil = Date\.now\(\) \+ seconds \* 1000/);
});
