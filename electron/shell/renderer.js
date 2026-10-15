'use strict';
const $ = id => document.getElementById(id);
let current = 'loading';
let chosenPrinter = '';
let busy = false;

function setMessage(text, error = false) {
  const el = $('printer-message');
  el.textContent = text;
  el.style.color = error ? '#b42318' : '#526477';
}
function updateToolbar(state) {
  $('back').disabled = current !== 'shop' || !state.canGoBack;
  $('refresh').disabled = current !== 'shop';
  $('restart').disabled = current !== 'shop';
  $('settings').disabled = current !== 'shop';
  $('status').textContent = state.ready ? 'Pronto para atendimento' : 'Abrindo e-commerce…';
}
function confetti() {
  const el = $('confetti');
  el.replaceChildren();
  const colors = ['#a7191f','#dc3545','#ffcf57','#34a853','#fff'];
  for (let i=0; i<56; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti-piece';
    bit.style.left = Math.floor(Math.random() * 100) + '%';
    bit.style.background = colors[i%colors.length];
    bit.style.animationDelay = Math.floor(Math.random()*500) + 'ms';
    bit.style.animationDuration = (2 + Math.random()*1.5).toFixed(2) + 's';
    el.appendChild(bit);
  }
  setTimeout(() => el.replaceChildren(), 5000);
}
async function invoke(action, data) {
  try { return await window.kiosk.invoke(action,data); }
  catch (e) { return { ok:false, error:e.message || String(e) }; }
}
async function loadPrinters() {
  setMessage('Buscando impressoras instaladas no Windows…');
  $('printer-list').replaceChildren();
  const result = await invoke('admin:printers');
  if (!result.ok) {
    setMessage(result.error || 'Não foi possível consultar impressoras.', true);
    return;
  }
  chosenPrinter = result.selected || '';
  $('saved-printer').textContent = chosenPrinter || 'Nenhuma impressora selecionada';
  for (const p of result.printers || []) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'printer';
    option.setAttribute('role','radio');
    option.setAttribute('aria-checked',String(p.name === chosenPrinter));
    option.dataset.name = p.name;
    const label = document.createElement('span');
    label.textContent = p.displayName || p.name;
    option.appendChild(label);
    if (p.isDefault) {
      const badge = document.createElement('small');
      badge.textContent = 'Padrão';
      option.appendChild(badge);
    }
    option.addEventListener('click',() => {
      chosenPrinter = p.name;
      document.querySelectorAll('.printer').forEach(e =>
        e.setAttribute('aria-checked',String(e.dataset.name === chosenPrinter)));
      $('printer-save').disabled = false;
      $('printer-test').disabled = false;
      setMessage('Impressora selecionada. Faça um teste antes de salvar.');
    });
    $('printer-list').appendChild(option);
  }
  if (!chosenPrinter && result.printers?.length) {
    chosenPrinter = result.printers.find(p=>p.isDefault)?.name || result.printers[0].name;
  }
  document.querySelectorAll('.printer').forEach(e =>
    e.setAttribute('aria-checked',String(e.dataset.name === chosenPrinter)));
  $('printer-save').disabled = !chosenPrinter;
  $('printer-test').disabled = !chosenPrinter;
  setMessage((result.printers || []).length
    ? (result.printers.length + ' impressora(s) encontrada(s).')
    : 'Nenhuma impressora instalada. Conecte e instale no Windows.', !(result.printers || []).length);
}
function display(state) {
  const next = state.screen || 'loading';
  const previous = current;
  current = next;
  if (next !== 'login') window.__hernandesHideKeyboard?.();
  document.querySelectorAll('[data-pane]').forEach(pane => {
    pane.hidden = pane.dataset.pane !== next;
  });
  updateToolbar(state);
  if (next === 'complete' && previous !== 'complete') confetti();
  if (next === 'login' && previous !== 'login') {
    $('admin-user').value = '';
    $('admin-pass').value = '';
    $('login-error').textContent = '';
  }
  if (next === 'printers' && previous !== 'printers') {
    for (const tab of ['printer', 'orders', 'agile']) {
      const active = tab === 'printer';
      $('admin-' + tab + '-panel').hidden = !active;
      $('admin-tab-' + tab).classList.toggle('selected', active);
      $('admin-tab-' + tab).setAttribute('aria-pressed', String(active));
    }
    $('api-token-input').value = '';
    $('receipt-preview-panel').hidden = true;
    $('receipt-preview-button').textContent = '👁 Visualizar modelo completo do cupom (80 mm + QR Code)';
    void loadPrinters();
  }
  // Don't autofocus login: virtual keyboard should open only when asked.
}
window.kiosk.onState(display);

