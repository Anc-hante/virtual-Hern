(() => {
  if (window.__hernandesKeyboardInstalled) return;
  window.__hernandesKeyboardInstalled = true;
  window.__hernandesTarget = null;

  const editable = (el) => {
    if (!el) return false;
    if (el.isContentEditable) return true;

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') {
      return !el.disabled && !el.readOnly;
    }

    if (tag !== 'input') return false;

    const type = (el.type || 'text').toLowerCase();
    const ignored = new Set([
      'button', 'submit', 'reset', 'checkbox', 'radio',
      'file', 'image', 'hidden', 'range', 'color',
      'date', 'datetime-local', 'month', 'time', 'week'
    ]);

    return !ignored.has(type) && !el.disabled && !el.readOnly;
  };

  const kindOf = (el) => {
    const type = (el.type || '').toLowerCase();
    const mode = (el.inputMode || '').toLowerCase();

    if (
      type === 'number' ||
      type === 'tel' ||
      mode === 'numeric' ||
      mode === 'decimal'
    ) {
      return 'numeric';
    }

    if (type === 'email' || mode === 'email') {
      return 'email';
    }

    return 'text';
  };

  const post = (payload) => {
    try {
      window.chrome?.webview?.postMessage(payload);
    } catch (_) {}
  };

  const targetVisible = () => {
    const el = window.__hernandesTarget;
    if (!el || !document.contains(el)) return;

    try {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    } catch (_) {}
  };

  window.__hernandesEnsureTargetVisible = targetVisible;

  window.__hernandesKeyboardDismiss = () => {
    const el = window.__hernandesTarget;

    if (el) {
      try { el.blur(); } catch (_) {}
    }

    window.__hernandesTarget = null;
  };

  const selectTarget = (el) => {
    window.__hernandesTarget = el;

    post({
      type: 'keyboard',
      action: 'show',
      kind: kindOf(el)
    });

    window.setTimeout(targetVisible, 70);
  };

  document.addEventListener('focusin', (event) => {
    if (editable(event.target)) {
      selectTarget(event.target);
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    if (editable(event.target)) {
      selectTarget(event.target);
      return;
    }

    post({
      type: 'keyboard',
      action: 'hide'
    });
  }, true);

  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  };

  const emitInput = (el, inputType, data = null) => {
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType,
        data
      }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  window.__hernandesType = (action, text = '') => {
    const el = window.__hernandesTarget;

    if (!el || !document.contains(el)) {
      return false;
    }

    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      try { el.focus(); } catch (_) {}
    }

    if (el.isContentEditable) {
      if (action === 'backspace') {
        document.execCommand('delete', false, null);
      } else if (action === 'text') {
        document.execCommand('insertText', false, text);
      } else if (action === 'enter') {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          const event = new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
            composed: true
          });

          try {
            Object.defineProperty(event, 'keyCode', {
              configurable: true,
              get: () => 13
            });
            Object.defineProperty(event, 'which', {
              configurable: true,
              get: () => 13
            });
          } catch (_) {}

          el.dispatchEvent(event);
        }

        window.setTimeout(() => {
          post({ type: 'keyboard', action: 'hide' });
        }, 40);
      }

      return true;
    }

    const value = el.value || '';
    const start = typeof el.selectionStart === 'number'
      ? el.selectionStart
      : value.length;
    const end = typeof el.selectionEnd === 'number'
      ? el.selectionEnd
      : value.length;

    if (action === 'text') {
      const next =
        value.slice(0, start) +
        text +
        value.slice(end);

      setNativeValue(el, next);

      const caret = start + text.length;

      try {
        el.setSelectionRange(caret, caret);
      } catch (_) {}

      emitInput(el, 'insertText', text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (action === 'backspace') {
      let next = value;
      let caret = start;

      if (start !== end) {
        next =
          value.slice(0, start) +
          value.slice(end);
      } else if (start > 0) {
        next =
          value.slice(0, start - 1) +
          value.slice(end);
        caret = start - 1;
      }

      setNativeValue(el, next);

      try {
        el.setSelectionRange(caret, caret);
      } catch (_) {}

      emitInput(el, 'deleteContentBackward');
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    if (action === 'enter') {
      const fireEnter = (type) => {
        const event = new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          location: 0,
          bubbles: true,
          cancelable: true,
          composed: true
        });

        // Several legacy search handlers still inspect keyCode/which
        // instead of event.key. Synthetic KeyboardEvent does not expose
        // those values consistently unless we provide them explicitly.
        for (const [name, value] of [
          ['keyCode', 13],
          ['which', 13],
          ['charCode', type === 'keypress' ? 13 : 0]
        ]) {
          try {
            Object.defineProperty(event, name, {
              configurable: true,
              get: () => value
            });
          } catch (_) {}
        }

        return el.dispatchEvent(event);
      };

      const keyDownNotCancelled = fireEnter('keydown');
      const keyPressNotCancelled = fireEnter('keypress');
      fireEnter('keyup');

      // Synthetic key events do not execute the browser's native
      // "submit on Enter" default action. Reproduce it only when the
      // page did not cancel the Enter itself.
      if (
        keyDownNotCancelled &&
        keyPressNotCancelled &&
        el.form &&
        typeof el.form.requestSubmit === 'function'
      ) {
        try {
          const submitter = el.form.querySelector(
            'button[type="submit"], input[type="submit"]'
          );

          if (submitter) {
            el.form.requestSubmit(submitter);
          } else {
            el.form.requestSubmit();
          }
        } catch (_) {}
      }

      // Keep the field focused. Blurring immediately after Enter was
      // causing some autocomplete/search components to restore the
      // previous value before processing the search.
      window.setTimeout(() => {
        post({ type: 'keyboard', action: 'hide' });
      }, 40);

      return true;
    }

    return false;
  };
})();
