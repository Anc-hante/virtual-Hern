'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const printer = require('../printer');
const agile = require('../agile');
const storage = require('../storage');
const history = require('../agile-history');
const { receipt, AgilePrintWorker, printOrder, matchCheckout } = require('../agile-print');

function order(id, overrides = {}) {
  return {
    agile_id:id,erp_order:'',transaction:'T-' + id,
    amount:'25.50',status:'recebido',source:'pedidos',confirmado:true,
    created_at:new Date().toISOString(),cancelled:false,...overrides
  };
}

test('receipt marks Agile order correctly even before WinThor exists', () => {
  const out = receipt(order('A-123'), [{
    product_id:'4702',product_name:'Ketchup',quantity:'2',price:'10.00',value:'20.00'
  }]);
  assert.match(out, /TRANSACAO AGILE: T-A-123/);
  assert.match(out, /WINTHOR: AGUARDANDO INTEGRACAO/);
  assert.match(out, /NAO E DOCUMENTO FISCAL/);
  assert.match(out, /R\$ 10,00/);
  assert.doesNotMatch(out, /NUMPED WINTHOR: A-123/);
  const totalOnly = receipt(order('A-123'), []);
  assert.match(totalOnly, /TOTAL DO PEDIDO: R\$ 25,50/);
  assert.match(totalOnly, /ITENS INDISPONIVEIS NO AGILE/);
  assert.doesNotMatch(totalOnly, /Ketchup|4702/);
  assert.throws(() => receipt(order('A-123', { amount:'' }), []), /sem total/);
});

test('new Agile orders print without WinThor approval, but cancelled and draft remain blocked', () => {
  assert.equal(agile.printEligibility(order('RECEIVED')), true);
  assert.equal(agile.printEligibility(order('RECEIVED-2', {
    status:'em_separacao',status_agile:'pedido recebido',status_erp:'em_separacao'
  })), true);
  assert.equal(agile.printEligibility(order('SPLIT',{status:'em_separacao'})), true);
  assert.equal(agile.printEligibility(order('CANCEL',{status:'recebido',cancelled:true})), false);
  assert.equal(agile.printEligibility(order('CANCEL2',{status:'cancelado',status_erp:'recebido'})), false);
  assert.equal(agile.printEligibility(order('PENDING',{status:'pendente'})), true);
  assert.equal(agile.printEligibility(order('DRAFT',{status:'rascunho'})), false);
  assert.equal(agile.printEligibility(order('CART',{status:'carrinho',confirmado:false})), false);
  assert.equal(agile.printEligibility(order('OPEN',{status:'recebido',confirmado:false})), false);
});

test('received ERP record fetches exact linked products by id_pedido without NUMPED', async () => {
  // itemsForOrder calls the module-local list() function; mock the network
  // boundary instead of changing an unrelated exported property.
  const oldFetch = global.fetch;
  const oldLoad = storage.loadAgileCredentials;
  const calls = [];
  try {
    storage.loadAgileCredentials = () => ({
      client_id:'fake-local-id', client_secret:'fake-local-secret'
    });
    global.fetch = async (url, opts) => {
      calls.push({url, opts});
      if (String(url).endsWith('/api/usuario/login')) {
        return {ok:true,status:200,json:async()=>({Token:'mock-jwt-only',Expiration:3600})};
      }
      return {ok:true,status:200,json:async()=>({data:[
        {id_pedido:'RECORD-123',id_produto:'4702',descricao_produto_snapshot:'Ketchup',
          quantidade:'2',valor_unitario:'10.00',valor_total:'20.00'},
        {id_pedido:'OTHER',id_produto:'8912',descricao_produto_snapshot:'Unrelated',
          quantidade:'1',valor_unitario:'99.00'}
      ], meta:{total:2}})};
    };
    agile.resetSession();
    const items = await agile.itemsForOrder(order('RECORD-123', {
      source:'erp_pedidos', erp_order:''
    }));
    const request = calls.find(x => x.url.includes('erp_pedidos_produtos'));
    assert.ok(request);
    assert.match(request.url, /id_pedido=RECORD-123/);
    assert.equal(items.length,1);
    assert.equal(items[0].product_name,'Ketchup');
  } finally {
    global.fetch=oldFetch;
    storage.loadAgileCredentials=oldLoad;
    agile.resetSession();
  }
});

