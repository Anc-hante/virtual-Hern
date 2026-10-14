(() => {
  if (window.__hernandesKeyboardUiInstalled) return;
  const logic = window.__hernandesKeyboardLogic;
  if (!logic) {
    console.error('[Totem] Keyboard logic did not initialize.');
    return;
  }
  window.__hernandesKeyboardUiInstalled = true;

  let target = null;
  let kind = 'text';
  let shifted = false;
  let host = null;
  let shadow = null;
  let visible = false;
  let scrollFrame = 0;
  let gateOriginalStyles = null;

  function layout() {
    if (kind === 'numeric') {
      return [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['APAGAR', '0', 'OK ↵']
      ];
    }

    return [
      ['1','2','3','4','5','6','7','8','9','0'],
      [...'QWERTYUIOP'],
      [...'ASDFGHJKLÇ'],
      ['⇧ Shift', ...'ZXCVBNM', 'APAGAR'],
      [kind === 'email' ? '@' : '/', ',', '.', '-', '@', '#', 'ESPAÇO', 'OK ↵']
    ];
  }

  function init() {
    if (host || !document.body) return;
    host = document.createElement('div');
    host.id = '__hernandes-keyboard-host';
    host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:none;pointer-events:auto';
    shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { color-scheme: light; }
        *, *::before, *::after { box-sizing: border-box; }
        .keyboard {
          padding: 8px 12px max(12px, env(safe-area-inset-bottom));
          background: #f6f7fa;
          border-top: 2px solid #a7191f;
          box-shadow: 0 -10px 26px rgba(20,22,28,.16);
          font-family: "Segoe UI", Arial, sans-serif;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 28px;
          margin-bottom: 5px;
          font: 700 12px "Segoe UI", Arial, sans-serif;
          letter-spacing: .03em;
          color: #8a262b;
        }
        button {
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          cursor: pointer;
          white-space: nowrap;
        }
        #close {
          width: 44px;
          height: 30px;
          border: 0;
          border-radius: 8px;
          color: #39414f;
          background: #e9ebef;
          font: 700 21px "Segoe UI", Arial, sans-serif;
        }
        .keys { display: flex; flex-direction: column; gap: 5px; }
        .line { display: flex; gap: 5px; width: 100%; }
        .key {
          flex: 1 1 0;
          min-width: 0;
          height: clamp(42px, 5.7vh, 58px);
          padding: 0 3px;
          border: 1px solid #d4d9e1;
          border-radius: 9px;
          color: #28313d;
          background: white;
          font: 600 clamp(14px, 1.7vw, 18px) "Segoe UI", Arial, sans-serif;
        }
        .key:active { background: #e2e7ed; }
        .special { background: #e8ebf1; font-size: 13px; }
        .primary { background: #a7191f; color: white; border-color: #a7191f; }
        .wide { flex: 3 1 0; }
        .shifted { background: #fdebec; border-color: #a7191f; }
        @media (max-width: 800px) {
          .keyboard { padding-left: 5px; padding-right: 5px; }
          .line { gap: 3px; }
          .key { font-size: 13px; }
        }
      </style>
      <div class="keyboard" role="group" aria-label="Teclado virtual">
        <header>
          <span>HERNANDES · TECLADO VIRTUAL</span>
          <button id="close" type="button" aria-label="Fechar teclado">×</button>
        </header>
        <div id="rows" class="keys"></div>
      </div>`;

    // Windows touch produces pointer events reliably, but synthetic click
    // may be suppressed after preventDefault(pointerdown). Handle a key
    // ONCE on pointerdown, without letting Chromium move focus away from
    // the customer's input. This also prevents double characters.
    const activateKey = (key) => {
      if (!key) return;
      const action = key.dataset.value;
      if (action === '✕') {
        hide(true);
        return;
      }
      if (!target || !target.isConnected || !logic.editable(target)) {
        hide(true);
        return;
      }
      // Input can be in a centered fixed modal, so do not trigger scroll.
      try { target.focus({ preventScroll: true }); } catch (_) {}

      if (action === '⇧ Shift') {
        shifted = !shifted;
        draw();
        return;
      }
      if (action === 'APAGAR') {
        logic.insert(target, 'backspace');
        return;
      }
      if (action === 'OK ↵') {
        logic.sendEnter(target);
        hide(true);
        return;
      }

      const value = action === 'ESPAÇO' ? ' ' :
        (shifted ? action : action.toLowerCase());
      logic.insert(target, 'text', value);
      if (shifted && /^[A-ZÇ]$/i.test(value)) {
        shifted = false;
        draw();
      }
    };

    shadow.addEventListener('pointerdown', event => {
      const key = event.target.closest?.('button');
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      if (key.id === 'close') {
        hide(true);
      } else {
        activateKey(key);
      }
    }, true);

    // Keyboard activation (Enter/Space on a focused button) still works.
    // Touch-generated clicks have detail > 0 and are handled above.
    shadow.addEventListener('click', event => {
      if (event.detail !== 0) return;
      const key = event.target.closest?.('button');
      if (key?.id === 'close') hide(true);
      else activateKey(key);
    });

    document.body.appendChild(host);
  }

  function draw() {
    if (!shadow) return;
    const rows = shadow.getElementById('rows');
    rows.replaceChildren();
    for (const items of layout()) {
      const line = document.createElement('div');
      line.className = 'line';
      for (const value of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = value;
        button.textContent = value.length === 1 && /^[A-ZÇ]$/.test(value)
          ? (shifted ? value : value.toLowerCase()) : value;
        const special = ['⇧ Shift', 'APAGAR'].includes(value);
        button.className = 'key' +
          (special ? ' special' : '') +
          (value === 'OK ↵' ? ' primary' : '') +
          (value === 'ESPAÇO' ? ' wide' : '') +
          (value === '⇧ Shift' && shifted ? ' shifted' : '');
        line.appendChild(button);
      }
      rows.appendChild(line);
    }
  }

  function hide(clearTarget = false) {
    if (gateOriginalStyles?.element?.isConnected) {
      const gate = gateOriginalStyles.element;
      gate.style.placeItems = gateOriginalStyles.placeItems;
      gate.style.overflowY = gateOriginalStyles.overflowY;
      gate.style.paddingBottom = gateOriginalStyles.paddingBottom;
    }
    gateOriginalStyles = null;
    visible = false;
    if (host) host.style.display = 'none';
    if (clearTarget) target = null;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  window.__hernandesHideKeyboard = () => hide(true);

  function revealField() {
    if (!visible || !target || !target.isConnected || !host) return;
    const edge = window.innerHeight - host.getBoundingClientRect().height - 12;
    const rect = target.getBoundingClientRect();
    if (rect.bottom <= edge && rect.top >= 0) return;
    const offset = rect.bottom - edge + 16;
    if (offset <= 0) return;

    // The administrator form scrolls inside #surface. Product dialogs may
    // also have their own scroll container, so use the nearest one.
    let parent = target.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 2) {
        parent.scrollTop += offset;
        return;
      }
      parent = parent.parentElement;
    }
    window.scrollBy(0, offset);
  }

  function show(element) {
    if (!logic.editable(element)) return;
    init();
    if (!host) return;
    const gate = document.getElementById('__hernandes-customer-gate');
    if (gate && gateOriginalStyles?.element !== gate) {
      gateOriginalStyles = {
        element: gate,
        placeItems: gate.style.placeItems,
        overflowY: gate.style.overflowY,
        paddingBottom: gate.style.paddingBottom
      };
      // Fixed customer modal previously remained vertically centered
      // underneath the keyboard, obscuring telephone/name fields.
      gate.style.placeItems = 'start center';
      gate.style.overflowY = 'auto';
      gate.style.paddingBottom = '290px';
    }

    const nextKind = logic.keyboardKind(element);
    const redraw = !visible || nextKind !== kind;
    target = element;
    if (nextKind !== kind) {
      kind = nextKind;
      shifted = false;
    }
    if (redraw) draw();
    if (!visible) {
      host.style.display = 'block';
      visible = true;
    }
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(revealField);
  }

  const editableFromEvent = event =>
    (event.composedPath?.() || []).find(node => logic.editable(node)) ||
    (logic.editable(event.target) ? event.target : null);

  document.addEventListener('focusin', event => {
    const field = editableFromEvent(event);
    if (field) show(field);
  }, true);

  // Pointerdown also opens the keyboard when the user taps an ALREADY
  // focused field after dismissing it. focusin alone never fired there.
  document.addEventListener('pointerdown', event => {
    if (host && event.composedPath().includes(host)) return;
    const field = editableFromEvent(event);
    if (field) {
      show(field);
    } else if (visible) {
      hide(true);
    }
  }, true);

  if (logic.editable(document.activeElement)) {
    show(document.activeElement);
  }
})();
