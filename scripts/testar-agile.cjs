#!/usr/bin/env node
'use strict';
// Private local-only production read test. Uses credentials from .env loaded
// by "node --env-file=.env scripts/testar-agile.cjs" (Node.js >= 20.6).
// This does NOT create an order, print, or send credentials to GitHub.
const storage = require('../electron/storage');
const agile = require('../electron/agile');

const id = String(process.env.AGILE_CLIENT_ID || '').trim();
const secret = String(process.env.AGILE_CLIENT_SECRET || '').trim();

if (!id || !secret) {
  process.stderr.write('Faltam AGILE_CLIENT_ID e AGILE_CLIENT_SECRET no ambiente privado.\n');
  process.exitCode = 2;
} else {
  // Replace DPAPI lookup for this one-off local test only; no disk write.
  storage.loadAgileCredentials = () => ({client_id:id, client_secret:secret});
  (async () => {
    try {
      const report = await agile.diagnose();
      process.stdout.write('Agile: ' + (report.connected ? 'LOGIN E CONSULTA OK' : 'CONSULTA FALHOU') + '\n');
      for (const source of report.sources || []) {
        process.stdout.write(
          source.resource + ' - ' + (source.ok
            ? ('HTTP OK; amostra=' + source.checked +
              '; pedidos do totem 12678=' + (source.totem_found || 0))
            : source.error) + '\n'
        );
      }
      for (const order of (report.orders || []).slice(0,5)) {
        process.stdout.write(
          'Pedido Agile=' + order.agile_id +
          ', NUMPED=' + (order.erp_order || 'ainda nao existe') +
          ', transacao=' + (order.transaction || 'nao informada') +
          ', status=' + (order.status || 'sem status') + '\n'
        );
      }
      if (report.itemSample) {
        process.stdout.write(
          'Itens encontrados na amostra=' + report.itemSample.count +
          (report.itemSample.error ? '; erro=' + report.itemSample.error : '') + '\n'
        );
      }
      if (!report.connected) process.exitCode = 1;
      process.stdout.write('Credenciais nao foram exibidas nem gravadas. Nenhum cupom foi impresso.\n');
    } catch (error) {
      process.stderr.write('Falha na API Agile: ' +
        String(error.message || 'erro desconhecido') + '\n');
      process.exitCode = 1;
    }
  })();
}
