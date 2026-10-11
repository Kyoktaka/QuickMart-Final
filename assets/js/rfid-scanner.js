(() => {
  const PRESENCE_GRACE_MS = 3000;
  const KEY_GAP_MS = 85;
  const MIN_EPC_LENGTH = 6;
  const MAX_EPC_LENGTH = 128;

  const present = new Map();
  let enabled = false;
  let buffer = '';
  let flushTimer = null;
  let lastKeyAt = 0;

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
  }

  function looksLikeEpc(value) {
    return value.length >= MIN_EPC_LENGTH &&
      value.length <= MAX_EPC_LENGTH &&
      /^[A-Z0-9:_-]+$/.test(value);
  }

  function list() {
    return [...present.keys()];
  }

  function emitChanged() {
    const epcs = list();
    window.dispatchEvent(new CustomEvent('rfid:tray', { detail: epcs }));
    window.dispatchEvent(new CustomEvent('rfid:epcs', { detail: epcs }));
  }

  function register(epc) {
    epc = normalize(epc);
    if (!looksLikeEpc(epc)) return false;

    const wasPresent = present.has(epc);
    present.set(epc, performance.now());

    if (!wasPresent) emitChanged();
    return true;
  }

  function flushBuffer() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!buffer) return;
    const value = normalize(buffer);
    buffer = '';
    register(value);
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushBuffer, KEY_GAP_MS + 10);
  }

  function expire() {
    if (!enabled) return;
    const now = performance.now();
    let changed = false;
    for (const [epc, lastSeen] of present.entries()) {
      if (now - lastSeen > PRESENCE_GRACE_MS) {
        present.delete(epc);
        changed = true;
      }
    }
    if (changed) emitChanged();
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      clearTimeout(flushTimer);
      flushTimer = null;
      buffer = '';
      if (present.size) {
        present.clear();
        emitChanged();
      }
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!enabled) return;

    const now = performance.now();
    const isFastBurst = now - lastKeyAt <= KEY_GAP_MS;
    lastKeyAt = now;

    if (event.key === 'Enter') {
      if (buffer) {
        event.preventDefault();
        event.stopPropagation();
        flushBuffer();
      }
      return;
    }

    if (event.key.length !== 1) return;
    if (!/^[A-Za-z0-9:_-]$/.test(event.key)) return;

    // During RFID capture, the scanner should not type EPC characters into form controls.
    const active = document.activeElement;
    const isFormField = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);

    if (buffer && !isFastBurst) flushBuffer();

    buffer += event.key;
    if (buffer.length > MAX_EPC_LENGTH) buffer = buffer.slice(-MAX_EPC_LENGTH);

    if (isFastBurst || isFormField) event.preventDefault();
    scheduleFlush();
  }, true);

  setInterval(expire, 250);

  window.RFIDScanner = {
    enable: () => setEnabled(true),
    disable: () => setEnabled(false),
    setEnabled,
    getPresentEpcs: list
  };
})();
