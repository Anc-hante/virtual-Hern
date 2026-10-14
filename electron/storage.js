'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Reuse the WPF totem's device ID and printer choice on migration.
const folder = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'GrupoHernandes', 'VirtualHern'
);
const configFile = path.join(folder, 'printer-settings.json');
const deviceFile = path.join(folder, 'totem-device-id.txt');
const queueFile = path.join(folder, 'totem-events-pending.jsonl');
const leadFile = path.join(folder, 'leads.csv');

function ensureFolder() { fs.mkdirSync(folder, { recursive: true }); }
function loadDeviceId() {
  ensureFolder();
  try {
    const value = fs.readFileSync(deviceFile, 'utf8').trim();
    if (value) return value;
  } catch (_) {}
  const name = os.hostname().replace(/[^\w-]/g, '').toUpperCase() || 'HERNANDES';
  const id = 'TOTEM-' + name + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  fs.writeFileSync(deviceFile, id, 'utf8');
  return id;
}
function selectedPrinter() {
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return String(config.PrinterName || '').trim();
  } catch (_) { return ''; }
}
function savePrinter(name) {
  if (!name || typeof name !== 'string' || name.length > 250) {
    throw new Error('Selecione uma impressora válida.');
  }
  ensureFolder();
  fs.writeFileSync(configFile, JSON.stringify({ PrinterName: name }, null, 2), 'utf8');
}
function recordLead(data) {
  const name = String(data.name || '').trim().slice(0, 120);
  const phone = String(data.phone || '').trim().slice(0, 40);
  if (!name || !phone) return;
  const escape = value => '"' + value.replace(/"/g, '""').replace(/[\r\n]/g, ' ') + '"';
  ensureFolder();
  if (!fs.existsSync(leadFile)) fs.writeFileSync(leadFile, 'data_hora,nome,telefone\r\n', 'utf8');
  fs.appendFileSync(leadFile, [
    escape(new Date().toISOString()), escape(name), escape(phone)
  ].join(',') + '\r\n', 'utf8');
}
module.exports = { folder, queueFile, ensureFolder, loadDeviceId, selectedPrinter, savePrinter, recordLead };
