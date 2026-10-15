'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const storage = require('./storage');

const BASE = (
  process.env.HERNANDES_TOTEM_API_BASE_URL ||
  'https://hernandesvpn.dyndns.org:3000/api/ecommerce/totem'
).replace(/\/$/, '');
const TOKEN = process.env.HERNANDES_TOTEM_API_TOKEN || '';
const DEVICE = storage.loadDeviceId();

function explainApiError(error) {
  const code = String(error?.cause?.code || error?.code || '');
  if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) {
    return 'O certificado HTTPS da API não é confiável (' + code +
      '). Instale um certificado válido no servidor; não desative a validação TLS.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'O endereço da API não foi encontrado (DNS). Verifique a rede do totem.';
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'A conexão à API falhou (' + code + '). Verifique a porta 3000 e o servidor.';
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return 'A API não respondeu em até 8 segundos.';
  }
  return 'Não foi possível conectar à API: ' + (code || String(error?.message || 'erro desconhecido'));
}

async function request(route, body) {
  let response;
  try {
    response = await fetch(BASE + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'X-Totem-Token': TOKEN } : {})
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    throw new Error(explainApiError(error), { cause: error });
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('API recusou o acesso (HTTP ' + response.status +
      '). Verifique HERNANDES_TOTEM_API_TOKEN no computador e a chave do servidor.');
  }
  if (!response.ok) throw new Error('A API retornou HTTP ' + response.status +
    ' ao consultar ' + route + '. Confira os logs do HernandesDash.');
  return response.json();
}

let sequence = Promise.resolve();
function serial(task) {
  const next = sequence.then(task, task);
  sequence = next.catch(() => {});
  return next;
}
async function flushCore() {
  if (!fs.existsSync(storage.queueFile)) return;
  const lines = fs.readFileSync(storage.queueFile, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  let sent = 0;
  for (const line of lines) {
    try {
      await request('/events', JSON.parse(line));
      sent++;
    } catch (_) { break; }
  }
  if (!sent) return;
  const remaining = lines.slice(sent);
  if (remaining.length) fs.writeFileSync(storage.queueFile, remaining.join('\n') + '\n', 'utf8');
  else fs.rmSync(storage.queueFile, { force: true });
}
function sendEvent(eventType, sessionId, data = {}) {
  return serial(async () => {
    const event = {
      event_id: crypto.randomUUID(),
      device_id: DEVICE,
      session_id: sessionId,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      ...data
    };
    storage.ensureFolder();
    fs.appendFileSync(storage.queueFile, JSON.stringify(event) + '\n', 'utf8');
    try { await flushCore(); } catch (_) {}
  });
}
function flush() {
  return serial(async () => { try { await flushCore(); } catch (_) {} });
}
async function claim() {
  const response = await request('/printer/claim', {
    device_id: DEVICE,
    printer_id: DEVICE + '-PRINTER'
  });
  return response.job || null;
}
async function complete(jobId, success, error = '') {
  return request('/printer/jobs/' + encodeURIComponent(jobId) + '/complete', {
    printer_id: DEVICE + '-PRINTER',
    success: !!success,
    error: String(error).slice(0, 1800)
  });
}
module.exports = { DEVICE, BASE, sendEvent, flush, claim, complete, explainApiError };
