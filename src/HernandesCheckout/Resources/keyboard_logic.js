/* Shared text-editing logic for the Electron touch keyboard.
 * Usable in both the storefront and the local admin page.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__hernandesKeyboardLogic = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const blocked = new Set([
    'button', 'submit', 'reset', 'checkbox', 'radio', 'file',
    'image', 'hidden', 'range', 'color', 'date', 'datetime-local',
    'month', 'time', 'week'
  ]);

  function editable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (element.isContentEditable) return true;
    const tag = String(element.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    return tag === 'input' && !blocked.has(String(element.type || 'text').toLowerCase());
  }

  function keyboardKind(element) {
    const type = String(element?.type || '').toLowerCase();
    const mode = String(element?.inputMode || '').toLowerCase();
    if (type === 'number' || type === 'tel' ||
        ['numeric', 'decimal', 'tel'].includes(mode)) return 'numeric';
    if (type === 'email' || mode === 'email') return 'email';
    return 'text';
  }

  function fireInput(element, action, text) {
    const type = action === 'backspace' ? 'deleteContentBackward' : 'insertText';
    let event;
    if (typeof InputEvent === 'function') {
      event = new InputEvent('input', {
        bubbles: true, composed: true, inputType: type,
        data: action === 'backspace' ? null : text
      });
    } else {
      event = new Event('input', { bubbles: true, composed: true });
    }
    element.dispatchEvent(event);
  }

  function nativeSetValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function insert(element, action, text = '') {
    if (!editable(element)) return false;
    if (action !== 'text' && action !== 'backspace') return false;

    if (element.isContentEditable) {
      try {
        element.focus({ preventScroll: true });
        const command = action === 'backspace' ? 'delete' : 'insertText';
        return Boolean(document.execCommand(command, false, action === 'backspace' ? null : text));
      } catch (_) {
        return false;
      }
    }

    const old = String(element.value ?? '');
    let start = typeof element.selectionStart === 'number'
      ? element.selectionStart : old.length;
    let end = typeof element.selectionEnd === 'number'
      ? element.selectionEnd : start;
    start = Math.max(0, Math.min(start, old.length));
    end = Math.max(start, Math.min(end, old.length));

    let caret = start;
    let updated = old;
    if (action === 'text') {
      const input = String(text);
      updated = old.slice(0, start) + input + old.slice(end);
      caret = start + input.length;
    } else if (start !== end) {
      updated = old.slice(0, start) + old.slice(end);
    } else if (start > 0) {
      updated = old.slice(0, start - 1) + old.slice(end);
      caret = start - 1;
    } else {
      return true;
    }

    if (element.maxLength >= 0 && updated.length > element.maxLength) {
      return true;
    }

    // Native prototype setter ensures React's controlled inputs see an
    // actual DOM change when the bubbling input event is dispatched.
    nativeSetValue(element, updated);
    try { element.setSelectionRange(caret, caret); } catch (_) {}
    fireInput(element, action, text);
    // Never fire change on every keystroke; it was prematurely validating
    // and re-rendering forms and moving the caret.
    return true;
  }

  function sendEnter(element) {
    if (!editable(element)) return false;

    if (element.isContentEditable && typeof document !== 'undefined') {
      try {
        element.focus({ preventScroll: true });
        document.execCommand('insertParagraph', false, null);
        return true;
      } catch (_) { return false; }
    }

    if (String(element.tagName || '').toLowerCase() === 'textarea') {
      return insert(element, 'text', '\n');
    }

    let canSubmit = true;
    for (const name of ['keydown', 'keypress', 'keyup']) {
      if (typeof KeyboardEvent !== 'function') break;
      const e = new KeyboardEvent(name, {
        key: 'Enter', code: 'Enter', bubbles: true,
        cancelable: true, composed: true
      });
      for (const property of ['keyCode', 'which']) {
        try { Object.defineProperty(e, property, { get: () => 13 }); } catch (_) {}
      }
      const result = element.dispatchEvent(e);
      if (name !== 'keyup' && !result) canSubmit = false;
    }

    if (canSubmit && element.form && typeof element.form.requestSubmit === 'function') {
      try {
        // Only submit genuine forms, never synthesize a click on an
        // arbitrary page button.
        element.form.requestSubmit();
      } catch (_) {}
    }
    return true;
  }

  return Object.freeze({ editable, keyboardKind, insert, sendEnter });
});
