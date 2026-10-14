'use strict';
const { printWithWindows } = require('./windows-printer');
const storage = require('./storage');
const api = require('./api');

async function installedPrinters(contents) {
  return contents.getPrintersAsync();
}
async function printReceipt(printerName, content) {
  // Use the installed Windows printer driver (ELGIN i8 included) instead
  // of a hidden Chromium page. Both test and automatic receipts share
  // this exact printing path.
  await printWithWindows(printerName, content);
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
  printWithWindows
};
