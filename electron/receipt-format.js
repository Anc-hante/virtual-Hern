'use strict';

const REGISTER_URL = 'https://www.grupohernandes.com.br/cadastrar';
const WIDTH = 40;

function sampleReceipt() {
  const today = new Date().toLocaleString('pt-BR', {hour12:false});
  return [
    'HERNANDES ATACADO E DISTRIBUICAO'.padStart(37,' '),
    '='.repeat(WIDTH),
    '        CUPOM DE DEMONSTRACAO',
    '       NAO E UM PEDIDO REAL',
    '='.repeat(WIDTH),
    'PEDIDO: EXEMPLO (NUMPED NO CUPOM REAL)',
    'DATA: ' + today,
    'CLIENTE: EXEMPLO TOTEM',
    'COD. CLIENTE WINTHOR: 12678',
    '-'.repeat(WIDTH),
    'ITENS DO PEDIDO',
    '-'.repeat(WIDTH),
    '4702  KETCHUP HEINZ 397G',
    '  2 UN x R$ 10,90         R$ 21,80',
    '7686  COBERTURA CHOCOLATE',
    '  1 UN x R$ 18,50         R$ 18,50',
    '-'.repeat(WIDTH),
    'ITENS: 3',
    'TOTAL DO PEDIDO:          R$ 40,30',
    '='.repeat(WIDTH),
    '',
    '      OBRIGADO PELA SUA COMPRA!',
    '     SEU PEDIDO FOI REGISTRADO.',
    '',
    '      CADASTRE-SE NA HERNANDES',
    '      ESCANEIE O QR CODE ABAIXO',
    '',
  ].join('\n');
}
function checkRealOrder(job) {
  const numped = String(job?.order?.order_number || '').trim();
  if (!/^\d+$/.test(numped) || numped === '0') {
    throw new Error('Pedido sem numero NUMPED confirmado no WinThor; cupom nao enviado.');
  }
  const payload = job.order.payload || {};
  if (payload.winthor_verified !== true && Number(payload.totem_customer_code) !== 12678) {
    throw new Error('Aguardando reconciliacao do pedido com o cliente 12678 no WinThor.');
  }
  return numped;
}
module.exports = { REGISTER_URL, WIDTH, sampleReceipt, checkRealOrder };
