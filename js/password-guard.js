/* Scanner guard - loaded on EVERY manager page (login, dashboard, history, inventory, scan, kiosk).
   The RFID reader is a USB keyboard-wedge: it "types" each tag and presses Enter. It may only be
   listened to while restocking (Start Scanning) and on the kiosk (Product Recognition). Everywhere else
   recognizable fast hexadecimal output is thrown away, silently:
   - focused search box / password / form field: characters arriving at scanner speed are rolled back
     and the reader's closing Enter is swallowed (cannot submit the form or use a password attempt)
   - nothing focused / a button focused (Logout, Cancel, ...): recognized reader characters and its closing Enter
     are swallowed, so a recognized burst cannot click a button; slow or unsupported frames remain ambiguous
   Paste, Backspace, Tab and Space are never intercepted. Ordinary typing is passed through immediately.
   The fallback recognizes long, fast hexadecimal EPC bursts, not the physical USB device:
   sufficiently fast hexadecimal typing remains ambiguous, and slow/non-hex reader output may leak.
   Only a verified independent raw-USB interface can separate the devices reliably.
   While RFIDScanner is enabled and not blocked, this guard stands aside on its capture surface;
   editable fields remain guarded. A paired, connected raw bridge leaves all physical typing alone. */
(function(){
  // KEY_GAP_MS: reader-speed detector. BURST_HOLD_GAP_MS: while a burst runs, a key slower than this is a person
  // (so ordinary slower typing resumes even if the reader keeps reading, e.g. a tag lying on the antenna).
  const KEY_GAP_MS=50,BURST_HOLD_GAP_MS=90,BURST_KEYS=12,BURST_END_MS=400,ENTER_AFTER_MS=500;
  const SCAN_CHAR=/^[A-Fa-f0-9]$/;
  const NOT_TEXT=new Set(['button','checkbox','radio','submit','reset','file','image','range','color','hidden']);
  let last=0,fast=0,burst=false,timer=null,deadline=0,before='',beforeEl=null,selStart=0,selEnd=0,lastScanKey=-Infinity;
  const readerOpen=el=>{const r=globalThis.RFIDScanner;
    if(!r)return false;
    const raw=r.getBridgeHealth?.();
    if(raw?.connected||(raw?.paused&&raw.lastVerifiedConnected))return true;
    const editable=el&&(el.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(el.tagName));
    const safeScanList=el?.id==='epc-code'&&el.readOnly===true;
    return Boolean(r.isEnabled&&r.isEnabled()&&!(r.isBlocked&&r.isBlocked())&&(!editable||safeScanList))};
  const isField=el=>Boolean(el&&(el.isContentEditable||el.tagName==='TEXTAREA'||
    (el.tagName==='INPUT'&&!NOT_TEXT.has(String(el.type||'text').toLowerCase()))));
  const swallow=e=>{e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()};
  // Remember value AND caret/selection, so rolling back a read never throws the caret to the end.
  function remember(el){
    before=String(el?.value??'');beforeEl=el;
    try{selStart=el.selectionStart;selEnd=el.selectionEnd}catch(_){selStart=selEnd=null}
    if(typeof selStart!=='number'){selStart=selEnd=before.length}
  }
  // One timer per burst (extended by a deadline), not clear+set on every reader character.
  function armEnd(now){
    deadline=now+BURST_END_MS;
    if(timer===null)timer=setTimeout(onEnd,BURST_END_MS);
  }
  function onEnd(){
    timer=null;
    const left=deadline-Date.now();
    if(left>2){timer=setTimeout(onEnd,left);return}
    endBurst(true);
  }
  function endBurst(refocus){
    clearTimeout(timer);timer=null;burst=false;fast=0;
    // Only put focus back when it was LOST (page body). Never steal it from where the person clicked.
    const el=beforeEl,a=document.activeElement;
    if(refocus&&el&&el.isConnected&&(!a||a===document.body)){try{el.focus({preventScroll:true})}catch(_){}}
  }
  function rollback(el){
    if(!el||!('value' in el)||el.value===before)return;
    el.value=before;
    try{if(el.setSelectionRange)el.setSelectionRange(Math.min(selStart,before.length),Math.min(selEnd,before.length))}catch(_){}
    try{el.dispatchEvent(new Event('input',{bubbles:true}))}catch(_){}   // let live search / meters refresh
  }

  // The observed SWUSB_HID reader types 24 uppercase hex keys ending in Enter.
  // For the common E2*/30* EPC prefixes, hold the FIRST key before the browser
  // inserts it. The old 12-key detector can roll back a read but briefly shows
  // its prefix in a focused textbox. This preflight eliminates that flash for
  // the verified reader-shaped frames without buffering ordinary prose.
  // Keyboard-wedge input is still indistinguishable from identical fast human
  // input; other EPC prefixes/slow protocols rely on the conservative fallback.
  const EPC_FRAME_GAP_MS=90,EPC_FRAME_MIN_KEYS=20,EPC_FRAME_END_MS=600;
  let epcPending=null,epcPendingTimer=null,epcPendingDeadline=0,epcDropping=false,epcDropAt=0;
  const writable=el=>Boolean(el&&['INPUT','TEXTAREA'].includes(el.tagName)&&
    !el.disabled&&!el.readOnly&&isField(el));
  function replayPending(){
    const p=epcPending;epcPending=null;
    if(!p||!writable(p.el))return;
    const el=p.el,old=String(el.value??'');
    const start=Math.min(p.start,old.length),end=Math.min(Math.max(start,p.end),old.length);
    try{
      if(typeof el.setRangeText==='function')el.setRangeText(p.chars,start,end,'end');
      else{
        el.value=old.slice(0,start)+p.chars+old.slice(end);
        if(el.setSelectionRange)el.setSelectionRange(start+p.chars.length,start+p.chars.length);
      }
    }catch(_){
      // Number and other non-selectable input types do not support setRangeText.
      el.value=old.slice(0,start)+p.chars+old.slice(end);
    }
    try{el.dispatchEvent(new Event('input',{bubbles:true}))}catch(_){}
  }
  function pendingExpiry(){
    epcPendingTimer=null;
    const remain=epcPendingDeadline-Date.now();
    if(remain>2){epcPendingTimer=setTimeout(pendingExpiry,remain);return}
    replayPending();
  }
  function armPending(now){
    epcPendingDeadline=now+EPC_FRAME_GAP_MS;
    if(epcPendingTimer===null)epcPendingTimer=setTimeout(pendingExpiry,EPC_FRAME_GAP_MS);
  }
  function flushPending(){
    clearTimeout(epcPendingTimer);epcPendingTimer=null;
    replayPending();
  }
  document.addEventListener('keydown',e=>{
    const now=Date.now(),el=e.target,key=e.key,hex=typeof key==='string'&&SCAN_CHAR.test(key);
    if(readerOpen(el)||e.ctrlKey||e.metaKey||e.altKey||e.repeat||e.isComposing){
      flushPending();epcDropping=false;return;
    }
    if(epcDropping){
      if((hex&&now-epcDropAt<=EPC_FRAME_GAP_MS)||
         (key==='Enter'&&now-epcDropAt<=EPC_FRAME_END_MS)){
        epcDropAt=now;swallow(e);
        if(key==='Enter')epcDropping=false;
        return;
      }
      epcDropping=false;
    }
    if(epcPending&&(el!==epcPending.el||!hex||now-epcPending.at>EPC_FRAME_GAP_MS)){
      flushPending();
    }
    if(epcPending&&hex){
      epcPending.chars+=key;epcPending.at=now;
      swallow(e);armPending(now);
      if(epcPending.chars.length>=EPC_FRAME_MIN_KEYS){
        epcPending=null;
        clearTimeout(epcPendingTimer);epcPendingTimer=null;
        epcDropping=true;epcDropAt=now;
      }
      return;
    }
    // Deliberately narrow start-of-frame candidates: E2xx... and 30xx...
    // They cover the confirmed reader EPC and the original QuickMart sample
    // EPCs while keeping typical ordinary typing immediate.
    if(writable(el)&&(key==='E'||key==='3')){
      let start=String(el.value??'').length,end=start;
      try{
        if(typeof el.selectionStart==='number')start=el.selectionStart;
        if(typeof el.selectionEnd==='number')end=el.selectionEnd;
      }catch(_){}
      epcPending={el,chars:key,start,end,at:now};
      swallow(e);armPending(now);
    }
  },true);

  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented)return;
    if(readerOpen(e.target)||e.ctrlKey||e.metaKey||e.altKey||e.repeat){
      if(burst||fast)endBurst(false);lastScanKey=-Infinity;return;
    }
    const key=e.key,enter=key==='Enter',printable=typeof key==='string'&&key.length===1;
    if(!enter&&!printable){endBurst(false);lastScanKey=-Infinity;return}
    const el=e.target,field=isField(el),now=Date.now(),gap=now-last;last=now;
    if(burst&&el!==beforeEl){endBurst(false);lastScanKey=-Infinity}
    if(burst){
      // Reader still typing + its closing Enter: swallow. A slower key is a person: end the burst, let it through.
      if((SCAN_CHAR.test(key)&&gap<=BURST_HOLD_GAP_MS)||(enter&&now-lastScanKey<=ENTER_AFTER_MS)){
        lastScanKey=now;swallow(e);armEnd(now);return;
      }
      endBurst(false);
    }
    if(enter){
      // Closing Enter of a read while a button/page has focus: never let it click that button.
      if(!field&&now-lastScanKey<=ENTER_AFTER_MS)swallow(e);
      return;                                                   // a person pressing Enter
    }
    if(!SCAN_CHAR.test(key)){                                   // non-hex input is left to the person; no inferred device identity
      fast=0;remember(el);
      return;
    }
    // Wait for a complete, plausibly reader-speed hexadecimal prefix. Four fast
    // letters also occur in normal typing, so they must never trigger a rollback.
    // Rich contenteditable fields are not rewritten by this plain-input fallback.
    if(el?.isContentEditable){fast=0;return}
    if(el!==beforeEl||gap>=KEY_GAP_MS||!fast){fast=1;remember(el);return}   // normal typing speed
    if(++fast>=BURST_KEYS){burst=true;lastScanKey=now;swallow(e);rollback(el);armEnd(now)}
  },true);
  ['keypress','keyup'].forEach(type=>document.addEventListener(type,e=>{
    if(burst&&!readerOpen(e.target))swallow(e);
  },true));
})();
