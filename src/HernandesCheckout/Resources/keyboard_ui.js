(() => {
  if (window.__hernandesKeyboardUiInstalled) return;
  window.__hernandesKeyboardUiInstalled = true;

  let target = null;
  let kind = 'text';
  let shifted = false;
  let host = null;
  let shadow = null;

  const inputLike = el => {
    if (!el || !el.matches) return false;
    if (el.isContentEditable) return true;
    if (el.matches('textarea:not([disabled]):not([readonly])')) return true;
    if (!el.matches('input:not([disabled]):not([readonly])')) return false;
    return !/^(button|submit|reset|radio|checkbox|file|hidden|range|color|date|time|week|month|datetime-local)$/i
      .test(el.type || 'text');
  };
  const getKind = el => {
    const type = (el.type || '').toLowerCase();
    const mode = (el.inputMode || '').toLowerCase();
    if (['number','tel'].includes(type) || ['numeric','decimal','tel'].includes(mode)) return 'numeric';
    if (type === 'email' || mode === 'email') return 'email';
    return 'text';
  };
  const rows = () => kind === 'numeric'
    ? [
      ['1','2','3'], ['4','5','6'], ['7','8','9'],
      ['APAGAR','0','OK ↵']
    ]
    : [
      ['1','2','3','4','5','6','7','8','9','0'],
      [...'QWERTYUIOP'], [...'ASDFGHJKLÇ'],
      ['⇧ Shift',...'ZXCVBNM','APAGAR'],
      [kind === 'email' ? '@':'/', ',', '.', '-', '@', '#', 'ESPAÇO','OK ↵']
    ];

  function make() {
    if (host || !document.body) return;
    host = document.createElement('div');
    host.id = '__hernandes-keyboard-host';
    host.style.cssText = 'position:fixed;inset:auto 0 0;z-index:2147483647;display:none;pointer-events:auto';
    shadow = host.attachShadow({ mode:'open' });
    shadow.innerHTML = `
      <style>
        :host { all:initial; color-scheme:light; }
        .keyboard{box-sizing:border-box;background:#f7f8fa;border-top:3px solid #a7191f;
          box-shadow:0 -14px 35px rgba(20,22,28,.15);padding:8px 12px 12px;
          font-family:Segoe UI,Arial,sans-serif;touch-action:manipulation}
        header{display:flex;justify-content:space-between;align-items:center;
          height:28px;color:#8c262a;font:bold 12px Segoe UI,Arial;letter-spacing:.04em}
        header button{width:36px;height:27px;border:0;background:#eceef1;color:#333;
          border-radius:8px;font-size:20px}
        .keys{display:flex;flex-direction:column;gap:5px}
        .line{display:flex;justify-content:center;gap:5px}
        .key{flex:1 1 0;min-width:0;height:43px;padding:0 3px;border:1px solid #d5dbe3;
          background:#fff;color:#25303b;border-radius:9px;
          font:600 16px Segoe UI,Arial;cursor:pointer;touch-action:manipulation}
        .key:active{background:#e0e4e9;transform:translateY(1px)}
        .special{background:#e7ebf0;font-size:12px}
        .primary{background:#a7191f;color:#fff;border-color:#a7191f;font-size:14px}
        .wide{flex:3 1 0}
        .shifted{background:#fdebec;border-color:#a7191f}
        @media (min-height:900px){ .key{height:51px} }
      </style>
      <div class="keyboard">
        <header><span>HERNANDES • TECLADO VIRTUAL</span>
          <button id="close" aria-label="Fechar teclado">×</button></header>
        <div id="rows" class="keys"></div>
      </div>`;
    shadow.getElementById('close').addEventListener('click', hide);
    shadow.addEventListener('pointerdown', e => e.preventDefault());
    shadow.getElementById('rows').addEventListener('click', e => {
      const button = e.target.closest('button[data-value]');
      if (!button) return;
      const label = button.dataset.value;
      if (label === '⇧ Shift') { shifted = !shifted; draw(); return; }
      if (label === 'APAGAR') { type('backspace',''); return; }
      if (label === 'OK ↵') { type('enter',''); hide(); return; }
      const value = label === 'ESPAÇO' ? ' ' : (shifted ? label : label.toLowerCase());
      type('text',value);
    });
    document.body.appendChild(host);
  }
  function draw() {
    if (!shadow) return;
    const container = shadow.getElementById('rows');
    container.replaceChildren();
    for (const line of rows()) {
      const row = document.createElement('div');
      row.className = 'line';
      for (const char of line) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = char;
        b.textContent = char.length === 1 && /[A-ZÇ]/.test(char)
          ? (shifted ? char : char.toLowerCase()) : char;
        b.className = 'key' +
          (['APAGAR','⇧ Shift'].includes(char) ? ' special' : '') +
          (char === 'OK ↵' ? ' primary' : '') +
          (char === 'ESPAÇO' ? ' wide' : '') +
          (char === '⇧ Shift' && shifted ? ' shifted' : '');
        row.appendChild(b);
      }
      container.appendChild(row);
    }
  }
  function hide() {
    if (host) host.style.display = 'none';
  }
  function show(el) {
    make();
    if (!host) return;
    target = el;
    const next = getKind(el);
    if (kind !== next) { kind = next; shifted = false; }
    draw();
    host.style.display = 'block';
    // Overlay: do not resize the native browser surface.
    requestAnimationFrame(() => {
      if (!target || !target.isConnected) return;
      const rect = target.getBoundingClientRect();
      const available = window.innerHeight - host.offsetHeight - 15;
      if (rect.bottom > available) {
        window.scrollBy({ top: rect.bottom - available + 24, behavior:'instant' });
      }
    });
  }
  function type(action,text) {
    if (!target || !target.isConnected) return;
    if (typeof window.__hernandesType === 'function' &&
        window.__hernandesType(action,text)) return;
    // Local administrative form uses this fallback (no site bridge).
    if (!target.matches('input,textarea')) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    if (action === 'text') {
      target.setRangeText(text, start, end, 'end');
    } else if (action === 'backspace') {
      target.setRangeText('', start === end ? Math.max(0,start-1) : start, end, 'end');
    } else if (action === 'enter') {
      target.form?.requestSubmit?.();
      return;
    }
    target.dispatchEvent(new InputEvent('input',{bubbles:true,data:text}));
  }

  document.addEventListener('focusin', e => {
    if (inputLike(e.target)) show(e.target);
  },true);
  document.addEventListener('pointerdown', e => {
    if (!host || host.style.display === 'none') return;
    if (e.composedPath().includes(host)) return;
    if (!inputLike(e.target)) hide();
  },true);
  // Some touchscreen targets are focused before our script is injected.
  if (inputLike(document.activeElement)) show(document.activeElement);
})();
