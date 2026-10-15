'use strict';
// On-device printing ledger for Agile orders. No API tokens or raw customer
// records; each order ID gets a durable printed/suppressed/pending state.
const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage');

const ledgerFile = path.join(storage.folder, 'agile-print-history.json');
const MAX_RECORDS = 500;
const pendingFile = path.join(storage.folder, 'agile-checkout-pending.json');
function pendingCheckout() {
  try {
    const entry = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    return typeof entry?.at === 'string' ? entry : null;
  } catch (_) { return null; }
}
function setPendingCheckout(entry) {
  const created = {
    at: String(entry.at || new Date().toISOString()),
    hint: String(entry.hint || '').slice(0, 80),
    amount: entry.amount == null ? null : Number(entry.amount),
    session: String(entry.session || '').slice(0, 90)
  };
  if (created.amount !== null && !Number.isFinite(created.amount)) {
    created.amount = null;
  }
  storage.ensureFolder();
  const tmp = pendingFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(created), { flag:'w', mode:0o600 });
  fs.renameSync(tmp, pendingFile);
  return created;
}
function clearPendingCheckout() {
  fs.rmSync(pendingFile, { force:true });
}


function load() {
  try {
    const value = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    return Array.isArray(value) ? value.filter(x => x && x.agile_id).slice(-MAX_RECORDS) : [];
  } catch (_) { return []; }
}
function persist(rows) {
  storage.ensureFolder();
  const temp = ledgerFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(rows.slice(-MAX_RECORDS)), { flag:'w', mode:0o600 });
  fs.renameSync(temp, ledgerFile);
}
function update(order, changes = {}) {
  const id = String(order?.agile_id || '');
  if (!id) throw new Error('Pedido Agile sem identificador.');
  const rows = load();
  const index = rows.findIndex(r => r.agile_id === id);
  const old = index >= 0 ? rows.splice(index, 1)[0] : {};
  const safe = {
    agile_id: id,
    erp_order: String(order.erp_order || old.erp_order || ''),
    transaction: String(order.transaction || old.transaction || ''),
    amount: String(order.amount || old.amount || ''),
    status: String(order.status || old.status || ''),
    created_at: String(order.created_at || old.created_at || ''),
    source: String(order.source || old.source || 'pedidos'),
    cancelled: !!(order.cancelled || old.cancelled),
    cancellation_date: String(order.cancellation_date || old.cancellation_date || ''),
    print_eligible: order.print_eligible === true && !order.cancelled,
    print_count: Number(changes.print_count ?? old.print_count ?? 0),
    print_status: String(changes.print_status || old.print_status || 'pending'),
    last_error: String(changes.last_error ?? old.last_error ?? '').slice(0, 180),
    last_printed_at: String(changes.last_printed_at || old.last_printed_at || '')
  };
  rows.push(safe);
  persist(rows);
  return safe;
}
function get(id) { return load().find(r => r.agile_id === String(id)) || null; }
function history(search = '', offset = 0, limit = 25) {
  const rows = load().filter(x =>
    !search || x.agile_id.includes(search) ||
    x.erp_order.includes(search) || x.transaction.includes(search)
  ).reverse();
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  return {
    ok:true, count:rows.length,
    orders:rows.slice(start, start + limit).map(x => ({
      id:x.agile_id, order_number:x.erp_order || x.agile_id,
      agile_order:x.agile_id, transaction:x.transaction,
      number_type:x.erp_order ? 'winthor' : 'agile',
      occurred_at:x.created_at, amount:Number(x.amount) || null,
      print_count:x.print_count, print_status:x.print_status,
      cancelled:!!x.cancelled, print_eligible:x.print_eligible === true,
      reprint_allowed: x.print_count > 0 &&
        x.print_eligible === true && !x.cancelled &&
        x.print_status !== 'claimed' && x.print_status !== 'cancelled',
      source:'agile'
    })),
    next_offset:start + limit < rows.length ? start + limit : null
  };
}
module.exports = { ledgerFile, load, update, get, history,
  pendingFile, pendingCheckout, setPendingCheckout, clearPendingCheckout };
