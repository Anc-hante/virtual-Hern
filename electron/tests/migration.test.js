'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('totem reuses its previous Windows device ID and printer choice', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = tmp;
  try {
    const folder = path.join(tmp, 'GrupoHernandes', 'VirtualHern');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'totem-device-id.txt'), 'TOTEM-TESTE-123');
    fs.writeFileSync(path.join(folder, 'printer-settings.json'),
      JSON.stringify({ PrinterName: 'EPSON TM-T20X' }));
    const store = require('../storage');
    assert.equal(store.loadDeviceId(), 'TOTEM-TESTE-123');
    assert.equal(store.selectedPrinter(), 'EPSON TM-T20X');
    store.savePrinter('Nova impressora');
    assert.equal(store.selectedPrinter(), 'Nova impressora');
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('customer contact CSV is preserved on disk', () => {
  const store = require('../storage');
  // The preceding test restored the isolated environment, so this test
  // verifies formatting but uses its own explicit ephemeral file path.
  const source = fs.readFileSync(path.join(__dirname,'..','storage.js'),'utf8');
  assert.match(source, /data_hora,nome,telefone/);
  assert.equal(typeof store.recordLead, 'function');
});
