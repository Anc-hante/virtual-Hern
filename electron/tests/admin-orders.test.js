'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('local kiosk admin exposes orders only after successful admin login', () => {
  const main = read('main.js');
  assert.match(main, /case 'admin:orders':\s*\{\s*if \(screen !== 'printers'\)/);
  assert.match(main, /case 'admin:reprint':\s*\{\s*if \(screen !== 'printers'\)/);
  assert.match(main, /const chosen = storage\.selectedPrinter\(\)/);
  assert.match(main, /api\.orderHistory\(payload\?\.search, payload\?\.offset\)/);
  assert.match(main, /api\.requestReprint\(payload\?\.orderId\)/);
  assert.match(main, /if \(worker\) void worker\.tick\(\)/);
});

test('history and reprint use exact device-bound backend paths', () => {
  const api = read('api.js');
  assert.match(api, /request\('\/printer\/history'/);
  assert.match(api, /request\('\/printer\/reprint'/);
  assert.match(api, /device_id: DEVICE/);
  assert.match(api, /order_id: String\(orderId \|\| ''\)/);
});

test('touch admin offers deliberate confirmation, search and pagination', () => {
  const html = read('shell/index.html');
  const renderer = read('shell/renderer.js');
  for (const id of [
    'admin-tab-orders', 'orders-search', 'orders-search-button',
    'orders-confirm', 'orders-confirm-button', 'orders-cancel',
    'orders-prev', 'orders-next'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(renderer, /showOrderConfirmation\(order\)/);
  assert.match(renderer, /selectedOrder = null/);
  assert.match(renderer, /statusLabel\(order\.print_status\)/);
  assert.match(renderer, /button\.disabled = !order\.reprint_allowed/);
  assert.match(renderer, /orderOffset \+ 25/);
  assert.match(renderer, /window\.__hernandesHideKeyboard\?\.\(\)/);
});
