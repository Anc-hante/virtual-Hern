'use strict';
// Standalone Agile => Windows printer workflow. Does not call HernandesDash.
const fs = require('node:fs');
const path = require('node:path');
const agile = require('./agile');
const ledger = require('./agile-history');
const printer = require('./printer');
const storage = require('./storage');

const POLL_MS = 3000;
const SEEN_LIMIT = 500;
const LOG_MAX = 128 * 1024;

function clean(value) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
}
function money(input) {
  const source = clean(input);
  if (!source) return '';
  const raw = source.includes(',') ? source.replace(/\./g, '').replace(',', '.') : source;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function nextDelay(failures) {
  const step = Math.min(5, Math.max(1, Number(failures) || 1));
  return Math.min(60000, POLL_MS * 2 ** step);
}
function scrub(message) {
  return clean(message)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redigido]')
    .replace(/client_secret["']?\s*[:=]\s*\S+/gi, 'client_secret=[redigido]')
    .slice(0, 240);
}
function monitorLog(message) {
  const line = scrub(message);
  if (!line) return;
  try {
    storage.ensureFolder();
    const file = path.join(storage.folder, 'agile-monitor.log');
    try {
      if (fs.statSync(file).size >= LOG_MAX) {
        const previous = file + '.1';
        fs.rmSync(previous, { force: true });
        fs.renameSync(file, previous);
      }
    } catch (_) { /* first write, or a rotate race, must not stop printing */ }
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n');
  } catch (_) { /* logging is best-effort */ }
}
function receipt(order, items) {
  if (!order?.agile_id) throw new Error('Pedido sem ID Agile confirmado.');
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const total = money(order.amount);
  if (!list.length && !total) {
    throw new Error('Pedido sem itens e sem total informado pelo Agile.');
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
  lines.push('CLIENTE WINTHOR: 12678', '-'.repeat(width));
  if (list.length) {
    lines.push('PRODUTOS DO PEDIDO', '-'.repeat(width));
    for (const item of list.slice(0, 100)) {
      const label = [item.product_id, item.product_name].filter(Boolean).join(' ');
      if (label) lines.push(line(label));
      const quantity = clean(item.quantity);
      const price = money(item.price);
      const value = money(item.value);
      if (quantity && price) lines.push(line('Qtd: ' + quantity + ' x R$ ' + price));
      else if (quantity) lines.push(line('Qtd: ' + quantity));
      else if (price) lines.push(line('Valor un.: R$ ' + price));
      if (value) lines.push(line('  Total: R$ ' + value));
    }
  } else {
    lines.push('ITENS INDISPONIVEIS NO AGILE');
  }
  if (order.payment_label) lines.push('PAGAMENTO: ' + line(order.payment_label));
  lines.push('-'.repeat(width));
  if (total) lines.push('TOTAL DO PEDIDO: R$ ' + total);
  lines.push('='.repeat(width), 'OBRIGADO PELA SUA COMPRA!',
    'CADASTRE-SE NO GRUPO HERNANDES',
    'APONTE A CAMERA PARA O QR CODE', '');
  return lines.join('\n');
}
function isCancelled(order) {
  return !!order?.cancelled || /cancel|rejeitad|estornad|excluid/i.test(order?.status || '');
}
async function paymentLabel(order) {
  const payments = await agile.paymentsForOrder(order);
  const payment = payments.find(row =>
    row && (row.valor != null && row.valor !== '' || row.id_forma_pagamento || row.bandeira)
  );
  if (!payment) return '';
  const forma = clean(payment.id_forma_pagamento || payment.bandeira);
  const valor = money(payment.valor);
  return [forma, valor ? 'R$ ' + valor : ''].filter(Boolean).join(' ');
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
  let items = [];
  try { items = await agile.itemsForOrder(order); } catch (_) { items = []; }
  let label = '';
  try { label = await paymentLabel(order); } catch (_) { label = ''; }
  const printable = label ? { ...order, payment_label: label } : order;
  const body = receipt(printable, items);
  const previous = ledger.get(order.agile_id);
  if (!reprint && previous?.print_count > 0)
    return { printed: false, duplicate: true };
  ledger.update(order, { print_status: 'claimed' });
  try {
    await printer.printReceipt(chosen, body);
    const record = ledger.update(order, {
      print_status: 'printed', print_count: (previous?.print_count || 0) + 1,
      last_printed_at: new Date().toISOString(), last_error: ''
    });
    return { printed: true, order: record };
  } catch (error) {
    ledger.update(order, { print_status: 'failed', last_error: error.message });
    throw error;
  }
}
// A checkout signal comes from the ecommerce's real order confirmation.
// No background printing of unrelated/historical orders from customer 12678.
// Orders may be created when the customer starts the cart, far before checkout.
// Only orders already observed in the monitor qualify for a wider time window.
function matchCheckout(orders, pending, { observedIds = new Set(), confirmedIds = new Set() } = {}) {
  const live = orders.filter(order => order && !isCancelled(order));
  const hint = String(pending?.hint || '').trim();
  if (hint) {
    const matched = live.filter(order =>
      [order.agile_id, order.external_order_id, order.erp_order, order.transaction]
        .some(id => String(id || '') === hint)
    );
    if (matched.length === 1) return { order: matched[0] };
    if (matched.length > 1) {
      return { reason: 'Mais de um pedido Agile possui este identificador. Consulte o administrador.' };
    }
  }

  const at = Date.parse(pending?.at || '');
  if (!Number.isFinite(at)) {
    return { reason: 'Aguardando vincular o atendimento ao pedido Agile.' };
  }
  const createdAt = order => Date.parse(order.created_at || '');
  const within = (order, minutesBefore) => {
    const created = createdAt(order);
    return Number.isFinite(created) &&
      created >= at - minutesBefore * 60 * 1000 &&
      created <= at + 5 * 60 * 1000;
  };
  const amount = Number(pending?.amount);
  const hasAmount = pending?.amount != null && Number.isFinite(amount);
  const sameAmount = order => {
    const source = String(order.amount ?? '');
    const normalized = source.includes(',')
      ? source.replace(/\./g, '').replace(',', '.') : source;
    const number = Number(normalized);
    return source.trim() !== '' && Number.isFinite(number) &&
      Math.abs(number - amount) < 0.005;
  };
  if (hasAmount) {
    const observed = live.filter(order =>
      observedIds.has(String(order.agile_id)) && within(order, 120) && sameAmount(order)
    );
    if (observed.length === 1) return { order: observed[0] };
    if (observed.length > 1) {
      return { reason: 'Pedidos Agile observados com o mesmo valor. Aguardando identificador.' };
    }
    const fresh = live.filter(order => within(order, 2) && sameAmount(order));
    if (fresh.length === 1) return { order: fresh[0] };
    if (fresh.length > 1) {
      return { reason: 'Mais de um pedido Agile tem o mesmo valor; aguardando identificacao unica.' };
    }
  }
  const transitions = live.filter(order =>
    confirmedIds.has(String(order.agile_id)) && within(order, 120)
  );
  if (!hasAmount && transitions.length === 1) return { order: transitions[0] };
  if (!hasAmount && transitions.length > 1) {
    return { reason: 'Mais de um pedido foi confirmado no Agile; aguardando identificador.' };
  }
  const fresh = live.filter(order => within(order, 2));
  if (fresh.length === 1 && !hasAmount) return { order: fresh[0] };
  return { reason: fresh.length > 1
    ? 'Ha multiplos pedidos Agile simultaneos; aguardando referencia especifica.'
    : 'Aguardando o pedido confirmado aparecer entre os pedidos recentes do Agile.' };
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
    this.printing = false;
    this.loopStarted = false;
    this.stopped = false;
    this.loopBusy = false;
    this.failures = 0;
    this.lastNote = '';
    this.cooldownUntil = 0;
    this.seen = new Map();
    this.onStatus = hooks.onStatus || (() => {});
    this.onPrinted = hooks.onPrinted || (() => {});
  }
  signature(order) {
    return [
      order.status,
      order.confirmado === true ? '1' : order.confirmado === false ? '0' : '',
      order.amount,
      order.erp_order,
      order.transaction,
      order.cancelled ? '1' : '0',
      order.print_eligible ? '1' : '0'
    ].join('|');
  }
  remember(id, signature) {
    const key = String(id || '');
    if (!key) return;
    if (this.seen.has(key)) this.seen.delete(key);
    this.seen.set(key, signature);
    while (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.keys().next().value;
      this.seen.delete(oldest);
    }
  }
  note(message) {
    const line = scrub(message);
    if (!line || line === this.lastNote) return;
    this.lastNote = line;
    monitorLog(line);
    console.warn('[Agile] Monitor de cupons:', line);
  }
  start() {
    if (this.loopStarted) return;
    this.stopped = false;
    this.loopStarted = true;
    this.schedule(0);
  }
  stop() {
    this.stopped = true;
    this.loopStarted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  schedule(delay) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(60000, Number(delay) || POLL_MS));
    this.timer = setTimeout(() => {
      this.timer = null;
      Promise.resolve()
        .then(() => this.runLoop())
        .catch(error => {
          this.note(error?.message || error);
          if (!this.stopped) this.schedule(nextDelay((this.failures || 0) + 1));
        });
    }, wait);
  }
  async runLoop() {
    if (this.stopped || this.loopBusy) return;
    this.loopBusy = true;
    let delay = POLL_MS;
    try {
      if (this.printing) {
        delay = 500;
      } else if (Date.now() < this.cooldownUntil) {
        delay = Math.min(60000, Math.max(500, this.cooldownUntil - Date.now()));
      } else {
        await this.tick();
        if (Date.now() < this.cooldownUntil) {
          delay = Math.min(60000, Math.max(500, this.cooldownUntil - Date.now()));
        } else {
          this.failures = 0;
          delay = POLL_MS;
        }
      }
    } catch (error) {
      this.failures = Math.min(5, (this.failures || 0) + 1);
      delay = nextDelay(this.failures);
      this.note(error?.message || error);
    } finally {
      this.loopBusy = false;
      if (!this.stopped) this.schedule(delay);
    }
  }
  beginCheckout(data = {}) {
    const existing = ledger.pendingCheckout();
    const session = String(data.session || '');
    if (existing && existing.session === session) {
      void this.tick();
      return existing;
    }
    const pending = ledger.setPendingCheckout({
      at: new Date().toISOString(),
      session,
      hint: String(data.order_number || '').trim(),
      amount: data.amount
    });
    this.onStatus({
      state: 'waiting',
      message: 'Procurando a transacao Agile e os produtos do pedido…',
      session
    });
    void this.tick();
    return pending;
  }
  retryCheckout() {
    this.onStatus({
      state: 'waiting', message: 'Conferindo o pedido diretamente no Agile…'
    });
    void this.tick();
  }
  async tick() {
    if (this.busy || this.printing || this.stopped || Date.now() < this.cooldownUntil) return;
    this.busy = true;
    const pending = ledger.pendingCheckout();
    try {
      if (!agile.configured()) {
        if (pending) throw new Error('Configure Client ID e Client Secret do Agile no admin.');
        return;
      }
      const page = await agile.recentOrders(pending ? 25 : 5);
      const orders = page.orders || [];
      const bootstrap = !ledger.monitorInitialized();
      const observedIds = new Set();
      const confirmedIds = new Set();
      const current = Date.now();

      // First contact creates a safe baseline, not a stack of old receipts.
      // A cart seen after that baseline is watched until confirmado=true.
      for (const order of orders) {
        const previous = ledger.get(order.agile_id);
        const signature = this.signature(order);
        // Collect pre-update evidence for safe checkout correlation.
        if (previous && (previous.print_status === 'watching' ||
            previous.print_status === 'pending' || previous.auto_pending === true)) {
          observedIds.add(String(order.agile_id));
        }
        if (previous?.print_status === 'watching' && agile.printEligibility(order)) {
          confirmedIds.add(String(order.agile_id));
        }
        if (!previous) {
          if (order.cancelled) {
            ledger.update(order, { print_status: 'cancelled', auto_pending: false });
          } else if (bootstrap || !isRecentOrder(order, current)) {
            ledger.update(order, { print_status: 'historical', auto_pending: false });
          } else if (agile.printEligibility(order)) {
            ledger.update(order, { print_status: 'pending', auto_pending: true });
          } else {
            ledger.update(order, { print_status: 'watching', auto_pending: false });
          }
          this.remember(order.agile_id, signature);
        } else if (order.cancelled) {
          ledger.update(order, { print_status: 'cancelled', auto_pending: false });
          this.remember(order.agile_id, signature);
        } else if (
          previous.print_status === 'watching' &&
          agile.printEligibility(order) &&
          isRecentOrder(order, current) &&
          (previous.print_count || 0) === 0
        ) {
          ledger.update(order, { print_status: 'pending', auto_pending: true });
          this.remember(order.agile_id, signature);
        } else if (this.seen.get(order.agile_id) === signature) {
          continue;
        } else {
          ledger.update(order);
          this.remember(order.agile_id, signature);
        }
      }
      if (bootstrap) ledger.initializeMonitor();

      let linked = null;
      if (pending) {
        const found = matchCheckout(orders, pending, { observedIds, confirmedIds });
        if (found.order && agile.printEligibility(found.order)) {
          linked = found.order;
          if (ledger.get(linked.agile_id)?.print_count > 0) {
            ledger.clearPendingCheckout();
            this.onPrinted({
              session: pending.session, order_id: linked.agile_id,
              duplicate: true
            });
            return;
          }
          ledger.update(linked, { print_status: 'pending', auto_pending: true });
        } else {
          this.onStatus({
            state: 'waiting',
            message: found.order
              ? 'Pedido Agile em rascunho ou cancelado. Aguardando venda efetiva.'
              : found.reason,
            session: pending.session
          });
        }
      }

      const candidates = orders.filter(order =>
        agile.printEligibility(order) &&
        ledger.get(order.agile_id)?.auto_pending === true &&
        (ledger.get(order.agile_id)?.print_count || 0) === 0 &&
        ledger.get(order.agile_id)?.print_status !== 'claimed'
      );
      // Active checkout must never print an unrelated new Agile order.
      const chosen = pending
        ? (linked && candidates.some(order => order.agile_id === linked.agile_id) ? linked : null)
        : candidates[candidates.length - 1];
      if (!chosen) return;

      if (!storage.selectedPrinter()) {
        throw new Error('Selecione e salve a impressora ELGIN i8 no admin.');
      }
      const prior = ledger.get(chosen.agile_id);
      if (prior?.print_count > 0) {
        ledger.update(chosen, { auto_pending: false });
        return;
      }

      this.onStatus({
        state: 'printing',
        message: 'Pedido Agile localizado. Enviando cupom para o Windows…',
        session: linked?.agile_id === chosen.agile_id ? pending?.session : ''
      });
      this.printing = true;
      const outcome = await printOrder(chosen, this.contents);
      this.printing = false;
      if (!outcome.printed && !outcome.duplicate) {
        throw new Error('Nao foi possivel enviar o cupom ao Windows.');
      }
      ledger.update(chosen, { auto_pending: false });
      if (outcome.printed) {
        this.note('Cupom enviado para a impressora. Pedido ' + chosen.agile_id);
      }
      if (linked?.agile_id === chosen.agile_id && pending) {
        ledger.clearPendingCheckout();
        this.onPrinted({
          session: pending.session, order_id: chosen.agile_id,
          duplicate: !!outcome.duplicate
        });
      }
    } catch (error) {
      const msg = String(error.message || 'Falha ao consultar o Agile.');
      const match = /(?:tente em|Nova consulta em|limite atingido[^\d]*)(\d+)\s*s/i.exec(msg);
      const retryAfter = /429/.test(msg) ? Number(match?.[1]) : NaN;
      this.failures = Math.min(5, (this.failures || 0) + 1);
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(60000, Math.max(1000, retryAfter * 1000))
        : nextDelay(this.failures);
      this.cooldownUntil = Date.now() + delay;
      if (pending) {
        this.onStatus({
          state: 'waiting',
          message: msg,
          session: pending.session
        });
      }
      this.note(msg);
    } finally {
      this.printing = false;
      this.busy = false;
    }
  }
}
module.exports = {
  receipt, printOrder, AgilePrintWorker, isCancelled, matchCheckout, isRecentOrder,
  POLL_MS, SEEN_LIMIT, nextDelay, monitorLog
};
