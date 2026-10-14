'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Narrow, write-only bridge for pages on grupohernandes.com.br.
// Admin credentials and printer controls never enter the website renderer.
contextBridge.exposeInMainWorld('__hernandesHost', Object.freeze({
  postMessage(payload) {
    if (!payload || typeof payload !== 'object') return;
    ipcRenderer.send('totem:site-message', payload);
  }
}));