$('back').onclick = () => void invoke('back');
$('refresh').onclick = () => void invoke('refresh');
$('restart').onclick = () => void invoke('restart');
$('settings').onclick = () => void invoke('admin:open');
$('retry').onclick = () => void invoke('retry');
$('new-session').onclick = () => void invoke('new-session');
$('login-close').onclick = () => void invoke('admin:close');
$('printer-close').onclick = () => void invoke('admin:close');
$('printer-refresh').onclick = () => void loadPrinters();
$('login-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const result = await invoke('admin:login',{
    username:$('admin-user').value,
    password:$('admin-pass').value
  });
  $('admin-pass').value = '';
  if (!result.ok) $('login-error').textContent = result.error || 'Não autorizado.';
  busy = false;
};
async function showReceiptPreview(forceOpen = false) {
  const panel = $('receipt-preview-panel');
  if (!forceOpen && !panel.hidden) {
    panel.hidden = true;
    $('receipt-preview-button').textContent = '👁 Visualizar modelo completo do cupom (80 mm + QR Code)';
    return;
  }

  const result = await invoke('admin:preview');
  if (!result.ok) {
    setMessage(result.error || 'Nao foi possivel visualizar o cupom.', true);
    return;
  }

  $('receipt-preview-text').textContent = result.text || '';
  $('receipt-preview-qr').src = result.qrDataUrl || '';
  panel.hidden = false;
  $('receipt-preview-button').textContent = 'Ocultar modelo do cupom';
}
$('receipt-preview-button').onclick = () => void showReceiptPreview();

let orderOffset = 0;
let selectedOrder = null;
let orderRecords = [];
let ordersBusy = false;
let ordersRequest = 0;

function orderMessage(message, error = false) {
  const el = $('orders-message');
  el.textContent = message;
  el.style.color = error ? '#a7191f' : '#526477';
}
function adminTab(name) {
  for (const tab of ['printer', 'orders', 'agile']) {
    const active = name === tab;
    $('admin-' + tab + '-panel').hidden = !active;
    $('admin-tab-' + tab).classList.toggle('selected', active);
    $('admin-tab-' + tab).setAttribute('aria-pressed', String(active));
  }
  window.__hernandesHideKeyboard?.();
  if (name === 'orders') void loadOrders(0);

  if (name === 'agile') void loadAgileStatus();
}
$('admin-tab-printer').onclick = () => adminTab('printer');
$('admin-tab-orders').onclick = () => adminTab('orders');
// Legacy Hernandes API is no longer needed for Agile order lookup.
$('admin-tab-agile').onclick = () => adminTab('agile');


