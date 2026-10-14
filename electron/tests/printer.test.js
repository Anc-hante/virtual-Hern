'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const printerPath = path.join(__dirname, '..', 'printer.js');
const htmlPath = path.join(__dirname, '..', 'receipt.html');

function loadWithFakePrinter({ failLoad = false } = {}) {
  const received = {
    loadFile: null,
    data: '',
    options: null,
    destroyed: false
  };

  class MockWindow {
    constructor() {
      this.webContents = {
        executeJavaScript: async (script) => {
          if (script.includes('document.fonts.ready')) return true;
          const document = {
            getElementById(id) {
              assert.equal(id, 'receipt');
              return {
                set textContent(value) { received.data = value; }
              };
            }
          };
          return vm.runInNewContext(script, { document });
        },
        print(options, callback) {
          received.options = options;
          callback(true);
        }
      };
    }
    async loadFile(file) {
      received.loadFile = file;
      if (failLoad) throw new Error('ERR_FAILED (-2) loading data:text/html,...');
    }
    isDestroyed() { return received.destroyed; }
    destroy() { received.destroyed = true; }
  }

  const mod = new Module(printerPath);
  mod.filename = printerPath;
  mod.paths = Module._nodeModulePaths(path.dirname(printerPath));
  const nativeRequire = mod.require.bind(mod);
  mod.require = (name) => {
    if (name === 'electron') return { BrowserWindow: MockWindow };
    if (name === './api') return {};
    if (name === './storage') return {};
    return nativeRequire(name);
  };
  mod._compile(fs.readFileSync(printerPath, 'utf8'), printerPath);
  return { printer: mod.exports, received };
}

test('receipt renders from local file, not a data URL, on ELGIN i8', async () => {
  assert.equal(fs.existsSync(htmlPath), true);
  const { printer, received } = loadWithFakePrinter();
  await printer.printTest('ELGIN i8');
  assert.equal(received.loadFile, htmlPath);
  assert.match(received.data, /ELGIN i8/);
  assert.match(received.data, /TESTE DE IMPRESSAO/);
  assert.equal(received.options.deviceName, 'ELGIN i8');
  assert.equal(received.options.silent, true);
  assert.equal(received.options.pageSize.width, 80000);
  assert.equal(received.destroyed, true);
});

test('remote receipt is inserted as inert text, not HTML or JavaScript', async () => {
  const { printer, received } = loadWithFakePrinter();
  const malicious = '<script>alert("x")</script> & café \\u263A';
  await printer.printReceipt('ELGIN i8', malicious);
  assert.equal(received.data, malicious);
  assert.equal(received.loadFile, htmlPath);
});

test('loading error is short and does not show encoded HTML to customer', async () => {
  const { printer, received } = loadWithFakePrinter({ failLoad: true });
  await assert.rejects(
    printer.printTest('ELGIN i8'),
    (error) => {
      assert.match(error.message, /Não foi possível preparar o cupom/);
      assert.doesNotMatch(error.message, /data:text\/html|ERR_FAILED/);
      return true;
    }
  );
  assert.equal(received.destroyed, true);
});

test('blank receipt fails before making a print job', async () => {
  const { printer, received } = loadWithFakePrinter();
  await assert.rejects(printer.printReceipt('ELGIN i8', '   '), /cupom está vazio/);
  assert.equal(received.loadFile, null);
});
