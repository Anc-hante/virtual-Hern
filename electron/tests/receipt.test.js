'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const QRCode = require('qrcode');
const {
  REGISTER_URL, sampleReceipt, checkRealOrder
} = require('../receipt-format');

test('customer QR encodes the exact registration URL and can be generated offline', async () => {
  assert.equal(REGISTER_URL, 'https://www.grupohernandes.com.br/cadastrar');
  const image = await QRCode.toBuffer(REGISTER_URL, { width: 440, margin: 4 });
  assert.equal(image.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(image.length > 500);
});

test('test print shows a complete example instead of a fake WinThor sale', () => {
  const sample = sampleReceipt();
  assert.match(sample, /PEDIDO: EXEMPLO/);
  assert.match(sample, /NAO E UM PEDIDO REAL/);
  assert.match(sample, /COD\. CLIENTE WINTHOR: 12678/);
  assert.match(sample, /TOTAL DO PEDIDO:/);
  assert.match(sample, /ESCANEIE O QR CODE/);
});

test('real printing rejects a missing or unverified WinThor NUMPED', () => {
  assert.throws(() => checkRealOrder({order:{order_number:''}}), /NUMPED/);
  assert.throws(() => checkRealOrder({order:{order_number:'CARRINHO-42'}}), /NUMPED/);
  assert.throws(() => checkRealOrder({order:{order_number:'12345',payload:{}}}), /reconciliacao/);
});

test('real WinThor order from customer 12678 is authorized', () => {
  assert.equal(checkRealOrder({order:{
    order_number:'987654',
    payload:{source:'winthor',totem_customer_code:12678}
  }}), '987654');
  assert.equal(checkRealOrder({order:{
    order_number:'987655',
    payload:{winthor_verified:true}
  }}), '987655');
});

test('printer preview and test use exactly the same full sample', async () => {
  const printer = require('../printer');
  const preview = await printer.receiptPreview();
  assert.match(preview.text, /PEDIDO: EXEMPLO/);
  assert.match(preview.text, /TOTAL DO PEDIDO:.*R\$ 40,30/);
  assert.equal(preview.qrUrl, REGISTER_URL);
  assert.match(preview.qrDataUrl, /^data:image\/png;base64,/);
  assert.ok(preview.example);
});
