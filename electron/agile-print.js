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
  return !!order?.cancelled || /cancel|rejeitad|estornad|excluid/i.test(order?.status || '');
}
async function printOrder(order, contents, { reprint = false } = {}) {
  if (!order || !order.agile_id) throw new Error('Pedido Agile invalido.');
  if (isCancelled(order)) throw new Error('Pedido Agile cancelado ou rejeitado.');
  if (!agile.printEligibility(order)) {
    throw new Error('Status ERP nao confirmado para impressao. Pedido bloqueado por seguranca.');
  }
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
// A checkout signal comes from the ecommerce's real order confirmation.
// No background printing of unrelated/historical orders from customer 12678.
function matchCheckout(orders, pending) {
  const live = orders.filter(order => order && !isCancelled(order));
  const hint = String(pending?.hint || '').trim();
  if (hint) {
    const matched = live.filter(order =>
      [order.agile_id, order.erp_order, order.transaction]
        .some(id => String(id || '') === hint)
    );
    return matched.length === 1
      ? { order:matched[0] }
      : { reason:matched.length > 1
        ? 'Mais de um pedido Agile possui este identificador. Consulte o administrador.'
        : 'Aguardando o numero do pedido aparecer no Agile.' };
  }

  // When the popup contains no ID, correlate strictly by amount + time.
  // Never print a random recent order belonging to a shared WinThor customer.
  const amount = Number(pending?.amount);
  const at = Date.parse(pending?.at || '');
  if (pending?.amount == null || !Number.isFinite(amount) || !Number.isFinite(at)) {
    return { reason:'A confirmacao nao informou o numero nem o valor do pedido. Necessaria identificacao antes de imprimir.' };
  }
  const matched = live.filter(order => {
    const orderAmount = Number(order.amount);
    const created = Date.parse(order.created_at || '');
    return Number.isFinite(orderAmount) && Math.abs(orderAmount - amount) < 0.005 &&
      Number.isFinite(created) && created >= at - 15 * 60 * 1000 &&
      created <= at + 10 * 60 * 1000;
  });
  if (matched.length === 1) return { order:matched[0] };
  return { reason:matched.length > 1
    ? 'Ha varios pedidos recentes com o mesmo valor. Nao vou imprimir um pedido de outro atendimento.'
    : 'Aguardando o pedido recebido aparecer no Agile.' };
}

class AgilePrintWorker {
  constructor(contents, hooks = {}) {
    this.contents = contents;
    this.timer = null;
    this.busy = false;
    this.cooldownUntil = 0;
    this.onStatus = hooks.onStatus || (() => {});
    this.onPrinted = hooks.onPrinted || (() => {});
  }
  start() {
    if (this.timer) return;
    // The live checkout receives an immediate query; pending receipts are
    // retried without flooding Agile or reprinting old sales.
    this.timer = setInterval(() => void this.tick(), 12000);
    if (ledger.pendingCheckout()) void this.tick();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
  beginCheckout(data = {}) {
    const existing = ledger.pendingCheckout();
    const session = String(data.session || '');
    if (existing && existing.session === session) {
      void this.tick();
      return existing;
    }
    const pending = ledger.setPendingCheckout({
      at:new Date().toISOString(),
      session,
      hint:String(data.order_number || '').trim(),
      amount:data.amount
    });
    this.cooldownUntil = 0;
    this.onStatus({ state:'waiting', message:'Aguardando o pedido recebido no Agile…', session });
    void this.tick();
    return pending;
  }
  retryCheckout() {
    // Do not override a rate limit imposed by the Agile API.
    this.onStatus({ state:'waiting', message:'Verificando o pedido e a impressora…' });
    void this.tick();
  }
  async tick() {
    if (this.busy || Date.now() < this.cooldownUntil) return;
    const pending = ledger.pendingCheckout();
    if (!pending) return;
    this.busy = true;
    try {
      if (!agile.configured()) {
        throw new Error('Configure Client ID e Client Secret do Agile no admin.');
      }
      if (!storage.selectedPrinter()) {
        throw new Error('Nenhuma impressora salva. Solicite ajuda ao atendente.');
      }
      const response = await agile.list('erp_pedidos',
        { codigo_cliente_erp:agile.CUSTOMER_CODE, sort:'data_pedido', order:'DESC' }, 1, 25);
      const orders = response.data.map(row =>
        agile.safeTotemOrder(row, 'erp_pedidos')).filter(Boolean);
      const found = matchCheckout(orders, pending);
      if (!found.order) {
        this.onStatus({ state:'waiting', message:found.reason, session:pending.session });
        return;
      }
      const order = found.order;
      if (isCancelled(order)) {
        throw new Error('Pedido cancelado no Agile. Cupom nao sera impresso.');
      }
      if (!agile.printEligibility(order)) {
        this.onStatus({
          state:'waiting',
          message:'Pedido localizado, aguardando status Recebido no Agile.',
          session:pending.session
        });
        return;
      }
      const previous = ledger.get(order.agile_id);
      if (previous?.print_count > 0) {
        ledger.clearPendingCheckout();
        this.onPrinted({ session:pending.session, order_id:order.agile_id, duplicate:true });
        return;
      }
      this.onStatus({ state:'printing', message:'Pedido recebido! Enviando cupom para a impressora…', session:pending.session });
      const result = await printOrder(order, this.contents);
      if (!result.printed && !result.duplicate) throw new Error('Impressao nao confirmada pelo Windows.');
      ledger.clearPendingCheckout();
      this.onPrinted({
        session:pending.session, order_id:order.agile_id,
        duplicate:!!result.duplicate
      });
    } catch (e) {
      const msg = String(e.message || 'Impressao indisponivel.');
      // An HTTP 429 is already throttled by agile.js; additionally
      // cool down the kiosk worker so it doesn't ping-pong in the UI.
      this.cooldownUntil = Date.now() + (/429/.test(msg) ? 60000 :
        /Itens ainda indisponiveis|produtos deste pedido/.test(msg) ? 22000 : 12000);
      this.onStatus({
        state:'waiting',
        message:/Itens ainda indisponiveis/.test(msg)
          ? 'Pedido recebido; aguardando produtos completos no Agile.'
          : msg,
        session:pending.session
      });
      console.warn('[Agile] Cupom do checkout ainda pendente:', msg);
    } finally {
      this.busy = false;
    }
  }
}
module.exports = { receipt, printOrder, AgilePrintWorker, isCancelled, matchCheckout };
