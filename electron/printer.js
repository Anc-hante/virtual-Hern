'use strict';
const qrcode = require('qrcode');
const { printWithWindows } = require('./windows-printer');
const { REGISTER_URL, sampleReceipt, checkRealOrder } = require('./receipt-format');
const storage = require('./storage');
const api = require('./api');

let qrPromise = null;
function getQrPng() {
  if (!qrPromise) {
    qrPromise = qrcode.toBuffer(REGISTER_URL, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 440,
      color: { dark: '#000000', light: '#FFFFFFFF' }
    }).then(buffer => buffer.toString('base64'));
    qrPromise.catch(() => { qrPromise = null; });
  }
  return qrPromise;
}
async function receiptPreview() {
  const image = await getQrPng();
  return {
    text: sampleReceipt(),
    qrUrl: REGISTER_URL,
    qrDataUrl: 'data:image/png;base64,' + image,
    example: true
  };
}

async function installedPrinters(contents) {
  return contents.getPrintersAsync();
}
async function printReceipt(printerName, content) {
  const qrPngBase64 = await getQrPng();
  await printWithWindows(printerName, content, { qrPngBase64 });
}
async function printTest(printerName) {
  await printReceipt(printerName, sampleReceipt());
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

      try {
        checkRealOrder(job);
        await printReceipt(chosen, job.receipt_text);
        await api.complete(job.job_id, true);
      } catch (e) {
        console.error('[Totem] Falha na impressao do pedido:', e.message);
        try { await api.complete(job.job_id, false, e.message); } catch (_) {}
      }
    } catch (e) {
      console.warn('[Totem] Fila de impressao indisponivel:', e.message);
    } finally {
      this.busy = false;
    }
  }
}
module.exports = {
  installedPrinters, printReceipt, printTest, receiptPreview,
  PrintWorker, printWithWindows, getQrPng
};
