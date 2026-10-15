'use strict';
// Standalone Agile => Windows printer workflow. Does not call HernandesDash.
const agile = require('./agile');
const ledger = require('./agile-history');
const printer = require('./printer');
const storage = require('./storage');

function clean(value) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
}
function money(input) {
  const source = clean(input);
  const raw = source.includes(',') ? source.replace(/\./g, '').replace(',', '.') : source;
  const amount = Number(raw) || 0;
  return amount.toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function receipt(order, items) {
  if (!order?.agile_id) throw new Error('Pedido sem ID Agile confirmado.');
  if (!Array.isArray(items) || !items.length) {
    throw new Error('O Agile ainda nao disponibilizou produtos deste pedido.');
  }
  const width = 40;
  const line = value => clean(value).slice(0, width);
  const lines = [
    'HERNANDES ATACADO E DISTRIBUICAO'.padStart(36),
    '='.repeat(width),
    'COMPROVANTE DE PEDIDO - TOTEM',
    '='.repeat(width),
    'PEDIDO AGILE: ' + line(order.agile_id),
  ];
  if (order.erp_order) lines.push('NUMPED WINTHOR: ' + line(order.erp_order));
  else lines.push('WINTHOR: AGUARDANDO INTEGRACAO');
  if (order.transaction) lines.push('TRANSACAO: ' + line(order.transaction));
  if (order.created_at) lines.push('DATA: ' + line(order.created_at));
  lines.push('CLIENTE WINTHOR: 12678', '-'.repeat(width), 'PRODUTOS DO PEDIDO', '-'.repeat(width));
  for (const item of items.slice(0, 100)) {
    lines.push(line([item.product_id, item.product_name].filter(Boolean).join(' ')));
    lines.push(line('Qtd: ' + (item.quantity || '?') + ' x R$ ' + money(item.price)));
    if (item.value) lines.push(line('  Total: R$ ' + money(item.value)));
  }
  lines.push('-'.repeat(width), 'TOTAL DO PEDIDO: R$ ' + money(order.amount),
    '='.repeat(width), 'OBRIGADO PELA SUA COMPRA!',
    'CADASTRE-SE NO GRUPO HERNANDES',
    'APONTE A CAMERA PARA O QR CODE', '');
  return lines.join('\n');
}
function isCancelled(order) {
  return /cancel|rejeitad|estornad|excluid/i.test(order.status || '');
}
async function printOrder(order, contents, { reprint = false } = {}) {
  if (!order || !order.agile_id) throw new Error('Pedido Agile invalido.');
  if (isCancelled(order)) throw new Error('Pedido Agile cancelado ou rejeitado.');
  const chosen = storage.selectedPrinter() || process.env.HERNANDES_TOTEM_PRINTER_NAME || '';
  if (!chosen) throw new Error('Salve a impressora antes de imprimir.');
  const available = await printer.installedPrinters(contents);
  if (!available.some(p => p.name === chosen)) {
    throw new Error('Impressora nao encontrada no Windows: ' + chosen);
  }
  const items = await agile.itemsForOrder(order);
  if (!items.length) {
    throw new Error('Itens ainda indisponiveis no Agile: nao e seguro imprimir cupom incompleto.');
  }
  const previous = ledger.get(order.agile_id);
  if (!reprint && previous?.print_count > 0)
    return { printed:false, duplicate:true };
  ledger.update(order, { print_status:'claimed' });
  try {
    await printer.printReceipt(chosen, receipt(order, items));
    const record = ledger.update(order, {
      print_status:'printed', print_count:(previous?.print_count || 0) + 1,
      last_printed_at:new Date().toISOString(), last_error:''
    });
    return { printed:true, order:record };
  } catch (e) {
    ledger.update(order, { print_status:'failed', last_error:e.message });
    throw e;
  }
}
class AgilePrintWorker {
  constructor(contents) {
    this.contents = contents;
    this.timer = null;
    this.busy = false;
    this.initialized = false;
    this.cooldownUntil = 0;
  }
  start() {
    if (this.timer) return;
    // Agile has its own rate limits. No 6-second polling.
    this.timer = setInterval(() => void this.tick(), 45000);
    void this.tick();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  async tick() {
    if (this.busy || Date.now() < this.cooldownUntil) return;
    this.busy = true;
    try {
      if (!agile.configured() || !storage.selectedPrinter()) return;
      const records = await agile.list('pedidos', {}, 1, 20);
      const current = records.data.map(r => agile.safeTotemOrder(r, 'pedidos')).filter(Boolean);
      if (!this.initialized) {
        // Do not auto-print all historical orders when the kiosk is first
        // installed or when credentials are entered for the first time.
        for (const order of current) {
          if (!ledger.get(order.agile_id)) ledger.update(order, { print_status:'historical' });
        }
        this.initialized = true;
        return;
      }
      for (const order of current.slice().reverse()) {
        const seen = ledger.get(order.agile_id);
        if (seen?.print_count > 0 || seen?.print_status === 'historical' ||
            seen?.print_status === 'claimed' || isCancelled(order)) continue;
        try {
          await printOrder(order, this.contents);
        } catch (e) {
          // Do not lose the order: retry only after a cooldown, and do not
          // keep hammering the endpoint if items are not yet synchronized.
          console.warn('[Agile] Cupom ainda nao disponivel:', e.message);
          this.cooldownUntil = Date.now() + 120000;
          break;
        }
      }
    } catch (e) {
      console.warn('[Agile] Consulta de pedidos aguardando:', e.message);
      this.cooldownUntil = Date.now() + (/429/.test(e.message) ? 180000 : 60000);
    } finally {
      this.busy = false;
    }
  }
}
module.exports = { receipt, printOrder, AgilePrintWorker, isCancelled };
