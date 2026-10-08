(() => {
  if (window.__hernandesCheckoutFlowInstalled) return;
  window.__hernandesCheckoutFlowInstalled = true;

  let completionHandled = false;

  const post = (payload) => {
    try {
      window.chrome?.webview?.postMessage(payload);
    } catch (_) {}
  };

  const isSuccessPopup = (popup) => {
    if (!popup) return false;

    const text = (popup.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return Boolean(
      popup.querySelector('.swal2-icon-success') ||
      (
        /pedido|compra/.test(text) &&
        /sucesso|recebido|finalizado|conclu[ií]do/.test(text)
      )
    );
  };

  const parseMoney = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;

    const normalized = text
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const extractOrderData = () => {
    const bodyText = (document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();

    const orderMatch =
      bodyText.match(/(?:pedido|n[úu]mero do pedido)\s*#?\s*(\d{4,})/i);

    let amount = null;

    const totalCandidates = [
      ...document.querySelectorAll(
        '[class*="total" i], [id*="total" i], strong, b, td, th'
      )
    ];

    for (const element of totalCandidates) {
      const text = (element.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();

      if (
        !/total|valor do pedido|valor total/i.test(text) ||
        !/R\$/i.test(text)
      ) {
        continue;
      }

      const match = text.match(/R\$\s*([\d.]+,\d{2})/i);
      if (match) {
        amount = parseMoney(match[1]);
      }
    }

    if (amount == null) {
      const match = bodyText.match(
        /(?:total|valor total|valor do pedido)[^R$]{0,80}R\$\s*([\d.]+,\d{2})/i
      );
      if (match) amount = parseMoney(match[1]);
    }

    const items = [
      ...document.querySelectorAll(
        'tr, .cart-item, .cart_item, [data-id-produto], [data-codprod]'
      )
    ]
      .map((row) => {
        const dataset = row.dataset || {};
        const text = (row.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

        return {
          product_id:
            dataset.idProduto ||
            dataset.codprod ||
            dataset.codigoProduto ||
            '',
          text: text.slice(0, 320)
        };
      })
      .filter((item) => item.product_id || item.text)
      .slice(0, 60);

    let customer = {};
    try {
      customer = JSON.parse(
        sessionStorage.getItem(
          '__hernandes_kiosk_customer_state'
        ) || '{}'
      ) || {};
    } catch (_) {}

    return {
      order_number: orderMatch?.[1] || '',
      amount,
      items,
      customer_type: customer.customerType || '',
      customer_name: customer.name || '',
      customer_phone: customer.phone || '',
      payload: {
        page: window.location.pathname,
        title: document.title,
        confirmation_text: bodyText.slice(0, 1800)
      }
    };
  };

  const completeCheckout = () => {
    if (completionHandled) return;
    completionHandled = true;

    const orderData = extractOrderData();

    // Lock navigation in the native host first. The ecommerce can keep
    // executing its own success handler, but it can no longer destroy the
    // kiosk thank-you screen.
    post({
      type: 'kiosk',
      action: 'completion-lock'
    });

    post({
      type: 'totem_event',
      event_type: 'order_completed',
      ...orderData
    });

    try {
      window.__hernandesResetCycle?.();
    } catch (_) {}

    post({
      type: 'keyboard',
      action: 'hide'
    });
  };

  // A single capture listener is enough. The previous MutationObserver
  // watched class/style changes over the whole document and added needless
  // work to every ecommerce render.
  document.addEventListener('click', (event) => {
    const confirm = event.target.closest?.(
      '.swal2-confirm, button'
    );

    if (!confirm) return;

    const popup = confirm.closest?.(
      '.swal2-popup, [role="dialog"]'
    );

    if (!isSuccessPopup(popup)) return;

    completeCheckout();
  }, true);
})();