test('checkout correlation never prints random orders sharing customer 12678', () => {
  const at = new Date().toISOString();
  const target = order('T-1',{erp_order:'996655'});
  const unrelated = order('T-2',{amount:'87.00'});
  assert.equal(matchCheckout([target,unrelated],{hint:'996655',at}).order.agile_id,'T-1');
  assert.equal(matchCheckout([target,unrelated],{amount:'25.50',at}).order.agile_id,'T-1');
  assert.equal(matchCheckout([target,unrelated],{
    hint:'SITE-ONLY-ID',amount:'25.50',at
  }).order.agile_id,'T-1');
  assert.equal(matchCheckout([target,order('T-3')],{amount:'25.50',at}).order,undefined);
  // A single sale immediately after the customer confirms on this
  // dedicated totem may be linked even if Agile returns no site number.
  assert.equal(matchCheckout([target],{at}).order.agile_id,'T-1');
  assert.equal(matchCheckout([target],{hint:'UNKNOWN',at}).order.agile_id,'T-1');
  assert.equal(matchCheckout([target],{amount:'25.50',at:'2026-01-01T00:00:00Z'}).order,undefined);
});

test('worker prints only checkout-correlated received sale, once, then clears durable pending state', async () => {
  const original = {
    configured:agile.configured, list:agile.list, recent:agile.recentOrders,
    items:agile.itemsForOrder,
    selected:storage.selectedPrinter, printers:printer.installedPrinters,
    print:printer.printReceipt, get:history.get, update:history.update,
    pending:history.pendingCheckout, save:history.setPendingCheckout,
    clear:history.clearPendingCheckout,
    initialized:history.monitorInitialized, init:history.initializeMonitor
  };
  const records = new Map();
  let pending = null;
  let initialized = false;
  const outputs = [];
  const events = [];
  const old = order('PREVIOUS',{amount:'18.00'});
  const current = order('NEW-SALE',{erp_order:'765432',status:'recebido'});
  try {
    agile.configured = () => true;
    storage.selectedPrinter = () => 'ELGIN i8 TEST';
    printer.installedPrinters = async () => [{name:'ELGIN i8 TEST'}];
    agile.itemsForOrder = async () => [{
      product_id:'4702',product_name:'Ketchup',quantity:'2',
      price:'12.75',value:'25.50'
    }];
    printer.printReceipt = async (_name, text) => {outputs.push(text);};
    history.monitorInitialized = () => initialized;
    history.initializeMonitor = () => {initialized = true;};
    history.get = id => records.get(id) || null;
    history.update = (data, changes = {}) => {
      const old = records.get(data.agile_id) || {};
      const updated = {...old,...data,...changes};
      records.set(data.agile_id,updated);
      return updated;
    };
    history.pendingCheckout = () => pending;
    history.setPendingCheckout = data => {pending = data;return data;};
    history.clearPendingCheckout = () => {pending = null;};
    agile.recentOrders = async () => ({
      orders:[old,current].map(x => agile.safeTotemOrder({
        id:x.agile_id,id_pedido_erp:x.erp_order,confirmado:true,
        codigo_cliente_erp:'12678',status:x.status,
        valor_total:x.amount,data:x.created_at
      }, 'pedidos')).filter(Boolean)
    });
    const worker = new AgilePrintWorker({}, {
      onStatus:e => events.push(e),
      onPrinted:e => events.push({...e, printed:true})
    });
    // Startup/idle must NOT print earlier orders.
    await worker.tick();
    assert.equal(outputs.length,0);
    history.setPendingCheckout({
      hint:'765432',amount:25.50,at:new Date().toISOString(),session:'S1'
    });
    await worker.tick();
    assert.equal(outputs.length,1);
    assert.match(outputs[0], /PEDIDO AGILE: NEW-SALE/);
    assert.equal(records.get('NEW-SALE').print_count,1);
    assert.equal(pending,null);
    assert.equal(events.filter(x=>x.printed).length,1);
    await worker.tick();
    assert.equal(outputs.length,1);
  } finally {
    agile.configured=original.configured;agile.list=original.list;
    agile.recentOrders=original.recent;
    agile.itemsForOrder=original.items;storage.selectedPrinter=original.selected;
    printer.installedPrinters=original.printers;printer.printReceipt=original.print;
    history.get=original.get;history.update=original.update;
    history.pendingCheckout=original.pending;history.setPendingCheckout=original.save;
    history.clearPendingCheckout=original.clear;
    history.monitorInitialized=original.initialized;
    history.initializeMonitor=original.init;
  }
});

