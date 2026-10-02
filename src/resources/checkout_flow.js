(() => {
  if (window.__hernandesCheckoutFlowInstalled) return;
  window.__hernandesCheckoutFlowInstalled = true;

  const HOME_URL = "https://www.grupohernandes.com.br/";

  const onConfirmationPage = () => {
    const path = (window.location.pathname || "").replace(/\/+$/, "");
    return path === "/confirmacao";
  };

  const isSuccessPopup = (popup) => {
    if (!popup) return false;
    const text = (popup.textContent || "").toLowerCase();
    const successIcon = popup.querySelector(".swal2-icon-success");
    return Boolean(
      successIcon ||
      text.includes("pedido foi recebido com sucesso") ||
      text.includes("pedido recebido com sucesso")
    );
  };

  const showReturnHome = () => {
    if (!onConfirmationPage()) return;
    if (document.getElementById("__hernandes-return-home")) return;

    console.log('__HERN_KB__' + JSON.stringify({event: "hide"}));

    const overlay = document.createElement("div");
    overlay.id = "__hernandes-return-home";
    overlay.innerHTML = `
      <style>
        #__hernandes-return-home {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          place-items: center;
          padding: 28px;
          background:
            radial-gradient(circle at 50% 20%, rgba(167,25,31,.08), transparent 38%),
            rgba(248,249,250,.97);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
          opacity: 0;
          transition: opacity 180ms ease;
        }
        #__hernandes-return-home.__show {
          opacity: 1;
        }
        #__hernandes-return-home .__card {
          width: min(680px, 92vw);
          box-sizing: border-box;
          padding: 44px 38px 38px;
          border: 1px solid #eceef1;
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 24px 70px rgba(31,41,55,.13);
          text-align: center;
        }
        #__hernandes-return-home .__check {
          display: grid;
          place-items: center;
          width: 86px;
          height: 86px;
          margin: 0 auto 22px;
          border-radius: 999px;
          background: #edf9ef;
          color: #218838;
          font-size: 48px;
          font-weight: 800;
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
          transition: transform 120ms ease, background 120ms ease;
        }
        #__hernandes-return-home button:active {
          transform: scale(.985);
          background: #861419;
        }
      </style>
      <div class="__card" role="dialog" aria-modal="true" aria-labelledby="__hernandes-return-title">
        <div class="__check">✓</div>
        <div class="__eyebrow">Pedido concluído</div>
        <h2 id="__hernandes-return-title">Compra finalizada com sucesso</h2>
        <p>Para iniciar um novo atendimento, toque no botão abaixo e volte para a página inicial.</p>
        <button id="__hernandes-go-home" type="button">Voltar ao início</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const homeButton = overlay.querySelector("#__hernandes-go-home");
    homeButton.addEventListener("click", () => {
      window.location.assign(HOME_URL);
    }, {once: true});

    requestAnimationFrame(() => overlay.classList.add("__show"));
    try { homeButton.focus({preventScroll: true}); } catch (_) {}
  };

  const bindSuccessPopup = () => {
    if (!onConfirmationPage()) return;

    const popup = document.querySelector(".swal2-popup.swal2-show");
    if (!isSuccessPopup(popup)) return;

    const confirm = popup.querySelector(".swal2-confirm");
    if (!confirm || confirm.dataset.hernandesReturnBound === "1") return;

    confirm.dataset.hernandesReturnBound = "1";
    confirm.addEventListener("click", () => {
      window.setTimeout(showReturnHome, 180);
    }, {once: true});
  };

  const observer = new MutationObserver(bindSuccessPopup);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  document.addEventListener("click", (event) => {
    const confirm = event.target.closest?.(".swal2-confirm");
    const popup = confirm?.closest?.(".swal2-popup");
    if (confirm && isSuccessPopup(popup) && onConfirmationPage()) {
      window.setTimeout(showReturnHome, 180);
    }
  }, true);

  bindSuccessPopup();
})();