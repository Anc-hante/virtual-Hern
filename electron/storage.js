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
const agentTokenFile = path.join(folder, 'api-token.dpapi');
const apiTransportFile = path.join(folder, 'api-internal-cert-test.json');
const agileCredentialsFile = path.join(folder, 'agile-credentials.dpapi');

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
function windowsProtection() {
  // Electron safeStorage uses Windows DPAPI; never store plaintext or
  // silently fall back to insecure encryption on another operating system.
  const { safeStorage } = require('electron');
  if (process.platform !== 'win32' || !safeStorage?.isEncryptionAvailable?.()) {
    throw new Error('A protecao de credenciais do Windows nao esta disponivel.');
  }
  return safeStorage;
}
function saveAgentToken(value, cryptoProvider = windowsProtection()) {
  const token = String(value || '').trim();
  if (token.length < 16 || token.length > 1024 || /[\r\n]/.test(token)) {
    throw new Error('Informe um token valido de 16 a 1024 caracteres.');
  }
  if (!cryptoProvider?.isEncryptionAvailable?.()) {
    throw new Error('Nao foi possivel criptografar o token no Windows.');
  }
  ensureFolder();
  const encrypted = cryptoProvider.encryptString(token);
  fs.writeFileSync(agentTokenFile, encrypted, { flag: 'w', mode: 0o600 });
}
function loadAgentToken(cryptoProvider) {
  if (!fs.existsSync(agentTokenFile)) return '';
  const protector = cryptoProvider || windowsProtection();
  if (!protector?.isEncryptionAvailable?.()) {
    throw new Error('O token foi salvo mas o Windows nao permite descriptografa-lo.');
  }
  try {
    return protector.decryptString(fs.readFileSync(agentTokenFile));
  } catch (_error) {
    throw new Error('Nao foi possivel abrir o token local. Configure novamente no admin.');
  }
}
function allowInternalCertificate() {
  try {
    const settings = JSON.parse(fs.readFileSync(apiTransportFile, 'utf8'));
    return settings.allowInternalCertificate !== false;
  } catch (_) {
    // Requested corporate pilot default, still restricted to one HTTPS origin.
    return true;
  }
}
function setInternalCertificateMode(enabled) {
  if (typeof enabled !== 'boolean') {
    throw new Error('Modo HTTPS interno invalido.');
  }
  ensureFolder();
  fs.writeFileSync(
    apiTransportFile,
    JSON.stringify({ allowInternalCertificate: enabled }, null, 2),
    { flag: 'w', mode: 0o600 }
  );
}
function saveAgileCredentials(clientId, clientSecret, cryptoProvider = windowsProtection()) {
  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret || id.length > 200 || secret.length > 512 ||
      /[\r\n]/.test(id) || /[\r\n]/.test(secret)) {
    throw new Error('Preencha Client ID e Client Secret validos.');
  }
  if (!cryptoProvider?.isEncryptionAvailable?.()) {
    throw new Error('A protecao de credenciais do Windows nao esta disponivel.');
  }
  ensureFolder();
  const encrypted = cryptoProvider.encryptString(JSON.stringify({
    client_id: id,
    client_secret: secret
  }));
  fs.writeFileSync(agileCredentialsFile, encrypted, { flag: 'w', mode: 0o600 });
}
function loadAgileCredentials(cryptoProvider) {
  if (!fs.existsSync(agileCredentialsFile)) return null;
  const protector = cryptoProvider || windowsProtection();
  if (!protector?.isEncryptionAvailable?.()) {
    throw new Error('A protecao de credenciais do Windows nao esta disponivel.');
  }
  try {
    const value = JSON.parse(protector.decryptString(fs.readFileSync(agileCredentialsFile)));
    if (!value.client_id || !value.client_secret) throw new Error('Dados incompletos.');
    return { client_id: value.client_id, client_secret: value.client_secret };
  } catch (_) {
    throw new Error('Falha ao abrir as credenciais Agile protegidas. Configure novamente.');
  }
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
module.exports = {
  folder, queueFile, agentTokenFile, ensureFolder, loadDeviceId,
  selectedPrinter, savePrinter, recordLead, saveAgentToken, loadAgentToken,
  allowInternalCertificate, setInternalCertificateMode, saveAgileCredentials, loadAgileCredentials
};