test('printer failure does not release checkout or delete the pending job', async () => {
  const original = {
    configured:agile.configured,list:agile.list,recent:agile.recentOrders,
    items:agile.itemsForOrder,
    selected:storage.selectedPrinter,printers:printer.installedPrinters,
    print:printer.printReceipt,get:history.get,update:history.update,
    pending:history.pendingCheckout,clear:history.clearPendingCheckout
  };
  let pending = {hint:'NEW',amount:25.5,at:new Date().toISOString(),session:'S2'};
  let printed = false;
  try {
    agile.configured=()=>true;storage.selectedPrinter=()=> 'ELGIN';
    printer.installedPrinters=async()=>[{name:'ELGIN'}];
    agile.itemsForOrder=async()=>[{product_id:'4702',product_name:'Ketchup',quantity:'1',price:'25.50'}];
    printer.printReceipt=async()=>{throw new Error('Printer unplugged');};
    history.pendingCheckout=()=>pending;
    history.clearPendingCheckout=()=>{pending=null;};
    history.get=()=>null;history.update=(o)=>o;
    agile.recentOrders=async()=>({orders:[agile.safeTotemOrder({
      id:'NEW',codigo_cliente_erp:'12678',status:'recebido',confirmado:true,
      data:new Date().toISOString(),valor_total:'25.50'
    }, 'pedidos')].filter(Boolean)});
    const worker=new AgilePrintWorker({}, {onPrinted:()=>{printed=true;}});
    await worker.tick();
    assert.ok(pending);
    assert.equal(printed,false);
  } finally {
    agile.configured=original.configured;agile.list=original.list;
    agile.recentOrders=original.recent;
    agile.itemsForOrder=original.items;storage.selectedPrinter=original.selected;
    printer.installedPrinters=original.printers;printer.printReceipt=original.print;
    history.get=original.get;history.update=original.update;
    history.pendingCheckout=original.pending;history.clearPendingCheckout=original.clear;
  }
});