let agileBusy = false;
function agileMessage(message, error = false) {
  const element = $('agile-message');
  element.textContent = message;
  element.style.color = error ? '#a7191f' : '#526477';
}
async function loadAgileStatus() {
  const result = await invoke('admin:agile-status');
  if (current !== 'printers') return;
  $('agile-status').textContent = result.ok
    ? (result.configured ? 'Credenciais Agile configuradas' : 'Agile ainda não configurado')
    : 'Não foi possível ler a configuração Agile';
  if (!result.ok) agileMessage(result.error || 'Falha na configuração.', true);
}
$('agile-save').onclick = async () => {
  if (agileBusy) return;
  const clientId = $('agile-client-id').value.trim();
  const clientSecret = $('agile-client-secret').value.trim();
  if (!clientId || !clientSecret) {
    agileMessage('Preencha os dois campos: Client ID e Client Secret.', true);
    return;
  }
  agileBusy = true;
  $('agile-save').disabled = true;
  agileMessage('Salvando credenciais com proteção do Windows…');
  $('agile-client-id').value = '';
  $('agile-client-secret').value = '';
  const result = await invoke('admin:agile-save', { clientId, clientSecret });
  agileBusy = false;
  $('agile-save').disabled = false;
  agileMessage(result.message || result.error || 'Falha ao salvar.', !result.ok);
  await loadAgileStatus();
};
$('agile-test').onclick = async () => {
  if (agileBusy) return;
  agileBusy = true;
  $('agile-test').disabled = true;
  $('agile-test-results').hidden = true;
  agileMessage('Consultando Agile: pedidos, pedidos ERP e produtos…');
  const result = await invoke('admin:agile-test');
  agileBusy = false;
  $('agile-test').disabled = false;
  const panel = $('agile-test-results');
  panel.replaceChildren();
  if (!result.sources) {
    agileMessage(result.error || 'Nao foi possivel autenticar no Agile.', true);
    return;
  }
  agileMessage(result.message || 'Consulta concluida.', !result.connected);
  for (const source of result.sources) {
    const area = document.createElement('div');
    area.className = 'agile-source';
    const title = document.createElement('strong');
    title.textContent = source.resource + ': ' + (source.ok
      ? (source.checked + ' registros consultados') : 'ERRO');
    area.appendChild(title);
    const detail = document.createElement('p');
    detail.textContent = source.ok
      ? ('Total informado: ' + (source.total || '?') +
        ' | Totem 12678: ' + (source.totem_found || 0) +
        ' | Campos: ' + (source.fields || []).join(', '))
      : source.error;
    area.appendChild(detail);
    panel.appendChild(area);
  }
  for (const order of (result.orders || []).slice(0, 10)) {
    const item = document.createElement('p');
    item.textContent = 'Agile #' + (order.agile_id || '?') +
      ' | NUMPED: ' + (order.erp_order || 'nao disponivel') +
      ' | Transacao: ' + (order.transaction || 'nao disponivel') +
      ' | Status: ' + (order.status || 'sem status');
    panel.appendChild(item);
  }
  if (result.itemSample) {
    const title = document.createElement('strong');
    title.textContent = 'Itens do pedido: ' + (result.itemSample.count || 0) + ' produto(s)';
    panel.appendChild(title);
    if (result.itemSample.error) {
      const line = document.createElement('p');
      line.textContent = 'Consulta de itens: ' + result.itemSample.error;
      panel.appendChild(line);
    }
    for (const product of (result.itemSample.items || [])) {
      const line = document.createElement('p');
      line.textContent = [product.product_id,product.product_name].filter(Boolean).join(' ') +
        ' | Qtde: ' + (product.quantity || '?') +
        ' | Total R$ ' + (product.value || product.price || '?');
      panel.appendChild(line);
    }
  }
  panel.hidden = false;
};

