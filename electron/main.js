'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const api = require('./api');
const printer = require('./printer');
const storage = require('./storage');

const HOME = 'https://www.grupohernandes.com.br/';
const HEIGHT = 64;
const ADMIN_HASH = '5a48efcab4528e9926bac957299787cb3b7a7ce95786a11992f9b5aa4a35e987';
const allowedEvents = new Set([
  'session_started', 'session_reset', 'customer_existing',
  'customer_new', 'product_added', 'order_completed'
]);

let window = null;
let site = null;
let worker = null;
let screen = 'loading';
let completionLocked = false;
let sessionId = crypto.randomUUID();
let attempts = 0;
let lockUntil = 0;
let firstLoadComplete = false;

const scripts = [
  'keyboard_bridge.js',
  'kiosk_session.js',
  'checkout_flow.js',
  'keyboard_ui.js'
].map(name => path.join(__dirname, '..', 'src', 'HernandesCheckout', 'Resources', name));

function isShopFrame(senderFrame) {
  if (!senderFrame) return false;
  try {
    const url = new URL(senderFrame.url);
    return url.protocol === 'https:' &&
      (url.hostname === 'www.grupohernandes.com.br' ||
       url.hostname === 'grupohernandes.com.br');
  } catch (_) { return false; }
}
function emitState(extra = {}) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('kiosk:state', {
    screen,
    canGoBack: !!site && site.webContents.navigationHistory.canGoBack(),
    ready: firstLoadComplete,
    deviceId: api.DEVICE,
    ...extra
  });
}
function showScreen(value, extra = {}) {
  screen = value;
  if (site) site.setVisible(value === 'shop');
  emitState(extra);
}
function layoutSite() {
  if (!site || !window) return;
  const [width, height] = window.getContentSize();
  site.setBounds({
    x: 0, y: HEIGHT,
    width: Math.max(1, width),
    height: Math.max(1, height - HEIGHT)
  });
}
async function installSiteScripts() {
  if (!site) return;
  for (const file of scripts) {
    try {
      const code = fs.readFileSync(file, 'utf8');
      await site.webContents.executeJavaScript(code);
    } catch (e) {
      console.warn('[Totem] Script de integração indisponível:', path.basename(file), e.message);
    }
  }
}
function newSession() {
  sessionId = crypto.randomUUID();
  void api.sendEvent('session_started', sessionId, {
    url: HOME,
    app_version: app.getVersion()
  });
}
async function resetService() {
  const old = sessionId;
  void api.sendEvent('session_reset', old, { reason: 'manual' });
  newSession();
  if (!site || site.webContents.isDestroyed()) return;
  completionLocked = false;
  firstLoadComplete = true;
  showScreen('shop');

  // Clean the site's cart using its own UI before returning home.
  try {
    const result = await site.webContents.executeJavaScript(
      'window.__hernandesKioskReset?.("manual") ?? false'
    );
    if (result === false) site.webContents.loadURL(HOME);
  } catch (_) {
    site.webContents.loadURL(HOME);
  }
}
function completion() {
  if (completionLocked) return;
  completionLocked = true;
  showScreen('complete');
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Hernandes Checkout',
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload-shell.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.webContents.on('before-input-event', (e, key) => {
    if (key.control && key.shift && key.key.toUpperCase() === 'F12') {
      e.preventDefault();
      app.quit();
    }
  });

  site = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-site.js'),
      partition: 'persist:hernandes-totem',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  site.setBackgroundColor('#ffffff');
  window.contentView.addChildView(site);
  site.setVisible(false);
  window.on('resize', layoutSite);
  window.on('closed', () => {
    if (worker) worker.stop();
    worker = null;
    window = null;
    site = null;
  });
  layoutSite();

  site.webContents.on('dom-ready', () => {
    if (!completionLocked) void installSiteScripts();
  });
  site.webContents.on('did-finish-load', () => {
    if (completionLocked) return;
    if (!firstLoadComplete) {
      firstLoadComplete = true;
      showScreen('shop');
    } else {
      emitState();
    }
  });
  site.webContents.on('did-fail-load', (_event, code, reason, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 is normal navigation cancellation.
    console.warn('[Totem] Falha de navegação:', code, reason, url);
    if (!firstLoadComplete) showScreen('error');
  });
  site.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[Totem] Processo do navegador encerrou:', details.reason);
    showScreen('error');
  });
  site.webContents.on('did-navigate', () => emitState());
  site.webContents.on('did-navigate-in-page', () => emitState());
  site.webContents.on('will-navigate', (event, url) => {
    if (completionLocked || !/^https:\/\//i.test(url)) event.preventDefault();
  });
  site.webContents.setWindowOpenHandler(({ url }) => {
    // Kiosk never creates an unmanaged secondary browser window.
    if (/^https:\/\//i.test(url) && !completionLocked) {
      void site.webContents.loadURL(url);
    }
    return { action: 'deny' };
  });
  site.webContents.on('before-input-event', (event, key) => {
    // Only buttons in the shell control page refresh or restart.
    if (key.key === 'F5' || ((key.control || key.meta) && key.key.toLowerCase() === 'r')) {
      event.preventDefault();
    }
  });
  site.webContents.on('context-menu', e => e.preventDefault());

  worker = new printer.PrintWorker(site.webContents);
  worker.start();

  void window.loadFile(path.join(__dirname, 'shell', 'index.html')).then(() => {
    emitState();
    window.show();
    void site.webContents.loadURL(HOME).catch(e => {
      console.warn('[Totem] Não foi possível abrir o ecommerce:', e.message);
      showScreen('error');
    });
    newSession();
  });
}

