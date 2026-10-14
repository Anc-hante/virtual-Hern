'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, 'printing', 'print-receipt.ps1');
const PRINT_TIMEOUT_MS = 45000;

// Use the Windows printer spooler directly. No hidden Electron/Chromium
// BrowserWindow or HTML loading is involved in receipt printing.
function printWithWindows(printerName, receiptText, options = {}) {
  const name = String(printerName ?? '').trim();
  const text = String(receiptText ?? '').slice(0, 30000);

  if (!name) return Promise.reject(new Error('Selecione uma impressora.'));
  if (!text.trim()) return Promise.reject(new Error('O cupom está vazio.'));
  const qrPngBase64 = String(options.qrPngBase64 || '');
  if (qrPngBase64 && !/^[a-zA-Z0-9+/=]+$/.test(qrPngBase64)) {
    return Promise.reject(new Error('O QR Code do cupom está inválido.'));
  }
  if ((options.platform || process.platform) !== 'win32') {
    return Promise.reject(new Error('A impressão direta exige Windows.'));
  }

  const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const executable = options.spawnFn || spawn;

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timeout;

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }

    let child;
    try {
      child = executable('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', command
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      fail(new Error('Não foi possível iniciar a impressão do Windows: ' + error.message));
      return;
    }

    timeout = setTimeout(() => {
      child.kill();
      fail(new Error('A impressão demorou demais. Verifique a fila da impressora no Windows.'));
    }, PRINT_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout?.on('data', chunk => {
      stdout = (stdout + String(chunk)).slice(-8192);
    });
    child.stderr?.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-8192);
    });

    child.on('error', error => fail(
      new Error('Não foi possível acessar a impressão do Windows: ' + error.message)
    ));
    child.on('close', code => {
      if (settled) return;
      clearTimeout(timeout);
      settled = true;
      if (code === 0 && stdout.includes('PRINT_SUBMITTED')) {
        resolve({ status: 'queued', printerName: name });
        return;
      }

      // Do not leak entire scripts, encoded HTML or system paths into the
      // touch-screen message.
      const detail = (stderr || stdout)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(-2)
        .join(' ')
        .slice(0, 300);

      reject(new Error(
        'O Windows não conseguiu imprimir na ' + name +
        (detail ? ': ' + detail : '. Verifique a impressora e o driver.')
      ));
    });

    child.stdin?.on('error', error => {
      fail(new Error('Falha ao enviar os dados do cupom para o Windows: ' + error.message));
    });
    child.stdin?.end(JSON.stringify({ printerName: name, text, qrPngBase64 }), 'utf8');
  });
}

module.exports = { printWithWindows, SCRIPT_PATH };