let apiBusy = false;
function apiMessage(message, error = false) {
  const area = $('api-message');
  area.textContent = message;
  area.style.color = error ? '#a7191f' : '#526477';
}
async function loadApiStatus() {
  const result = await invoke('admin:api-status');
  if (current !== 'printers') return;
  if (!result.ok) {
    $('api-status').textContent = 'Configuração indisponível';
    apiMessage(result.error || 'Não foi possível verificar a configuração.', true);
    return;
  }
  $('api-status').textContent = result.configured
    ? 'Token configurado no computador'
    : 'Token ainda não configurado';
  $('api-internal-cert-mode').checked = result.internalCertificateMode === true;
  $('api-internal-cert-mode').disabled = result.internalCertificateAvailable !== true;
  $('api-cert-mode-save').disabled = result.internalCertificateAvailable !== true;
  $('api-cert-mode-message').textContent = result.internalCertificateMode
    ? 'Modo de homologação ativo. A API interna não verifica a autoridade do certificado.'
    : 'HTTPS estrito ativado (padrão).';
  apiMessage(result.configured
    ? 'Para trocar o token, insira um novo valor e toque em Salvar.'
    : 'Cole o token gerado no servidor do HernandesDash.');
}
$('api-cert-mode-save').onclick = async () => {
  if (apiBusy) return;
  apiBusy = true;
  $('api-cert-mode-save').disabled = true;
  const enabled = $('api-internal-cert-mode').checked;
  const result = await invoke('admin:api-certificate-mode', { enabled });
  apiBusy = false;
  await loadApiStatus();
  const el = $('api-cert-mode-message');
  el.textContent = result.message || result.error || 'Falha ao aplicar configuração.';
  el.style.color = result.ok ? (enabled ? '#9a3412' : '#28673b') : '#a7191f';
  if (result.ok) apiMessage('Configuração HTTPS alterada. Clique em Testar conexão.');
};
$('api-save').onclick = async () => {
  if (apiBusy) return;
  const token = $('api-token-input').value.trim();
  if (token.length < 16) {
    apiMessage('Digite o token completo (mínimo de 16 caracteres).', true);
    return;
  }
  apiBusy = true;
  $('api-save').disabled = true;
  $('api-token-input').value = '';
  apiMessage('Salvando a credencial com proteção do Windows…');
  const result = await invoke('admin:api-save', { token });
  $('api-save').disabled = false;
  apiBusy = false;
  await loadApiStatus();
  apiMessage(result.message || result.error || 'Falha ao salvar token.', !result.ok || !result.connected);
};
$('api-test').onclick = async () => {
  if (apiBusy) return;
  apiBusy = true;
  $('api-test').disabled = true;
  apiMessage('Testando acesso ao HernandesDash…');
  const result = await invoke('admin:api-test');
  $('api-test').disabled = false;
  apiBusy = false;
  apiMessage(result.message || result.error || 'Falha ao conectar.', !result.ok);
};

function statusLabel(status) {
  return ({
    printed: 'Enviado à impressora',
    pending: 'Aguardando impressão',
    claimed: 'Em impressão',
    failed: 'Falha na impressão'
  })[status] || 'Sem informação';
}
function money(value) {
  return value === null || value === undefined
    ? 'Valor indisponível'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(Number(value));
}
function orderDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
}
function showOrderConfirmation(order) {
  selectedOrder = order;
  $('orders-confirm-number').textContent =
    (order.number_type === 'winthor' ? 'Pedido WinThor ' : 'Pedido Agile ') +
    (order.order_number || 'sem número');
  $('orders-confirm').hidden = false;
  $('orders-confirm').scrollIntoView({ block:'nearest', behavior:'smooth' });
}
$('orders-cancel').onclick = () => {
  selectedOrder = null;
  $('orders-confirm').hidden = true;
};

function renderOrders(result) {
  orderRecords = Array.isArray(result.orders) ? result.orders : [];
  const container = $('orders-list');
  container.replaceChildren();
  for (const order of orderRecords) {
    const row = document.createElement('div');
    row.className = 'order-row';

    const detail = document.createElement('div');
    detail.className = 'order-detail';
    const num = document.createElement('strong');
    num.textContent = (order.number_type === 'winthor' ? 'WinThor ' : 'Agile ') +
      (order.order_number || 'pendente');
    const date = document.createElement('small');
    date.textContent = orderDate(order.occurred_at);
    const amount = document.createElement('small');
    amount.className = 'order-total';
    amount.textContent = money(order.amount) +
      '  ·  Vias enviadas: ' + (Number(order.print_count) || 0);
    const status = document.createElement('span');
    status.className = 'order-status ' + (['printed','failed','pending'].includes(order.print_status)
      ? order.print_status : '');
    status.textContent = statusLabel(order.print_status);
    detail.append(num, date, amount, status);

    const button = document.createElement('button');
    button.className = 'button secondary';
    button.type = 'button';
    button.textContent = order.reprint_allowed
      ? '🧾 Reimprimir'
      : (order.print_status === 'claimed' ? 'Imprimindo' : 'Indisponivel');
    button.disabled = !order.reprint_allowed;
    button.addEventListener('click', () => showOrderConfirmation(order));

    row.append(detail, button);
    container.append(row);
  }

  if (!orderRecords.length) {
    const empty = document.createElement('p');
    empty.className = 'orders-note';
    empty.textContent = 'Nenhum pedido encontrado. Tente outro número ou atualize a lista.';
    container.appendChild(empty);
  }

  const count = Number(result.count) || 0;
  $('orders-page-label').textContent = count
    ? (orderOffset + 1) + '–' + (orderOffset + orderRecords.length) + ' de ' + count
    : '0 pedidos';
  $('orders-prev').disabled = orderOffset <= 0;
  $('orders-next').disabled = result.next_offset === null ||
    result.next_offset === undefined;
}

