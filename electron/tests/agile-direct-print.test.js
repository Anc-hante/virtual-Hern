'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const printer = require('../printer');
const agile = require('../agile');
const storage = require('../storage');
const history = require('../agile-history');
const { receipt, AgilePrintWorker } = require('../agile-print');

function order(id) {
  return {
    agile_id:id,erp_order:'',transaction:'T-' + id,
    amount:'25.50', status:'aprovado',source:'pedidos',created_at:'2026-10-15'
  };
}

test('Agile receipt distinguishes Agile order from missing WinThor NUMPED and preserves decimal values', () => {
  const text = receipt(order('A-123'), [{
    product_id:'4702',product_name:'Ketchup',quantity:'2',price:'10.00',value:'20.00'
  }]);
  assert.match(text, /PEDIDO AGILE: A-123/);
  assert.match(text, /WINTHOR: AGUARDANDO INTEGRACAO/);
  assert.match(text, /TRANSACAO: T-A-123/);
  assert.match(text, /R\$ 10,00/);
  assert.match(text, /R\$ 25,50/);
  assert.doesNotMatch(text, /NUMPED WINTHOR: A-123/);
  assert.throws(() => receipt(order('A-123'), []), /produtos/);
});

test('Agile direct worker skips previous orders and prints newly discovered once', async () => {
  const orig = {
    configured:agile.configured, list:agile.list, items:agile.itemsForOrder,
    selected:storage.selectedPrinter, printers:printer.installedPrinters,
    print:printer.printReceipt, get:history.get, update:history.update
  };
  const records = new Map();
  const written = [];
  let polls = 0;
  try {
    agile.configured = () => true;
    storage.selectedPrinter = () => 'ELGIN i8 TEST';
    printer.installedPrinters = async () => [{name:'ELGIN i8 TEST'}];
    agile.itemsForOrder = async () => [{
      product_id:'4702',product_name:'Ketchup',quantity:'2',price:'12.75',value:'25.50'
    }];
    printer.printReceipt = async (_name, output) => { written.push(output); };
    history.get = id => records.get(id) || null;
    history.update = (record, options={}) => {
      const previous=records.get(record.agile_id)||{};
      const updated={...previous,...record,...options};
      records.set(record.agile_id,updated);
      return updated;
    };
    agile.list = async (_resource, filters) => {
      assert.equal(filters.codcli, '12678');
      polls++;
      return { data:(polls === 1 ? ['OLD'] : ['NEW', 'OLD']).map(id => ({
        id_pedido:id,codcli:'12678',status:'aprovado',valor_total:'25.50'
      })) };
    };
    const worker = new AgilePrintWorker({});
    await worker.tick();
    assert.equal(records.get('OLD').print_status, 'historical');
    assert.equal(written.length, 0);
    await worker.tick();
    assert.equal(written.length, 1);
    assert.equal(records.get('NEW').print_count, 1);
    await worker.tick();
    assert.equal(written.length, 1);
  } finally {
    agile.configured=orig.configured;
    agile.list=orig.list;
    agile.itemsForOrder=orig.items;
    storage.selectedPrinter=orig.selected;
    printer.installedPrinters=orig.printers;
    printer.printReceipt=orig.print;
    history.get=orig.get;
    history.update=orig.update;
  }
});

test('direct Agile worker has 45 second timer and no automatic Hernandes API calls', () => {
  const fs=require('node:fs');const path=require('node:path');
  const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'..','agile-print.js'),'utf8');
  assert.match(worker, /setInterval\(\(\) => void this\.tick\(\), 45000\)/);
  assert.match(main, /new agilePrint\.AgilePrintWorker/);
  assert.doesNotMatch(main, /api\.sendEvent\(/);
  assert.doesNotMatch(worker, /\.\/api|\/printer\/claim/);
});
