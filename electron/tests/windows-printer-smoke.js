'use strict';

// Windows CI smoke test: execute real Windows PowerShell and System.Drawing
// initialization, but deliberately select a nonexistent printer so no
// physical paper or Microsoft Print to PDF dialog is ever triggered.
const { printWithWindows } = require('../windows-printer');

(async () => {
  if (process.platform !== 'win32') {
    console.log('Windows smoke test skipped (non-Windows host).');
    return;
  }
  try {
    await printWithWindows(
      'HERNANDES_NONEXISTENT_PRINTER_FOR_CI',
      'CUPOM DE VALIDACAO\nSEM IMPRESSAO REAL'
    );
    console.error('ERROR: nonexistent printer was accepted.');
    process.exitCode = 1;
  } catch (error) {
    if (/Impressora nao disponivel no Windows/.test(error.message)) {
      console.log('Windows PrintDocument initialized and rejected nonexistent printer as expected.');
      return;
    }
    console.error('Windows native print initialization failed unexpectedly:', error.message);
    process.exitCode = 1;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
