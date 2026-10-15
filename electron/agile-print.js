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
    'NAO E DOCUMENTO FISCAL',
    '='.repeat(width),
    order.erp_order
      ? 'PEDIDO AGILE: ' + line(order.agile_id)
      : 'TRANSACAO AGILE: ' + line(order.transaction || order.agile_id),
  ];
  if (order.external_order_id && order.external_order_id !== order.agile_id)
    lines.push('REFERENCIA SITE: ' + line(order.external_order_id));
  if (order.erp_order) lines.push('NUMPED WINTHOR: ' + line(order.erp_order));
  else lines.push('WINTHOR: AGUARDANDO INTEGRACAO');
  if (order.transaction && order.erp_order) {
    lines.push('TRANSACAO AGILE: ' + line(order.transaction));
  }
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
    throw new Error('Pedido Agile cancelado, rascunho ou sem identificacao valida.');
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
    const matched = orders.filter(order => order).filter(order =>
      [order.agile_id, order.external_order_id, order.erp_order, order.transaction]
        .some(id => String(id || '') === hint)
    );
    if (matched.length === 1) return { order:matched[0] };
    if (matched.length > 1) {
      return { reason:'Mais de um pedido Agile possui este identificador. Consulte o administrador.' };
    }
    // Some storefronts show a site order number different from Agile's
    // ERP/internal number. Fall back only to a UNIQUE amount+time match.
    // Never match by just a recent timestamp.

  }

  // When the popup contains no ID, correlate strictly by amount + time.
  // Never print a random recent order belonging to a shared WinThor customer.
  const amount = Number(pending?.amount);
  const at = Date.parse(pending?.at || '');
  if (pending?.amount == null || !Number.isFinite(amount) || !Number.isFinite(at)) {
    return { reason:'A confirmacao ainda nao pode ser vinculada ao pedido Agile. Necessaria identificacao antes de imprimir.' };
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

function isRecentOrder(order, now = Date.now()) {
  const created = Date.parse(order?.created_at || '');
  // An old database record must not create a new automatic paper receipt
  // when we reconnect after a long outage.
  return Number.isFinite(created) &&
    created >= now - 30 * 60 * 1000 &&
    created <= now + 5 * 60 * 1000;
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
    // Poll Agile continuously, independent of the checkout's browser events.
    // One query per 10 seconds (not an API request every second).
    this.timer = setInterval(() => void this.tick(), 10000);
    void this.tick();
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
    // Do not circumvent an HTTP 429. Query on the next allowed cycle.
    this.onStatus({
      state:'waiting',
      message:'Procurando a transacao Agile e os produtos do pedido…',
      session
    });
    void this.tick();
    return pending;
  }
  retryCheckout() {
    this.onStatus({
      state:'waiting', message:'Conferindo o pedido diretamente no Agile…'
    });
    void this.tick();
  }
  async tick() {
    if (this.busy || Date.now() < this.cooldownUntil) return;
    this.busy = true;
    const pending = ledger.pendingCheckout();
    try {
      if (!agile.configured()) {
        if (pending) throw new Error('Configure Client ID e Client Secret do Agile no admin.');
        return;
      }
      const page = await agile.list('erp_pedidos', {
        codigo_cliente_erp:agile.CUSTOMER_CODE,
        sort:'data_pedido',
        order:'DESC'
      }, 1, 25);
      const orders = page.data.map(row =>
        agile.safeTotemOrder(row, 'erp_pedidos')).filter(Boolean);
      const bootstrap = !ledger.monitorInitialized();
      const current = Date.now();

      // First contact creates a safe baseline, not 25 old paper receipts.
      // Every subsequently discovered recent order is queued locally.
      for (const order of orders) {
        const previous = ledger.get(order.agile_id);
        if (order.cancelled) {
          ledger.update(order, { print_status:'cancelled', auto_pending:false });
        } else if (!previous) {
          const queued = !bootstrap && agile.printEligibility(order) &&
            isRecentOrder(order, current);
          ledger.update(order, {
            print_status:queued ? 'pending' : 'available',
            auto_pending:queued
          });
        } else {
          ledger.update(order);
        }
      }
      if (bootstrap) ledger.initializeMonitor();

      let linked = null;
      if (pending) {
        const found = matchCheckout(orders, pending);
        if (found.order && agile.printEligibility(found.order)) {
          linked = found.order;
          if (ledger.get(linked.agile_id)?.print_count > 0) {
            // The continuous watcher may already have printed before the
            // ecommerce displayed its success popup. Never send a 2nd copy.
            ledger.clearPendingCheckout();
            this.onPrinted({
              session:pending.session, order_id:linked.agile_id,
              duplicate:true
            });
            return;
          }
          ledger.update(linked, { print_status:'pending', auto_pending:true });
        } else {
          this.onStatus({
            state:'waiting',
            message:found.order
              ? 'Pedido Agile em rascunho ou cancelado. Aguardando venda efetiva.'
              : found.reason,
            session:pending.session
          });
        }
      }

      const candidates = orders.filter(order =>
        agile.printEligibility(order) &&
        ledger.get(order.agile_id)?.auto_pending === true &&
        (ledger.get(order.agile_id)?.print_count || 0) === 0 &&
        // "claimed" can mean Windows accepted the print before a crash.
        // Never reprint it automatically without operator review.
        ledger.get(order.agile_id)?.print_status !== 'claimed'
      );
      const chosen = linked && candidates.some(x => x.agile_id === linked.agile_id)
        ? linked
        : candidates[candidates.length - 1];
      if (!chosen) return;

      if (!storage.selectedPrinter()) {
        throw new Error('Selecione e salve a impressora ELGIN i8 no admin.');
      }
      const prior = ledger.get(chosen.agile_id);
      if (prior?.print_count > 0) {
        ledger.update(chosen, { auto_pending:false });
        return;
      }

      this.onStatus({
        state:'printing',
        message:'Pedido Agile localizado. Enviando cupom para o Windows…',
        session: linked?.agile_id === chosen.agile_id ? pending?.session : ''
      });
      const outcome = await printOrder(chosen, this.contents);
      if (!outcome.printed && !outcome.duplicate) {
        throw new Error('Nao foi possivel enviar o cupom ao Windows.');
      }
      ledger.update(chosen, { auto_pending:false });
      if (linked?.agile_id === chosen.agile_id && pending) {
        ledger.clearPendingCheckout();
        this.onPrinted({
          session:pending.session, order_id:chosen.agile_id,
          duplicate:!!outcome.duplicate
        });
      }
    } catch (error) {
      const msg = String(error.message || 'Falha ao consultar o Agile.');
      const match = /(?:tente em|Nova consulta em|limite atingido[^\d]*)(\d+)\s*s/i.exec(msg);
      const delay = /429/.test(msg)
        ? Math.max(15000, Math.min(300000,
          Number(match?.[1] || 60) * 1000))
        : /Itens ainda indisponiveis|produtos deste pedido/.test(msg)
          ? 20000 : 10000;
      this.cooldownUntil = Date.now() + delay;
      if (pending) {
        this.onStatus({
          state:'waiting',
          message:/Itens ainda indisponiveis/.test(msg)
            ? 'Pedido Agile localizado; aguardando lista completa de produtos.'
            : msg,
          session:pending.session
        });
      }
      console.warn('[Agile] Monitor de cupons:', msg);
    } finally {
      this.busy = false;
    }
  }
}
module.exports = { receipt, printOrder, AgilePrintWorker, isCancelled, matchCheckout, isRecentOrder };
