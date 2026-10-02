(() => {
  if (window.__hernandesInstalled) return;
  window.__hernandesInstalled = true;

  const editable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    const t = (el.type || 'text').toLowerCase();
    return !['button','submit','reset','checkbox','radio','file','hidden'].includes(t);
  };

  const kindOf = (el) => {
    const t = (el.type || '').toLowerCase();
    const m = (el.inputMode || '').toLowerCase();
    if (t === 'number' || t === 'tel' || m === 'numeric' || m === 'decimal') return 'numeric';
    if (t === 'email' || m === 'email') return 'email';
    return 'text';
  };

  document.addEventListener('focusin', (e) => {
    if (!editable(e.target)) return;
    window.__hernandesTarget = e.target;
    try { e.target.scrollIntoView({behavior:'smooth', block:'center'}); } catch (_) {}
    console.log('__HERN_KB__' + JSON.stringify({event:'show', kind:kindOf(e.target)}));
  }, true);

  document.addEventListener('pointerdown', (e) => {
    if (!editable(e.target)) {
      console.log('__HERN_KB__' + JSON.stringify({event:'hide'}));
    }
  }, true);

  window.__hernandesType = (action, text) => {
    const el = window.__hernandesTarget;
    if (!el) return false;
    try { el.focus(); } catch (_) {}

    const value = el.value || '';
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length;

    if (action === 'text') {
      el.value = value.slice(0, start) + text + value.slice(end);
      const p = start + text.length;
      try { el.setSelectionRange(p, p); } catch (_) {}
      el.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    }

    if (action === 'backspace') {
      let next = value;
      let p = start;
      if (start !== end) next = value.slice(0, start) + value.slice(end);
      else if (start > 0) { next = value.slice(0, start - 1) + value.slice(end); p = start - 1; }
      el.value = next;
      try { el.setSelectionRange(p, p); } catch (_) {}
      el.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    }

    if (action === 'enter') {
      el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
      try { el.blur(); } catch (_) {}
      console.log('__HERN_KB__' + JSON.stringify({event:'hide'}));
      return true;
    }

    return false;
  };
})();