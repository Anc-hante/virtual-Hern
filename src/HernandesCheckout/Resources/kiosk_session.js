(() => {
  if (window.__hernandesKioskSessionInstalled) return;
  window.__hernandesKioskSessionInstalled = true;

  const HOME_URL = 'https://www.grupohernandes.com.br/';
  const STATE_KEY = '__hernandes_kiosk_customer_state';
  const RESET_KEY = '__hernandes_kiosk_reset_pending';
  const RESET_STARTED_KEY = '__hernandes_kiosk_reset_started_at';
  const ADD_SELECTOR = [
    'button._addtocart',
    'a._addtocart',
    '.product-card._addtocart',
    'button.product-card[data-id-produto]',
    'button[data-id-produto][data-orcamento]'
  ].join(',');

  let lastActivityPost = 0;
  let resetAttempts = 0;
  let resetInterval = null;

  const post = (payload) => {
    try {
      window.chrome?.webview?.postMessage(payload);
    } catch (_) {}
  };

  const reportActivity = () => {
    const now = Date.now();
    if (now - lastActivityPost < 750) return;
    lastActivityPost = now;

    post({
      type: 'kiosk',
      action: 'activity'
    });
  };

  for (const eventName of [
    'pointerdown',
    'touchstart',
    'keydown',
    'input',
    'wheel',
    'scroll'
  ]) {
    document.addEventListener(
      eventName,
      reportActivity,
      { capture: true, passive: true }
    );
  }

  const readState = () => {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const writeState = (state) => {
    try {
      sessionStorage.setItem(
        STATE_KEY,
        JSON.stringify(state)
      );
    } catch (_) {}
  };

  const clearCycleState = () => {
    try {
      sessionStorage.removeItem(STATE_KEY);
    } catch (_) {}

    document
      .getElementById('__hernandes-customer-gate')
      ?.remove();
  };

  window.__hernandesResetCycle = clearCycleState;

  const parseCount = (value) => {
    const text = String(value ?? '').trim();
    const match = text.match(/\d+/);
    return match ? Number(match[0]) : null;
  };

  const getCartCount = () => {
    const selectors = [
      '[data-cart-count]',
      '#cart-count',
      '.cart-count',
      '.cart_count',
      '.cart-qty',
      '.cart_qty',
      '.cart-quantity',
      '.cart_quantity',
      '.carrinho-qtd',
      '.carrinho_qtd',
      '.header-cart .badge',
      '.shopping-cart .badge',
      'a[href*="carrinho"] .badge',
      'a[href*="cart"] .badge'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const fromData =
        element.getAttribute('data-cart-count') ??
        element.getAttribute('data-count');

      const parsed = parseCount(
        fromData ?? element.textContent
      );

      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  };

  const cartLooksNonEmpty = () => {
    const count = getCartCount();
    if (count !== null) {
      return count > 0;
    }

    return Boolean(
      document.querySelector(
        '.cart-item, .cart_item, .carrinho-item, ' +
        '.carrinho_item, [data-cart-item], ' +
        '[data-id-item-carrinho]'
      )
    );
  };

  const verifiedForCycle = () => {
    const state = readState();

    if (state?.verified === true) {
      return true;
    }

    if (cartLooksNonEmpty()) {
      writeState({
        verified: true,
        customerType: 'existing-cart',
        createdAt: new Date().toISOString()
      });
      return true;
    }

    return false;
  };

  const sanitizePhone = (value) =>
    String(value || '').replace(/\D/g, '').slice(0, 11);

  const formatPhone = (value) => {
    const digits = sanitizePhone(value);

    if (digits.length <= 2) {
      return digits ? `(${digits}` : '';
    }

    if (digits.length <= 6) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    }

    if (digits.length <= 10) {
      return (
        `(${digits.slice(0, 2)}) ` +
        `${digits.slice(2, 6)}-${digits.slice(6)}`
      );
    }

    return (
      `(${digits.slice(0, 2)}) ` +
      `${digits.slice(2, 7)}-${digits.slice(7)}`
    );
  };

  const replayAdd = (button) => {
    if (!button || !document.contains(button)) return;

    button.dataset.hernandesKioskBypass = '1';

    window.setTimeout(() => {
      try {
        button.click();
      } catch (_) {
        button.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
      }
    }, 40);
  };

  const gateStyles = `
    <style>
      #__hernandes-customer-gate {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        padding: 28px;
        background: rgba(17,24,39,.54);
        backdrop-filter: blur(6px);
        font-family:
          "Segoe UI Variable Text",
          "Segoe UI",
          Arial,
          sans-serif;
        animation:
          __hernandes-gate-fade
          150ms
          ease-out
          both;
      }

      @keyframes __hernandes-gate-fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      #__hernandes-customer-gate .__hg-card {
        width: min(620px, 94vw);
        box-sizing: border-box;
        padding: 38px;
        border: 1px solid rgba(255,255,255,.75);
        border-radius: 26px;
        background: #fff;
        box-shadow: 0 28px 90px rgba(17,24,39,.25);
        text-align: center;
        animation:
          __hernandes-gate-card
          260ms
          cubic-bezier(.16,1,.3,1)
          both;
      }

      @keyframes __hernandes-gate-card {
        from {
          opacity: 0;
          transform: translateY(18px) scale(.97);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      #__hernandes-customer-gate .__hg-logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 110px;
        height: 34px;
        padding: 0 15px;
        margin-bottom: 18px;
        border-radius: 999px;
        background: #FDEBEC;
        color: #A7191F;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: .05em;
        text-transform: uppercase;
      }

      #__hernandes-customer-gate h2 {
        margin: 0;
        color: #20242A;
        font-size: clamp(27px, 4vw, 38px);
        line-height: 1.12;
        font-weight: 800;
      }

      #__hernandes-customer-gate p {
        max-width: 500px;
        margin: 12px auto 28px;
        color: #667085;
        font-size: 18px;
        line-height: 1.45;
      }

      #__hernandes-customer-gate .__hg-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      #__hernandes-customer-gate button {
        min-height: 64px;
        border-radius: 15px;
        font-size: 19px;
        font-weight: 800;
        cursor: pointer;
      }

      #__hernandes-customer-gate .__hg-primary {
        border: 1px solid #A7191F;
        background: #A7191F;
        color: #fff;
      }

      #__hernandes-customer-gate .__hg-secondary {
        border: 1px solid #D9DEE5;
        background: #F7F8FA;
        color: #303741;
      }

      #__hernandes-customer-gate .__hg-form {
        display: grid;
        gap: 16px;
        text-align: left;
      }

      #__hernandes-customer-gate label {
        display: grid;
        gap: 7px;
        color: #344054;
        font-size: 14px;
        font-weight: 700;
      }

      #__hernandes-customer-gate input {
        width: 100%;
        min-height: 58px;
        box-sizing: border-box;
        padding: 0 16px;
        border: 1px solid #D0D5DD;
        border-radius: 13px;
        outline: none;
        background: #fff;
        color: #20242A;
        font-size: 19px;
      }

      #__hernandes-customer-gate input:focus {
        border-color: #A7191F;
        box-shadow: 0 0 0 3px rgba(167,25,31,.12);
      }

      #__hernandes-customer-gate .__hg-error {
        min-height: 20px;
        color: #B42318;
        font-size: 14px;
        font-weight: 600;
        text-align: center;
      }

      #__hernandes-customer-gate .__hg-form-actions {
        display: grid;
        grid-template-columns: .7fr 1.3fr;
        gap: 12px;
        margin-top: 4px;
      }

      @media (max-width: 620px) {
        #__hernandes-customer-gate {
          padding: 18px;
        }

        #__hernandes-customer-gate .__hg-card {
          padding: 30px 22px;
        }

        #__hernandes-customer-gate .__hg-actions,
        #__hernandes-customer-gate .__hg-form-actions {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `;

  const makeGate = () => {
    document
      .getElementById('__hernandes-customer-gate')
      ?.remove();

    const overlay = document.createElement('div');
    overlay.id = '__hernandes-customer-gate';
    overlay.innerHTML = gateStyles + `
      <div class="__hg-card"
           role="dialog"
           aria-modal="true"
           aria-labelledby="__hg-title">
        <div class="__hg-logo">
          Hernandes Checkout
        </div>

        <div class="__hg-content"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    reportActivity();

    return overlay;
  };

  const showCustomerQuestion = (button) => {
    const overlay = makeGate();
    const content = overlay.querySelector('.__hg-content');

    content.innerHTML = `
      <h2 id="__hg-title">
        Você já tem cadastro conosco?
      </h2>

      <p>
        Antes de adicionar o primeiro produto,
        precisamos identificar este atendimento.
      </p>

      <div class="__hg-actions">
        <button type="button"
                class="__hg-secondary"
                data-answer="no">
          Não, ainda não
        </button>

        <button type="button"
                class="__hg-primary"
                data-answer="yes">
          Sim, já tenho
        </button>
      </div>
    `;

    content
      .querySelector('[data-answer="yes"]')
      .addEventListener('click', () => {
        writeState({
          verified: true,
          customerType: 'registered',
          createdAt: new Date().toISOString()
        });

        overlay.remove();
        reportActivity();
        replayAdd(button);
      }, { once: true });

    content
      .querySelector('[data-answer="no"]')
      .addEventListener('click', () => {
        showLeadForm(overlay, button);
      }, { once: true });
  };

  const showLeadForm = (overlay, button) => {
    const content = overlay.querySelector('.__hg-content');

    content.innerHTML = `
      <h2 id="__hg-title">
        Vamos registrar seus dados
      </h2>

      <p>
        Informe seu nome e telefone.
        É rapidinho e você já poderá continuar.
      </p>

      <div class="__hg-form">
        <label>
          Nome
          <input type="text"
                 inputmode="text"
                 autocomplete="name"
                 maxlength="80"
                 placeholder="Digite seu nome"
                 data-field="name">
        </label>

        <label>
          Telefone
          <input type="tel"
                 inputmode="tel"
                 autocomplete="tel"
                 maxlength="16"
                 placeholder="(68) 99999-9999"
                 data-field="phone">
        </label>

        <div class="__hg-error"
             aria-live="polite"></div>

        <div class="__hg-form-actions">
          <button type="button"
                  class="__hg-secondary"
                  data-action="back">
            Voltar
          </button>

          <button type="button"
                  class="__hg-primary"
                  data-action="continue">
            Continuar compra
          </button>
        </div>
      </div>
    `;

    const nameInput =
      content.querySelector('[data-field="name"]');
    const phoneInput =
      content.querySelector('[data-field="phone"]');
    const error =
      content.querySelector('.__hg-error');

    phoneInput.addEventListener('input', () => {
      const caretAtEnd =
        phoneInput.selectionStart ===
        phoneInput.value.length;

      phoneInput.value =
        formatPhone(phoneInput.value);

      if (caretAtEnd) {
        try {
          phoneInput.setSelectionRange(
            phoneInput.value.length,
            phoneInput.value.length
          );
        } catch (_) {}
      }
    });

    content
      .querySelector('[data-action="back"]')
      .addEventListener('click', () => {
        showCustomerQuestion(button);
      }, { once: true });

    content
      .querySelector('[data-action="continue"]')
      .addEventListener('click', () => {
        const name = nameInput.value.trim();
        const phoneDigits =
          sanitizePhone(phoneInput.value);

        if (name.length < 2) {
          error.textContent =
            'Digite um nome válido para continuar.';
          nameInput.focus();
          return;
        }

        if (
          phoneDigits.length < 10 ||
          phoneDigits.length > 11
        ) {
          error.textContent =
            'Digite um telefone com DDD.';
          phoneInput.focus();
          return;
        }

        const state = {
          verified: true,
          customerType: 'new-lead',
          name,
          phone: formatPhone(phoneDigits),
          createdAt: new Date().toISOString()
        };

        writeState(state);

        post({
          type: 'lead',
          name: state.name,
          phone: state.phone,
          at: state.createdAt
        });

        overlay.remove();
        reportActivity();
        replayAdd(button);
      });
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.(ADD_SELECTOR);
    if (!button) return;

    reportActivity();

    if (button.dataset.hernandesKioskBypass === '1') {
      delete button.dataset.hernandesKioskBypass;
      return;
    }

    if (verifiedForCycle()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    showCustomerQuestion(button);
  }, true);

  const clearCartLikeStorage = () => {
    const removeMatchingKeys = (storage) => {
      const keys = [];

      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (!key) continue;

          if (
            /cart|carrinho|basket|shopping.?bag/i.test(key)
          ) {
            keys.push(key);
          }
        }

        for (const key of keys) {
          storage.removeItem(key);
        }
      } catch (_) {}
    };

    removeMatchingKeys(localStorage);
    removeMatchingKeys(sessionStorage);
  };

  const findCartLink = () => {
    const links = [
      ...document.querySelectorAll('a[href]')
    ];

    return links.find((link) => {
      const href =
        (link.getAttribute('href') || '').toLowerCase();

      const label =
        (
          link.textContent ||
          link.getAttribute('aria-label') ||
          link.getAttribute('title') ||
          ''
        ).toLowerCase();

      return (
        href.includes('carrinho') ||
        href.includes('/cart') ||
        label.includes('carrinho')
      );
    }) || null;
  };

  const findClearButton = () => {
    const selectors = [
      '[data-action*="limpar" i]',
      '[data-click*="limpar" i]',
      '[data-action*="clear" i]',
      '[data-click*="clear" i]',
      '.clear-cart',
      '.clear_cart',
      '.limpar-carrinho',
      '.limpar_carrinho'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    return [
      ...document.querySelectorAll(
        'button, a, [role="button"]'
      )
    ].find((element) => {
      const text =
        (
          element.textContent ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          ''
        ).trim().toLowerCase();

      return (
        text === 'limpar carrinho' ||
        text === 'esvaziar carrinho' ||
        text === 'limpar pedido'
      );
    }) || null;
  };

  const findRemoveButton = () => {
    const selectors = [
      '[data-action*="remov" i]',
      '[data-click*="remov" i]',
      '[data-action*="exclu" i]',
      '[data-click*="exclu" i]',
      '[data-action*="delete" i]',
      '[data-click*="delete" i]',
      '.remove-item',
      '.remove_item',
      '.cart-remove',
      '.cart_remove',
      '.remove-cart',
      '.remove_cart',
      '.removecart',
      '.delete-item',
      '.delete_item',
      '[title*="remover" i]',
      '[aria-label*="remover" i]',
      '[title*="excluir" i]',
      '[aria-label*="excluir" i]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    return [
      ...document.querySelectorAll(
        'button, a, [role="button"]'
      )
    ].find((element) => {
      const text =
        (
          element.textContent ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          ''
        ).trim().toLowerCase();

      return (
        text === 'remover' ||
        text === 'excluir' ||
        text === 'remover item'
      );
    }) || null;
  };

  const finishReset = () => {
    if (resetInterval) {
      clearInterval(resetInterval);
      resetInterval = null;
    }

    clearCycleState();

    try {
      sessionStorage.removeItem(RESET_KEY);
      sessionStorage.removeItem(RESET_STARTED_KEY);
    } catch (_) {}

    post({
      type: 'kiosk',
      action: 'reset-complete'
    });

    if (
      window.location.origin ===
      new URL(HOME_URL).origin
    ) {
      window.location.replace(HOME_URL);
    }
  };

  const continueCartReset = () => {
    resetAttempts += 1;

    const count = getCartCount();

    if (count === 0) {
      finishReset();
      return;
    }

    const clearButton = findClearButton();
    if (clearButton) {
      clearButton.click();
      return;
    }

    const removeButton = findRemoveButton();
    if (removeButton) {
      removeButton.click();
      return;
    }

    const cartLink = findCartLink();

    if (
      resetAttempts <= 2 &&
      cartLink &&
      !/carrinho|cart/i.test(
        window.location.pathname
      )
    ) {
      try {
        const href = cartLink.href;

        if (href && href.startsWith(window.location.origin)) {
          window.location.assign(href);
          return;
        }
      } catch (_) {}
    }

    if (resetAttempts >= 14) {
      // Fallback for carts stored in browser storage.
      // Authentication cookies are intentionally preserved.
      clearCartLikeStorage();
      finishReset();
    }
  };

  const beginReset = (reason = 'manual') => {
    clearCycleState();

    try {
      sessionStorage.setItem(RESET_KEY, reason);
      sessionStorage.setItem(
        RESET_STARTED_KEY,
        String(Date.now())
      );
    } catch (_) {}

    post({
      type: 'kiosk',
      action: 'reset-started',
      reason
    });

    resetAttempts = 0;
    continueCartReset();

    if (!resetInterval) {
      resetInterval = window.setInterval(
        continueCartReset,
        300
      );
    }

    return true;
  };

  window.__hernandesKioskReset = beginReset;

  try {
    if (sessionStorage.getItem(RESET_KEY)) {
      window.setTimeout(beginReset, 250);
    }
  } catch (_) {}
})();