ipcMain.on('totem:site-message', (event, message) => {
  if (!site || event.sender !== site.webContents ||
      !isShopFrame(event.senderFrame) ||
      !message || typeof message !== 'object') return;

  if (message.type === 'kiosk') {
    if (message.action === 'completion-lock') completion();
    // A manual reset is already controlled from the shell. Do not
    // execute legacy automatic browser resets from page messages.
    return;
  }
  if (message.type === 'lead') {
    try { storage.recordLead(message); } catch (e) {
      console.warn('[Totem] Falha ao guardar lead:', e.message);
    }
    return;
  }
  if (message.type !== 'totem_event' ||
      !allowedEvents.has(message.event_type)) return;

  const { type, event_type, event_id, device_id, session_id, ...data } = message;
  void api.sendEvent(event_type, sessionId, data);
});

ipcMain.handle('kiosk:action', async (event, action, payload) => {
  if (!window || event.sender !== window.webContents) return { ok: false };
  switch (action) {
    case 'back':
      if (screen === 'shop' && site.webContents.navigationHistory.canGoBack()) {
        site.webContents.navigationHistory.goBack();
      }
      return { ok: true };
    case 'refresh':
      if (screen === 'shop') site.webContents.reload();
      return { ok: true };
    case 'restart':
      if (screen !== 'shop') return { ok: false };
      await resetService();
      return { ok: true };
    case 'retry':
      firstLoadComplete = false;
      completionLocked = false;
      showScreen('loading');
      void site.webContents.loadURL(HOME);
      return { ok: true };
    case 'new-session':
      if (screen !== 'complete') return { ok: false };
      await resetService();
      return { ok: true };
    case 'admin:open':
      if (screen !== 'shop') return { ok: false };
      attempts = 0;
      showScreen('login');
      return { ok: true };
    case 'admin:close':
      if (screen === 'login' || screen === 'printers') {
        showScreen('shop');
      }
      return { ok: true };
    case 'admin:login': {
      if (screen !== 'login') return { ok: false };
      if (Date.now() < lockUntil) {
        return { ok: false, error: 'Aguarde antes de tentar novamente.' };
      }
      const username = String(payload?.username || '').trim();
      const password = String(payload?.password || '');
      const digest = crypto.createHash('sha256').update(password).digest('hex');
      const valid = username === 'admin' &&
        crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(ADMIN_HASH));
      if (!valid) {
        attempts++;
        if (attempts >= 5) lockUntil = Date.now() + 30000;
        return { ok: false, error: 'Usuário ou senha incorretos.' };
      }
      attempts = 0;
      showScreen('printers');
      return { ok: true };
    }
    case 'admin:printers': {
      if (screen !== 'printers') return { ok: false };
      const printers = await printer.installedPrinters(site.webContents);
      return { ok: true, printers: printers.map(({ name, displayName, isDefault }) =>
        ({ name, displayName, isDefault })), selected: storage.selectedPrinter() };
    }
    case 'admin:test':
    case 'admin:save': {
      if (screen !== 'printers') return { ok: false };
      const printerName = String(payload?.name || '');
      const installed = await printer.installedPrinters(site.webContents);
      if (!installed.some(p => p.name === printerName)) {
        return { ok: false, error: 'Impressora não encontrada no Windows.' };
      }
      if (action === 'admin:test') {
        try {
          await printer.printTest(printerName);
          return { ok: true, message: 'Teste enviado à fila da impressora.' };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
      storage.savePrinter(printerName);
      return { ok: true, message: 'Impressora salva. Os próximos cupons usarão esta opção.' };
    }
    default:
      return { ok: false };
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { window.show(); window.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
