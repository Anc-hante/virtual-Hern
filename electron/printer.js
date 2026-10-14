'use strict';
const { BrowserWindow } = require('electron');
const storage = require('./storage');
const api = require('./api');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
async function installedPrinters(contents) {
  return contents.getPrintersAsync();
}
async function printReceipt(printerName, content) {
  if (!printerName) throw new Error('Nenhuma impressora selecionada.');
  // The host never executes code received from a remote receipt.
  const receipt = escapeHtml(String(content || '').slice(0, 30000));
  const lineCount = String(content || '').split(/\r?\n/).length;
  const paperHeight = Math.min(500000, Math.max(100000, (lineCount + 7) * 4000));
  const win = new BrowserWindow({
    show: false, width: 340, height: 600,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  });
  try {
    const document = `<!doctype html><html><head><meta charset="utf-8">
      <style>@page{size:80mm auto;margin:0}
      html,body{margin:0;padding:0;background:white;color:black}
      pre{margin:0;padding:2mm 2mm 8mm;white-space:pre-wrap;overflow-wrap:anywhere;
      font:10px/1.45 "Consolas","Courier New",monospace}</style>
      </head><body><pre>${receipt}</pre></body></html>`;
    await win.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(document));
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
      const printers = await installedPrinters(this.contents);
      if (!printers.some(p => p.name === chosen)) return;

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
module.exports = { installedPrinters, printReceipt, printTest, PrintWorker };
