'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('admin searches directly in Agile and reprints from local storage only', () => {
  const main = read('main.js');
  assert.match(main, /case 'admin:orders':\s*\{\s*if \(screen !== 'printers'\)/);
  assert.match(main, /case 'admin:reprint':\s*\{\s*if \(screen !== 'printers'\)/);
  assert.match(main, /agile\.list\('pedidos', \{\}, 1, 25\)/);
  assert.match(main, /agileHistory\.history\(/);
  assert.match(main, /agilePrint\.printOrder\(record, site\.webContents, \{ reprint:true \}\)/);
  assert.match(main, /new agilePrint\.AgilePrintWorker\(site\.webContents\)/);
  assert.doesNotMatch(main, /new printer\.PrintWorker\(site\.webContents\)/);
  assert.doesNotMatch(main, /api\.sendEvent\(/);
});

test('history comes from Agile local ledger, not HernandesDash HTTP paths', () => {
  const store = read('agile-history.js');
  const agile = read('agile.js');
  assert.match(store, /agile-print-history\.json/);
  assert.match(agile, /'erp_pedidos_produtos'/);
  assert.match(agile, /codigo_cliente_erp/);
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
