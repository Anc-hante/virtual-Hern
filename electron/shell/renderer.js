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
  if (next === 'printers' && previous !== 'printers') void loadPrinters();
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
$('printer-test').onclick = async () => {
  if (!chosenPrinter || busy) return;
  busy = true;
  $('printer-test').disabled = true;
  setMessage('Enviando teste à impressora…');
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
