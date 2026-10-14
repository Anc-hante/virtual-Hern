'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { printWithWindows, SCRIPT_PATH } = require('../windows-printer');

function mockSpooler(options = {}) {
  const calls = [];
  function spawnFn(executable, args, config) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.kill = () => {};
    child.stdin.end = data => {
      calls.push({
        executable, args, config,
        payload: JSON.parse(data)
      });
      process.nextTick(() => {
        if (options.fail) {
          child.stderr.emit('data', Buffer.from('A impressora nao esta pronta.'));
          child.emit('close', 1);
        } else {
          child.stdout.emit('data', Buffer.from('PRINT_SUBMITTED\n'));
          child.emit('close', 0);
        }
      });
    };
    return child;
  }
  return { calls, spawnFn };
}

test('ELGIN i8 uses Windows PowerShell printer driver, not Chromium HTML', async () => {
  const mock = mockSpooler();
  const result = await printWithWindows('ELGIN i8', 'CUPOM TESTE\nR$ 10,00', {
    platform: 'win32', spawnFn: mock.spawnFn
  });
  assert.equal(result.status, 'queued');
  assert.equal(mock.calls.length, 1);
  const request = mock.calls[0];
  assert.equal(request.executable, 'powershell.exe');
  assert.equal(request.payload.printerName, 'ELGIN i8');
  assert.equal(request.payload.text, 'CUPOM TESTE\nR$ 10,00');
  assert.equal(request.config.windowsHide, true);
  const script = Buffer.from(request.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /System\.Drawing\.Printing\.PrintDocument/);
  assert.match(script, /IsValid/);
  assert.doesNotMatch(script, /data:text\/html/);
});

test('printing accepts customer Unicode, quotes and text without command injection', async () => {
  const mock = mockSpooler();
  const malicious = 'João "da Silva"  São Paulo\n<script>alert(1)</script>\n$Env:PATH';
  await printWithWindows('ELGIN i8', malicious, {
    platform: 'win32', spawnFn: mock.spawnFn
  });
  assert.equal(mock.calls[0].payload.text, malicious);
  const script = Buffer.from(mock.calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.doesNotMatch(script, /João|<script>|PATH/);
});

test('printer driver errors are reported instead of falsely confirming printing', async () => {
  const mock = mockSpooler({ fail: true });
  await assert.rejects(
    printWithWindows('ELGIN i8', 'Teste', {
      platform: 'win32', spawnFn: mock.spawnFn
    }),
    /O Windows não conseguiu imprimir na ELGIN i8/
  );
});

test('print method refuses empty receipts or missing printer', async () => {
  await assert.rejects(printWithWindows('', 'Teste'), /Selecione uma impressora/);
  await assert.rejects(printWithWindows('ELGIN i8', '   '), /cupom está vazio/);
});

test('native spooler script is shipped with the application', () => {
  assert.ok(fs.existsSync(SCRIPT_PATH));
  const printerSource = fs.readFileSync(
    path.join(__dirname, '..', 'printer.js'), 'utf8'
  );
  assert.match(printerSource, /printWithWindows\(printerName, content\)/);
  assert.doesNotMatch(printerSource, /new BrowserWindow|loadFile|loadURL|receiptTextScript/);
});
