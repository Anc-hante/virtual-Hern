'use strict';
const { BrowserWindow } = require('electron');
const path = require('node:path');
const storage = require('./storage');
const api = require('./api');

const RECEIPT_TEMPLATE = path.join(__dirname, 'receipt.html');

// Set plain text into a local, static document. Do not navigate to data:
// URLs: those fail with ERR_FAILED (-2) on some Windows/Electron setups.
function receiptTextScript(content) {
  const text = String(content ?? '').slice(0, 30000);
  return 'document.getElementById("receipt").textContent = ' +
    JSON.stringify(text) + ';';
}
async function installedPrinters(contents) {
  return contents.getPrintersAsync();
}
async function printReceipt(printerName, content) {
  if (!printerName) throw new Error('Nenhuma impressora selecionada.');
  const text = String(content ?? '').slice(0, 30000);
  if (!text.trim()) throw new Error('O cupom está vazio. Verifique os dados do pedido.');
  const lineCount = text.split(/\r?\n/).length;
  const paperHeight = Math.min(500000, Math.max(100000, (lineCount + 7) * 4000));
  const win = new BrowserWindow({
    show: false, width: 340, height: 600,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  });
  try {
    // A bundled file is available offline and avoids Chromium navigation
    // failures caused by loading percent-encoded HTML via a data: URL.
    try {
      await win.loadFile(RECEIPT_TEMPLATE);
      await win.webContents.executeJavaScript(receiptTextScript(text));
      await win.webContents.executeJavaScript(
        'document.fonts.ready.then(() => true)'
      );
    } catch (cause) {
      console.error('[Totem] Falha ao preparar o documento do cupom:', cause);
      throw new Error(
        'Não foi possível preparar o cupom. Atualize o aplicativo e tente novamente.'
      );
    }
    await new Promise((resolve, reject) => {
      win.webContents.print({
        silent: true,
        deviceName: printerName,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: paperHeight }
      }, (success, failureReason) => {
        if (success) resolve();
        else reject(new Error(failureReason || 'Não foi possível enviar o cupom à impressora.'));
      });
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
async function printTest(printerName) {
  const lines = [
    'HERNANDES ATACADO E DISTRIBUICAO',
    'TESTE DE IMPRESSAO - TOTEM',
    '------------------------------------------',
    'Impressora: ' + printerName,
    'Data: ' + new Date().toLocaleString('pt-BR'),
    '',
    'Se este cupom saiu corretamente,',
    'a impressora foi selecionada.',
    '',
    '------------------------------------------',
    '',
    '', ''
  ];
  await printReceipt(printerName, lines.join('\n'));
}

class PrintWorker {
  constructor(contents) {
    this.contents = contents;
    this.timer = null;
    this.busy = false;
    this.lastPrinterName = '';
    this.printerAvailable = false;
    this.nextPrinterCheck = 0;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 6000);
    // First poll is delayed to allow storefront to initialize.
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const chosen = storage.selectedPrinter() ||
        process.env.HERNANDES_TOTEM_PRINTER_NAME || '';
      if (!chosen) return;
      if (chosen !== this.lastPrinterName || Date.now() >= this.nextPrinterCheck) {
        const printers = await installedPrinters(this.contents);
        this.printerAvailable = printers.some(p => p.name === chosen);
        this.lastPrinterName = chosen;
        this.nextPrinterCheck = Date.now() + 60000;
      }
      if (!this.printerAvailable) return;

      await api.flush();
      const job = await api.claim();
      if (!job) return;

      // Do not acknowledge as printed if the driver rejects the job.
      try {
        await printReceipt(chosen, job.receipt_text);
        await api.complete(job.job_id, true);
      } catch (e) {
        try { await api.complete(job.job_id, false, e.message); } catch (_) {}
      }
    } catch (e) {
      console.warn('[Totem] Fila de impressão indisponível:', e.message);
    } finally {
      this.busy = false;
    }
  }
}
module.exports = {
  installedPrinters,
  printReceipt,
  printTest,
  PrintWorker,
  receiptTextScript
};