test('thank-you screen stays locked until native print acknowledgment then reloads HOME', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
  const web=fs.readFileSync(path.join(__dirname,'..','shell','renderer.js'),'utf8');
  const flow=fs.readFileSync(path.join(__dirname,'..','..','src','HernandesCheckout','Resources','checkout_flow.js'),'utf8');
  assert.match(main,/if \(screen === 'complete' && !receiptConfirmed\)/);
  assert.match(main,/onPrinted: result =>/);
  assert.match(main,/await site\.webContents\.loadURL\(HOME\)/);
  assert.match(main,/worker\.beginCheckout\(/);
  assert.match(main,/case 'checkout:retry-print'/);
  assert.match(web,/new-session'\)\.disabled = !printed/);
  assert.match(web,/checkout-print-retry/);
  assert.match(flow,/action: 'completion-lock',\s*order:/);
});

test('always-on Agile monitor uses one 3s timeout chain and never uses HernandesDash', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'..','agile-print.js'),'utf8');
  assert.match(worker,/POLL_MS = 3000/);
  assert.match(worker,/setTimeout\(/);
  assert.doesNotMatch(worker,/setInterval\(/);
  assert.match(main,/new agilePrint\.AgilePrintWorker/);
  assert.match(main,/worker\.start\(\)/);
  assert.doesNotMatch(main,/api\.sendEvent\(/);
  assert.doesNotMatch(worker,/\/printer\/claim|new PrintWorker/);
});


test('checkout iniciado em carrinho antigo associa somente pedido observado e com mesmo valor', () => {
  const at = new Date().toISOString();
  const oldCart = order('LONG-CART', {
    amount:'25.50',created_at:new Date(Date.now() - 35 * 60 * 1000).toISOString()
  });
  const unrelated = order('OTHER-CART', {
    amount:'87.00',created_at:new Date(Date.now() - 18 * 60 * 1000).toISOString()
  });
  const pending = { hint:'', amount:25.5, at };
  // An unobserved older order can NEVER be guessed just from the amount.
  assert.equal(matchCheckout([oldCart], pending).order, undefined);
  assert.equal(matchCheckout([oldCart, unrelated], pending, {
    observedIds:new Set(['LONG-CART'])
  }).order?.agile_id,'LONG-CART');
  assert.equal(matchCheckout([oldCart, order('SECOND', {
    created_at:new Date(Date.now() - 25 * 60 * 1000).toISOString()
  })], pending, {
    observedIds:new Set(['LONG-CART','SECOND'])
  }).order,undefined);
});

test('checkout sem valor so casa transicao unica confirmada, nao pedido antigo aleatorio', () => {
  const at = new Date().toISOString();
  const cart = order('WATCHED-OLD',{
    created_at:new Date(Date.now() - 25 * 60 * 1000).toISOString()
  });
  const pending = {hint:'',amount:null,at};
  assert.equal(matchCheckout([cart],pending).order,undefined);
  assert.equal(matchCheckout([cart],pending,{
    confirmedIds:new Set(['WATCHED-OLD'])
  }).order?.agile_id,'WATCHED-OLD');
  assert.equal(matchCheckout([cart,order('WATCHED-2',{
    created_at:new Date(Date.now() - 20 * 60 * 1000).toISOString()
  })],pending,{
    confirmedIds:new Set(['WATCHED-OLD','WATCHED-2'])
  }).order,undefined);
});

test('checkout pendente nao imprime pedido Agile diferente antes de encontrar correspondencia', async () => {
  const originals = {
    configured:agile.configured,recent:agile.recentOrders,
    selected:storage.selectedPrinter,installed:printer.installedPrinters,
    print:printer.printReceipt,get:history.get,update:history.update,
    pending:history.pendingCheckout,initialized:history.monitorInitialized,
    initialize:history.initializeMonitor
  };
  const rows = new Map();
  let printed = 0;
  let requestedLimit = 0;
  const unrelated = order('UNRELATED',{
    created_at:new Date(Date.now() - 20 * 60 * 1000).toISOString()
  });
  try {
    agile.configured=()=>true;
    agile.recentOrders=async limit => { requestedLimit=limit; return {orders:[unrelated]}; };
    storage.selectedPrinter=()=> 'ELGIN';
    printer.installedPrinters=async()=>[{name:'ELGIN'}];
    printer.printReceipt=async()=>{printed++;};
    history.get=id=>rows.get(id)||null;
    history.update=(data,changes={})=>{
      const record={...(rows.get(data.agile_id)||{}),...data,...changes};
      rows.set(data.agile_id,record);
      return record;
    };
    history.pendingCheckout=()=>({
      hint:'UNKNOWN-ID',amount:99.5,at:new Date().toISOString(),session:'CHECKOUT-1'
    });
    history.monitorInitialized=()=>true;
    history.initializeMonitor=()=>{};
    const worker=new AgilePrintWorker({});
    await worker.tick();
    assert.equal(requestedLimit,25,'checkout should inspect more than first 5 orders');
    assert.equal(printed,0,'unrelated order must not be sent to Windows');
    assert.equal(rows.get('UNRELATED').print_count || 0,0);
  } finally {
    agile.configured=originals.configured;
    agile.recentOrders=originals.recent;
    storage.selectedPrinter=originals.selected;
    printer.installedPrinters=originals.installed;
    printer.printReceipt=originals.print;
    history.get=originals.get;
    history.update=originals.update;
    history.pendingCheckout=originals.pending;
    history.monitorInitialized=originals.initialized;
    history.initializeMonitor=originals.initialize;
  }
});
