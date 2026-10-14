'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const channels = new Set(['kiosk:state']);
contextBridge.exposeInMainWorld('kiosk', Object.freeze({
  invoke(action, payload) {
    return ipcRenderer.invoke('kiosk:action', action, payload);
  },
  onState(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('kiosk:state', listener);
    return () => ipcRenderer.removeListener('kiosk:state', listener);
  }
}));
