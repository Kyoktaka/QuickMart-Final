const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto').webcrypto;

async function main() {
  const storage = new Map();
  const bodies = [];
  let reply = {status: 503, body: {success: false, message: 'Unavailable'}};
  const state = {current: 'ORDER_RECOVERY', cart: [], kioskOn: true};
  const context = vm.createContext({state, crypto, Uint8Array, Date, JSON, Set,
    sessionStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    fetch: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (reply instanceof Error) throw reply;
      return {ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(reply.body)};
    }});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/backend.js'), 'utf8'), context);
  const pay = text => vm.runInContext(`Backend.processPayment(${JSON.stringify(text)})`, context);
  assert.equal((await pay('first QR')).result, 'error');
  assert(storage.has('quickmart.payment.pending'), 'An uncertain server outcome must preserve its request identity.');
  reply = new Error('Disconnected');
  await pay('second QR');
  assert.deepEqual(bodies[1], bodies[0], 'Connection loss must retry the same attempt and original QR.');
  reply = {status: 422, body: {success: false, code: 'INVALID_DEMO_QR', message: 'Invalid', session: {status: 'PAYMENT', failed_attempts: 1}}};
  assert.equal((await pay('third QR')).session.failed_attempts, 1);
  assert.deepEqual(bodies[2], bodies[0], 'Uncertain outcome must stay idempotent until answered.');
  assert(!storage.has('quickmart.payment.pending'), 'An answered attempt must release its identity.');
  await pay('fourth QR');
  assert.notEqual(bodies[3].attempt_id, bodies[2].attempt_id, 'A deliberate new QR scan needs a new attempt identity.');
  assert.equal(bodies[3].payment_qr, 'fourth QR');
  reply = {status: 409, body: {success: false, message: 'Voided', session: {status: 'VOIDED', failed_attempts: 3}}};
  assert.equal((await pay('fifth QR')).result, 'voided');
  reply = {status: 200, body: {success: true, purchase: {purchase_id: 42}, session: {status: 'SUCCESSFUL'}}};
  assert.equal((await pay('success QR')).purchase.purchase_id, 42);

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', style: {}, classList: {remove() {}, add() {}}, offsetWidth: 1});
    return elements.get(id);
  };
  let result;
  let stopped = 0;
  let completed = null;
  let shown = null;
  const ui = vm.createContext({state: {processing: false, checkout: {failed_attempts: 0}},
    $: element, onScreen: () => true, Backend: {processPayment: async () => result},
    navigator: {}, window: {addEventListener() {}},
    stopTimer: () => stopped++, stopCameraScanner: async () => {},
    applyCheckoutSession: session => {ui.state.checkout = session;},
    completePayment: async receipt => {completed = receipt;}, screen: id => {shown = id;},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/qr-payment.js'), 'utf8'), ui);
  const decode = () => vm.runInContext("onQrDecoded('fixture')", ui);
  result = {result: 'invalid', reason: 'Invalid QR', session: {status: 'PAYMENT', failed_attempts: 2}};
  await decode();
  assert.match(element('#btn-cam-retry').textContent, /3 of 3/);
  assert.equal(ui.state.checkout.failed_attempts, 2, 'UI must read the server counter rather than incrementing a local counter.');
  assert.equal(stopped, 0, 'A rejected attempt must keep the original deadline running.');
  result = {result: 'error', reason: 'Connection lost'};
  await decode();
  assert.equal(ui.state.checkout.failed_attempts, 2, 'Connectivity must not consume payment attempts.');
  result = {result: 'failed', reason: 'No balance', session: {status: 'VOIDED', failed_attempts: 3, reason: 'three_failed_attempts'}};
  await decode();
  assert.equal(shown, 'k-fail');
  assert.match(element('#fail-reason').textContent, /3 attempts/);
  result = {result: 'success', purchase: {purchase_id: 42}, session: {status: 'SUCCESSFUL'}};
  await decode();
  assert.equal(completed.purchase_id, 42);
  assert.equal(ui.state.processing, false);
  console.log('Payment request recovery and server-authoritative QR UI checks passed');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
