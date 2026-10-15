'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const printer = require('../printer');
const agile = require('../agile');
const storage = require('../storage');
const history = require('../agile-history');
const { AgilePrintWorker, receipt, isRecentOrder } = require('../agile-print');

function orderRow(id, status = 'em_separacao', created = new Date().toISOString()) {
  return {
    id,
    codigo_cliente_erp:'12678',
    id_transacao_venda:'AGILE-TX-' + id,
    id_pedido_erp:null,
    status_erp:status,
    valor_total:'30.00',
    data_pedido:created,
    data_cancelamento:null,
    confirmado:true
  };
}

function mocks() {
  const original = {
    configured:agile.configured,
    list:agile.list,
    recentOrders:agile.recentOrders,
    itemsForOrder:agile.itemsForOrder,
    selectedPrinter:storage.selectedPrinter,
    installedPrinters:printer.installedPrinters,
    printReceipt:printer.printReceipt,
    ledgerGet:history.get,
    ledgerUpdate:history.update,
    initialized:history.monitorInitialized,
    initializeMonitor:history.initializeMonitor,
    pendingCheckout:history.pendingCheckout,
    clearPendingCheckout:history.clearPendingCheckout
  };
  const rows = new Map();
  const output = [];
  let started = false;
  let observed = [];
  agile.configured = () => true;
  agile.list = async () => ({data:observed});
  agile.recentOrders = async () => ({
    orders:observed.map(row => agile.safeTotemOrder(row, 'pedidos')).filter(Boolean)
  });
  agile.itemsForOrder = async () => [{
    product_id:'4702',product_name:'Ketchup',quantity:'1',
    price:'30.00',value:'30.00'
  }];
  storage.selectedPrinter = () => 'ELGIN';
  printer.installedPrinters = async () => [{name:'ELGIN'}];
  printer.printReceipt = async (_name,text) => {output.push(text);};
  history.get = id => rows.get(String(id)) || null;
  history.update = (order, changes={}) => {
    const prev = rows.get(order.agile_id) || {};
    const current = {...prev,...order,...changes};
    rows.set(order.agile_id,current);
    return current;
  };
  history.monitorInitialized = () => started;
  history.initializeMonitor = () => {started = true;};
  history.pendingCheckout = () => null;
  history.clearPendingCheckout = () => {};
  return {
    rows,output,setObserved(value){observed=value;},
    restore(){
      agile.configured=original.configured;
      agile.list=original.list;
      agile.recentOrders=original.recentOrders;
      agile.itemsForOrder=original.itemsForOrder;
      storage.selectedPrinter=original.selectedPrinter;
      printer.installedPrinters=original.installedPrinters;
      printer.printReceipt=original.printReceipt;
      history.get=original.ledgerGet;
      history.update=original.ledgerUpdate;
      history.monitorInitialized=original.initialized;
      history.initializeMonitor=original.initializeMonitor;
      history.pendingCheckout=original.pendingCheckout;
      history.clearPendingCheckout=original.clearPendingCheckout;
    }
  };
}

test('continuous monitor prints new Agile transaction once without WinThor approval', async () => {
  const testenv = mocks();
  try {
    testenv.setObserved([orderRow('OLDER')]);
    const worker = new AgilePrintWorker({});
    await worker.tick();
    assert.equal(testenv.output.length,0,'first scan establishes baseline');
    assert.equal(testenv.rows.get('OLDER').auto_pending,false);

    testenv.setObserved([orderRow('NEW'),orderRow('OLDER')]);
    await worker.tick();
    assert.equal(testenv.output.length,1);
    assert.match(testenv.output[0], /TRANSACAO AGILE: AGILE-TX-NEW/);
    assert.match(testenv.output[0], /WINTHOR: AGUARDANDO INTEGRACAO/);
    assert.match(testenv.output[0], /NAO E DOCUMENTO FISCAL/);
    assert.equal(testenv.rows.get('NEW').print_count,1);
    assert.equal(testenv.rows.get('NEW').auto_pending,false);
    await worker.tick();
    assert.equal(testenv.output.length,1,'must never reprint an already-seen order');
    assert.equal(testenv.rows.get('OLDER').print_count,undefined);
  } finally {
    testenv.restore();
  }
});

test('cancelled orders and historical newly encountered records never print', async () => {
  const testenv = mocks();
  try {
    const worker = new AgilePrintWorker({});
    testenv.setObserved([]);
    await worker.tick();
    testenv.setObserved([
      orderRow('CANCEL','cancelado'),
      orderRow('OLD','em_separacao','2026-01-01T12:00:00Z')
    ]);
    await worker.tick();
    assert.equal(testenv.output.length,0);
    assert.equal(testenv.rows.get('CANCEL').print_status,'cancelled');
    assert.equal(testenv.rows.get('OLD').auto_pending,false);
    assert.equal(isRecentOrder({created_at:'2026-01-01T12:00:00Z'}),false);
  } finally {
    testenv.restore();
  }
});

test('rate limit backs off before another query and does not lose a pending checkout', async () => {
  const testenv = mocks();
  const savedPending=history.pendingCheckout;
  const savedList=agile.list;
  let requests = 0;
  try {
    history.pendingCheckout=()=>({
      session:'SESSION-1',hint:'X',amount:30,at:new Date().toISOString()
    });
    agile.recentOrders=async()=>{requests++;throw new Error('Agile HTTP 429: limite atingido. Nova consulta em 80s.');};
    const worker = new AgilePrintWorker({});
    await worker.tick();
    assert.equal(requests,1);
    const wait = worker.cooldownUntil - Date.now();
    assert.ok(wait <= 60000, 'backoff stays within about 60s');
    assert.ok(wait >= 55000, 'Retry-After is honored up to the cap');
    await worker.tick();
    assert.equal(requests,1);
    assert.equal(testenv.output.length,0);
  } finally {
    history.pendingCheckout=savedPending;
    agile.list=savedList;
    testenv.restore();
  }
});