async function loadOrders(offset = 0) {
  // Request sequence protects the UI against obsolete out-of-order responses.
  const requestId = ++ordersRequest;
  orderOffset = Math.max(0, Number(offset) || 0);
  selectedOrder = null;
  $('orders-confirm').hidden = true;
  $('orders-search-button').disabled = true;
  $('orders-refresh').disabled = true;
  orderMessage('Consultando diretamente os pedidos no Agile…');
  const result = await invoke('admin:orders', {
    search: $('orders-search').value.trim(),
    offset: orderOffset
  });
  if (requestId !== ordersRequest || current !== 'printers') return;
  $('orders-search-button').disabled = false;
  $('orders-refresh').disabled = false;
  if (!result.ok) {
    $('orders-list').replaceChildren();
    $('orders-prev').disabled = true;
    $('orders-next').disabled = true;
    $('orders-page-label').textContent = 'Consulta indisponível';
    orderMessage(result.error || 'Não foi possível consultar o histórico.', true);
    return;
  }
  renderOrders(result);
  orderMessage(result.warning ? ('Historico local. Atualizacao Agile: ' + result.warning) : 'Pedidos deste totem consultados diretamente no Agile.', !!result.warning);
}
$('orders-search-button').onclick = () => void loadOrders(0);
$('orders-refresh').onclick = () => void loadOrders(orderOffset);
$('orders-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); void loadOrders(0); }
});
$('orders-prev').onclick = () => void loadOrders(Math.max(0, orderOffset - 25));
$('orders-next').onclick = () => void loadOrders(orderOffset + 25);
$('orders-confirm-button').onclick = async () => {
  if (!selectedOrder || ordersBusy) return;
  ordersBusy = true;
  const id = selectedOrder.id;
  $('orders-confirm-button').disabled = true;
  orderMessage('Enviando solicitação de reimpressão…');
  const result = await invoke('admin:reprint', { orderId: id });
  $('orders-confirm-button').disabled = false;
  ordersBusy = false;
  selectedOrder = null;
  $('orders-confirm').hidden = true;
  if (!result.ok) {
    orderMessage(result.error || 'Não foi possível solicitar reimpressão.', true);
    return;
  }
  await loadOrders(orderOffset);
  orderMessage('Cupom enviado ao Windows. Aguarde a impressora concluir.');
};

$('printer-test').onclick = async () => {
  if (!chosenPrinter || busy) return;
  busy = true;
  $('printer-test').disabled = true;
  setMessage('Gerando cupom de teste com QR Code…');
  await showReceiptPreview(true);
  const result = await invoke('admin:test',{name:chosenPrinter});
  setMessage(result.message || result.error || 'Falha de impressão.',!result.ok);
  $('printer-test').disabled = false;
  busy = false;
};
$('printer-save').onclick = async () => {
  if (!chosenPrinter || busy) return;
  busy = true;
  const result = await invoke('admin:save',{name:chosenPrinter});
  if (result.ok) $('saved-printer').textContent = chosenPrinter;
  setMessage(result.message || result.error || 'Não foi possível salvar.',!result.ok);
  busy = false;
};
