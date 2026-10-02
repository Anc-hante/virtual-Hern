(() => {
  if (window.__hernandesCheckoutFlowInstalled) return;
  window.__hernandesCheckoutFlowInstalled = true;

  const HOME_URL = 'https://www.grupohernandes.com.br/';

  const onConfirmationPage = () => {
    const path = (window.location.pathname || '')
      .replace(/\/+$/, '')
      .toLowerCase();

    return (
      path.includes('confirmacao') ||
      path.includes('pedido-finalizado') ||
      path.includes('pedido-finalizado') ||
      path.includes('sucesso')
    );
  };

  const isSuccessPopup = (popup) => {
    if (!popup) return false;

    const text = (popup.textContent || '').toLowerCase();

    return Boolean(
      popup.querySelector('.swal2-icon-success') ||
      text.includes('pedido foi recebido com sucesso') ||
      text.includes('pedido recebido com sucesso')
    );
  };

  const parseMoney = (value) => {
    const normalized = String(value || '')
      .replace(/[^0-9,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const extractOrderData = () => {
    const bodyText =
      (document.body?.innerText || '')
        .replace(/\s+/g, ' ')
        .trim();

    const orderMatch =
      bodyText.match(/Pedido\s*#?\s*(\d{5,})/i);

    let amount = null;

    const moneyElements = [
      ...document.querySelectorAll(
        '[class*="total" i], [id*="total" i], td, th, strong, b'
      )
    ];

    for (const element of moneyElements) {
      const text =
        (element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

      if (
        !/total|valor do pedido|valor total/i.test(text) ||
        !/R\$/i.test(text)
      ) {
        continue;
      }

      const moneyMatch =
        text.match(/R\$\s*([\d.]+,\d{2})/i);

      if (moneyMatch) {
        amount = parseMoney(moneyMatch[1]);
      }
    }

    if (amount == null) {
      const fallback =
        bodyText.match(
          /(?:total|valor total|valor do pedido)[^R$]{0,60}R\$\s*([\d.]+,\d{2})/i
        );

      if (fallback) {
        amount = parseMoney(fallback[1]);
      }
    }

    const items = [
      ...document.querySelectorAll(
        'tr, .cart-item, .cart_item, [data-id-produto]'
      )
    ]
      .map((row) => {
        const text =
          (row.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

        const dataset = row.dataset || {};

        return {
          product_id:
            dataset.idProduto ||
            dataset.codprod ||
            dataset.codigoProduto ||
            '',
          text: text.slice(0, 300)
        };
      })
      .filter((item) => item.product_id || item.text)
      .slice(0, 50);

    let customer = {};

    try {
      customer =
        JSON.parse(
          sessionStorage.getItem(
            '__hernandes_kiosk_customer_state'
          ) || '{}'
        ) || {};
    } catch (_) {}

    return {
      order_number:
        orderMatch?.[1] || '',
      amount,
      items,
      customer_type:
        customer.customerType || '',
      customer_name:
        customer.name || '',
      customer_phone:
        customer.phone || '',
      payload: {
        page: window.location.pathname,
        title: document.title
      }
    };
  };

  const launchConfetti = (overlay) => {
    const layer = overlay.querySelector('.__confetti-layer');
    if (!layer) return;

    const colors = [
      '#A7191F',
      '#D52B32',
      '#F6C344',
      '#2E9B50',
      '#FFFFFF'
    ];

    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 46; index += 1) {
      const piece = document.createElement('i');
      piece.className = '__confetti';

      const left = 4 + Math.random() * 92;
      const delay = Math.random() * 0.5;
      const duration = 1.7 + Math.random() * 1.15;
      const drift = -90 + Math.random() * 180;
      const rotation = 420 + Math.random() * 780;
      const width = 7 + Math.random() * 7;
      const height = 11 + Math.random() * 10;

      piece.style.left = `${left}%`;
      piece.style.width = `${width}px`;
      piece.style.height = `${height}px`;
      piece.style.background =
        colors[index % colors.length];
      piece.style.animationDelay = `${delay}s`;
      piece.style.animationDuration = `${duration}s`;
      piece.style.setProperty('--drift', `${drift}px`);
      piece.style.setProperty('--spin', `${rotation}deg`);

      fragment.appendChild(piece);
    }

    layer.appendChild(fragment);

    window.setTimeout(() => {
      layer.replaceChildren();
    }, 3400);
  };

  const showReturnHome = () => {
    if (!document.body) return;
    if (document.getElementById('__hernandes-return-home')) return;

    try {
      window.chrome?.webview?.postMessage({
        type: 'kiosk',
        action: 'completion-lock'
      });
    } catch (_) {}

    const orderData = extractOrderData();

    try {
      window.chrome?.webview?.postMessage({
        type: 'totem_event',
        event_type: 'order_completed',
        ...orderData
      });
    } catch (_) {}

    // The completed order closes the current kiosk customer cycle.
    // The next customer's first add-to-cart action must identify them again.
    try {
      window.__hernandesResetCycle?.();
    } catch (_) {}

    try {
      window.chrome?.webview?.postMessage({
        type: 'keyboard',
        action: 'hide'
      });

      window.chrome?.webview?.postMessage({
        type: 'kiosk',
        action: 'activity'
      });
    } catch (_) {}

    const overlay = document.createElement('div');
    overlay.id = '__hernandes-return-home';

    overlay.innerHTML = `
      <style>
        #__hernandes-return-home {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          place-items: center;
          box-sizing: border-box;
          padding: 28px;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 18%,
              rgba(167,25,31,.09),
              transparent 40%),
            rgba(248,249,250,.985);
          font-family:
            "Segoe UI Variable Text",
            "Segoe UI",
            Arial,
            sans-serif;
          opacity: 0;
          transition: opacity 150ms ease;
        }

        #__hernandes-return-home.__show {
          opacity: 1;
        }

        #__hernandes-return-home .__confetti-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }

        #__hernandes-return-home .__confetti {
          --drift: 0px;
          --spin: 720deg;
          position: absolute;
          top: -30px;
          display: block;
          border-radius: 2px;
          opacity: .96;
          will-change: transform, opacity;
          animation-name: __hernandes-confetti-fall;
          animation-timing-function: cubic-bezier(.16,.72,.32,1);
          animation-fill-mode: forwards;
        }

        @keyframes __hernandes-confetti-fall {
          0% {
            transform:
              translate3d(0, -30px, 0)
              rotate(0deg);
            opacity: 0;
          }

          8% {
            opacity: 1;
          }

          100% {
            transform:
              translate3d(var(--drift), 112vh, 0)
              rotate(var(--spin));
            opacity: .1;
          }
        }

        #__hernandes-return-home .__card {
          position: relative;
          z-index: 2;
          width: min(680px, 92vw);
          box-sizing: border-box;
          padding: 44px 38px 38px;
          border: 1px solid #eceef1;
          border-radius: 28px;
          background: rgba(255,255,255,.98);
          box-shadow: 0 24px 70px rgba(31,41,55,.13);
          text-align: center;
          transform: translateY(24px) scale(.96);
          opacity: 0;
          animation:
            __hernandes-card-in
            420ms
            cubic-bezier(.16,1,.3,1)
            80ms
            forwards;
        }

        @keyframes __hernandes-card-in {
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        #__hernandes-return-home .__check {
          display: grid;
          place-items: center;
          width: 92px;
          height: 92px;
          margin: 0 auto 22px;
          border-radius: 999px;
          background: #edf9ef;
          color: #218838;
          font-size: 50px;
          font-weight: 800;
          transform: scale(.3) rotate(-14deg);
          opacity: 0;
          animation:
            __hernandes-check-pop
            520ms
            cubic-bezier(.18,1.55,.42,1)
            220ms
            forwards;
        }

        @keyframes __hernandes-check-pop {
          70% {
            transform: scale(1.12) rotate(2deg);
            opacity: 1;
          }

          100% {
            transform: scale(1) rotate(0);
            opacity: 1;
          }
        }

        #__hernandes-return-home .__eyebrow {
          margin-bottom: 8px;
          color: #a7191f;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        #__hernandes-return-home h2 {
          margin: 0 0 12px;
          color: #20242a;
          font-size: clamp(28px, 4vw, 42px);
          line-height: 1.08;
          font-weight: 800;
        }

        #__hernandes-return-home p {
          max-width: 540px;
          margin: 0 auto 30px;
          color: #667085;
          font-size: clamp(17px, 2.4vw, 21px);
          line-height: 1.45;
        }

        #__hernandes-return-home button {
          width: min(460px, 100%);
          min-height: 68px;
          border: 0;
          border-radius: 16px;
          background: #a7191f;
          color: #fff;
          font-size: 21px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(167,25,31,.2);
          transition:
            transform 120ms ease,
            background 120ms ease;
        }

        #__hernandes-return-home button:active {
          transform: scale(.985);
          background: #861419;
        }

        @media (prefers-reduced-motion: reduce) {
          #__hernandes-return-home .__confetti {
            display: none;
          }

          #__hernandes-return-home .__card,
          #__hernandes-return-home .__check {
            animation-duration: 1ms;
            animation-delay: 0ms;
          }
        }
      </style>

      <div class="__confetti-layer"
           aria-hidden="true"></div>

      <div class="__card"
           role="dialog"
           aria-modal="true"
           aria-labelledby="__hernandes-return-title">
        <div class="__check">✓</div>

        <div class="__eyebrow">
          Pedido concluído
        </div>

        <h2 id="__hernandes-return-title">
          Obrigado pela sua compra!
        </h2>

        <p>
          Seu pedido foi finalizado com sucesso.
          Quando estiver pronto, toque abaixo para iniciar um novo atendimento.
        </p>

        <button id="__hernandes-go-home"
                type="button">
          Iniciar novo atendimento
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay
      .querySelector('#__hernandes-go-home')
      ?.addEventListener('click', () => {
        try {
          window.chrome?.webview?.postMessage({
            type: 'kiosk',
            action: 'completion-release'
          });
        } catch (_) {}

        window.location.replace(HOME_URL);
      }, { once: true });

    requestAnimationFrame(() => {
      overlay.classList.add('__show');
      launchConfetti(overlay);
    });
  };

  const bindSuccessPopup = () => {
    const popup = document.querySelector(
      '.swal2-popup.swal2-show');

    if (!isSuccessPopup(popup)) return;

    const confirm = popup.querySelector('.swal2-confirm');

    if (
      !confirm ||
      confirm.dataset.hernandesReturnBound === '1'
    ) {
      return;
    }

    confirm.dataset.hernandesReturnBound = '1';

    confirm.addEventListener('click', (event) => {
      // Do not allow the e-commerce success handler to schedule/perform
      // its automatic return. The kiosk owns the post-sale experience.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      showReturnHome();
    }, { capture: true, once: true });
  };

  const observer = new MutationObserver(bindSuccessPopup);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  document.addEventListener('click', (event) => {
    const confirm = event.target.closest?.('.swal2-confirm');
    const popup = confirm?.closest?.('.swal2-popup');

    if (
      confirm &&
      isSuccessPopup(popup) &&
      (
        onConfirmationPage() ||
        /pedido|compra|recebido|finalizado/i.test(
          popup?.textContent || ''
        )
      )
    ) {
      // Capture before the site's own SweetAlert handler. This prevents
      // the native five-second redirect from taking over the kiosk.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      showReturnHome();
    }
  }, true);

  bindSuccessPopup();
})();
