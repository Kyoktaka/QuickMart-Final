/* Scanner guard - loaded on EVERY manager page (login, dashboard, history, inventory, scan, kiosk).
   The RFID reader is a USB keyboard-wedge: it "types" each tag and presses Enter. It may only be
   listened to while restocking (Start Scanning) and on the kiosk (Product Recognition). Everywhere else
   recognizable fast hexadecimal output is thrown away, silently:
   - focused search box / password / form field: characters arriving at scanner speed are rolled back
     and the reader's closing Enter is swallowed (cannot submit the form or use a password attempt)
   - nothing focused / a button focused (Logout, Cancel, ...): recognized reader characters and its closing Enter
     are swallowed, so a recognized burst cannot click a button; slow or unsupported frames remain ambiguous
   Paste and Tab retain native behavior. Editing keys and non-hex text during a pending
   reader candidate are deferred until it resolves, then applied to the clean field.
   Ordinary typing outside a reader candidate passes through immediately.
   E/e/3 prefix candidates are the narrow exception: their original text may wait up to 90 ms after
   the last candidate key. Deferred edits retain their order when that text is manual input.
   The fallback recognizes long, fast hexadecimal EPC bursts, not the physical USB device:
   sufficiently fast hexadecimal typing remains ambiguous, and slow/non-hex reader output may leak.
   Only a verified independent raw-USB interface can separate the devices reliably.
   While RFIDScanner is enabled and not blocked, this guard stands aside on its capture surface;
   editable fields remain guarded. A paired, connected raw bridge leaves all physical typing alone. */
(function(){
  if(globalThis.QuickMartInputGuard)return;
  // KEY_GAP_MS: reader-speed detector. BURST_HOLD_GAP_MS: while a burst runs, a key slower than this is a person
  // (so ordinary slower typing resumes even if the reader keeps reading, e.g. a tag lying on the antenna).
  const KEY_GAP_MS=85,CANDIDATE_GAP_MS=240,BURST_HOLD_GAP_MS=340,BURST_KEYS=12,BURST_END_MS=400,ENTER_AFTER_MS=500;
  // Throttled readers (and Shift transitions) stretch key gaps past KEY_GAP_MS. A hex run this long
  // at sub-240ms gaps is treated as a reader frame; an EPC is 24 characters.
  const SLOW_BURST_KEYS=20;
  const SCAN_CHAR=/^[A-Fa-f0-9]$/;
  // Shift/Caps Lock change event.key, including digits into punctuation. Use
  // physical hex positions only for frame recognition; replay the original
  // character when the candidate is ordinary typing.
  const scanChar=e=>{
    if(typeof e.key!=='string'||e.key.length!==1)return '';
    if(/^(?:Digit[0-9]|Key[A-F])$/.test(e.code||''))return e.code.slice(-1);
    return SCAN_CHAR.test(e.key)?e.key.toUpperCase():'';
  };
  const NOT_TEXT=new Set(['button','checkbox','radio','submit','reset','file','image','range','color','hidden']);
  let last=0,fast=0,slow=0,burst=false,timer=null,deadline=0,before='',beforeEl=null,selStart=0,selEnd=0,lastScanKey=-Infinity;
  let candidateAt=0,candidatePrefix='',closingEnter=false,closingEnterAt=0;
  const insertionSnapshots=new WeakMap();
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
    // Release deferred human edits now, but retain the identified frame's
    // separate closing-Enter window through EPC_FRAME_END_MS.
    endBurst(true);
  }
  function endBurst(refocus){
    clearTimeout(timer);timer=null;burst=false;fast=0;slow=0;
    replayEdits();
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
  // A possible E/e/3 prefix is briefly held even during ordinary prose; exact
  // event.key characters and selection are replayed if no reader frame forms.
  // Keyboard-wedge input is still indistinguishable from identical fast human
  // input; other EPC prefixes/slow protocols rely on the conservative fallback.
  const EPC_FRAME_GAP_MS=90,EPC_FRAME_MIN_KEYS=BURST_KEYS,EPC_FRAME_END_MS=600;
  let epcPending=null,epcPendingTimer=null,epcPendingDeadline=0,epcDropping=false,epcDropAt=0,epcDropEl=null;
  const writable=el=>Boolean(el&&['INPUT','TEXTAREA'].includes(el.tagName)&&
    !el.disabled&&!el.readOnly&&isField(el));
  let deferredEdits=[];
  function replaceRange(el,text,start,end){
    try{el.setRangeText(text,start,end,'end')}
    catch(_){
      el.value=el.value.slice(0,start)+text+el.value.slice(end);
      try{el.setSelectionRange(start+text.length,start+text.length)}catch(_){}
    }
    el.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function applyEdit({el,key}){
    if(!writable(el)||el.isConnected===false)return;
    let start=el.selectionStart,end=el.selectionEnd;
    if(typeof start!=='number'||typeof end!=='number')start=end=String(el.value??'').length;
    let text=key;
    if(key==='Backspace'||key==='Delete'){
      text='';
      if(start===end){
        if(key==='Backspace')start=Math.max(0,start-1);
        else end=Math.min(el.value.length,end+1);
      }
    }
    replaceRange(el,text,start,end);
  }
  function replayEdits(){
    const edits=deferredEdits;deferredEdits=[];
    edits.forEach(applyEdit);
  }
  function replayPending(){
    const p=epcPending;epcPending=null;
    if(!p||!writable(p.el))return;
    const el=p.el,old=String(el.value??'');
    let start=Math.min(p.start,old.length),end=Math.min(Math.max(start,p.end),old.length);
    // If a USB pause expires the prefix buffer, the fallback must still know
    // the value before that prefix. Otherwise its later rollback leaves the
    // replayed first 1-3 reader characters behind.
    // Prefix keys already advance the shared candidate while held. Replaying
    // them must not reset that candidate or its original rollback baseline.
    const edits=p.edits||[],held=new Set(edits.map(entry=>entry.edit));
    deferredEdits=deferredEdits.filter(edit=>!held.has(edit));
    let offset=0;
    for(const entry of edits){
      const at=Math.min(entry.offset,p.chars.length);
      replaceRange(el,p.chars.slice(offset,at),start,end);
      applyEdit(entry.edit);offset=at;
      start=typeof el.selectionStart==='number'?el.selectionStart:el.value.length;
      end=typeof el.selectionEnd==='number'?el.selectionEnd:start;
    }
    if(offset<p.chars.length)replaceRange(el,p.chars.slice(offset),start,end);
  }
  function pendingExpiry(){
    epcPendingTimer=null;
    const remain=epcPendingDeadline-Date.now();
    if(remain>2){epcPendingTimer=setTimeout(pendingExpiry,remain);return}
    replayPending();replayEdits();
  }
  function armPending(now,extend=true){
    if(extend)epcPendingDeadline=now+EPC_FRAME_GAP_MS;
    if(epcPendingTimer===null)epcPendingTimer=setTimeout(pendingExpiry,EPC_FRAME_GAP_MS);
  }
  function flushPending(){
    clearTimeout(epcPendingTimer);epcPendingTimer=null;
    replayPending();replayEdits();
  }
  function discardPending(){
    epcPending=null;clearTimeout(epcPendingTimer);epcPendingTimer=null;
  }
  function recognizePending(now){
    if(fast<EPC_FRAME_MIN_KEYS)return;
    const el=epcPending.el;
    discardPending();epcDropping=true;epcDropAt=now;epcDropEl=el;
    rollback(el);armEnd(now);
  }
  // A keyboard-wedge may mark consecutive identical keys as auto-repeat.
  // Auto-repeat is not a device identity: keep ordinary held keys available,
  // but never use it to release an EPC prefix or an already rejected frame.
  function readerRepeat(e,now,scan){
    const enter=e.key==='Enter',el=e.target;
    if(epcDropping&&el===epcDropEl&&
       ((scan&&now-epcDropAt<=BURST_HOLD_GAP_MS)||(enter&&now-epcDropAt<=EPC_FRAME_END_MS)))return true;
    if(burst&&el===beforeEl&&
       ((scan&&now-last<=BURST_HOLD_GAP_MS)||(enter&&now-lastScanKey<=ENTER_AFTER_MS)))return true;
    if(scan&&epcPending?.el===el&&now-epcPending.at<=EPC_FRAME_GAP_MS&&
       /^(?:E2|30)$/.test(epcPending.prefix))return true;
    return Boolean(scan&&el===beforeEl&&fast>=2&&now-last<=CANDIDATE_GAP_MS&&
      /^(?:E2|30)$/.test(candidatePrefix));
  }
  document.addEventListener('keydown',e=>{
    // Uppercase HID letters may press/release Shift around each letter. Shift
    // is part of the reader frame, not a reason to replay or release it.
    // Caps Lock can also occur between reader characters. Preserve its native
    // toggle without flushing the pending prefix or releasing a rejected frame.
    if(e.key==='Shift'||e.key==='CapsLock')return;
    const now=Date.now(),el=e.target,key=e.key,scan=scanChar(e),hex=Boolean(scan);
    const edit=key==='Backspace'||key==='Delete'||
      (typeof key==='string'&&key.length===1&&!hex);
    const activeFrame=(epcPending?.el===el&&now-epcPending.at<=EPC_FRAME_GAP_MS)||
      (epcDropping&&epcDropEl===el&&now-epcDropAt<=BURST_HOLD_GAP_MS)||
      (burst&&beforeEl===el&&now-lastScanKey<=BURST_HOLD_GAP_MS);
    if(closingEnter&&(now-closingEnterAt>ENTER_AFTER_MS||key!=='Enter'))closingEnter=false;
    if(closingEnter&&key==='Enter'&&e.repeat&&!readerOpen(el)){swallow(e);return}
    if(readerOpen(el)||e.ctrlKey||e.metaKey||e.altKey||
       (e.repeat&&!readerRepeat(e,now,scan)&&!(edit&&activeFrame&&writable(el)))||e.isComposing||e.keyCode===229){
      flushPending();epcDropping=false;return;
    }
    // Even the first 1-3 buffered keys may be an RFID prefix. Do not replay
    // them into the field merely because a person presses Backspace/Delete.
    // Editing during a pending candidate must not split the RFID
    // frame. Hold the person's edit until the frame ends; replay it against
    // the clean value, or after the candidate text if it was ordinary typing.
    if(edit&&activeFrame&&writable(el)){
      const edit={el,key};deferredEdits.push(edit);
      if(epcPending?.el===el)(epcPending.edits??=[]).push({offset:epcPending.chars.length,edit});
      swallow(e);return;
    }
    if(burst)return;
    if(epcDropping&&el!==epcDropEl)epcDropping=false;
    if(epcDropping){
      if((hex&&now-epcDropAt<=BURST_HOLD_GAP_MS)||
         (key==='Enter'&&now-epcDropAt<=EPC_FRAME_END_MS)){
        epcDropAt=now;swallow(e);armEnd(now);
        if(key==='Enter'){epcDropping=false;endBurst(false);closingEnter=true;closingEnterAt=now}
        return;
      }
      epcDropping=false;
    }
    if(epcPending&&(el!==epcPending.el||!hex||now-epcPending.at>EPC_FRAME_GAP_MS)){
      flushPending();
    }
    if(epcPending&&hex){
      trackCandidate(el,now,now-last,scan,e.repeat);last=now;
      epcPending.chars+=key;epcPending.at=now;
      const nextPrefix=epcPending.lastScan+scan;
      if(!/^(?:E2|30)$/.test(epcPending.prefix)&&/^(?:E2|30)$/.test(nextPrefix)){
        // A person's briefly held E/e/3 can overlap the next reader prefix.
        // Replay only those preceding manual characters; keep the new frame.
        const p=epcPending,manual=p.chars.slice(0,-2),chars=p.chars.slice(-2);
        if(manual){
          p.chars=manual;replayPending();
          const start=p.start+manual.length;
          epcPending={el,chars,prefix:nextPrefix,before:String(el.value??''),start,end:start,at:now};
        }else epcPending.prefix=nextPrefix;
        // A reader can start immediately after a hexadecimal password key.
        // Its own confirmed prefix owns the rollback baseline, so rejecting
        // that frame cannot erase the person's preceding character/selection.
        before=epcPending.before;beforeEl=el;selStart=epcPending.start;selEnd=epcPending.end;
        candidatePrefix=epcPending.prefix;candidateAt=now;fast=2;slow=2;
      }else if(epcPending.prefix.length<2)epcPending.prefix+=scan;
      epcPending.lastScan=scan;
      // Repeating one key after a weak two/three-key prefix is ordinary held-key
      // input, not further scanner evidence. It cannot extend buffering forever.
      swallow(e);armPending(now,!e.repeat||fast>=4);
      recognizePending(now);
      return;
    }
    // Deliberately narrow start-of-frame candidates: E2xx... and 30xx...
    // They cover the confirmed reader EPC and the original QuickMart sample
    // EPCs while keeping typical ordinary typing immediate.
    if(writable(el)&&(scan==='E'||scan==='3')){
      trackCandidate(el,now,now-last,scan,e.repeat);last=now;
      let start=String(el.value??'').length,end=start;
      try{
        if(typeof el.selectionStart==='number')start=el.selectionStart;
        if(typeof el.selectionEnd==='number')end=el.selectionEnd;
      }catch(_){}
      epcPending={el,chars:key,prefix:scan,lastScan:scan,before:String(el.value??''),start,end,at:now};
      swallow(e);armPending(now);recognizePending(now);
    }
  },true);

  function resetCandidate(el,now,scan){
    fast=1;slow=1;candidateAt=now;candidatePrefix=scan;remember(el);
  }
  function trackCandidate(el,now,gap,scan,repeat){
    if(el!==beforeEl||gap>CANDIDATE_GAP_MS||!fast||now-candidateAt>BURST_HOLD_GAP_MS*SLOW_BURST_KEYS){
      resetCandidate(el,now,scan);snapshot(el);return;
    }
    if(candidatePrefix.length<2)candidatePrefix+=scan;
    // Preserve the original prefix through short USB pauses, even before the
    // first two keys establish a fast run. Previously a pause
    // reset the rollback baseline to include scanner characters already inserted.
    // normal typing speed: slower keys do not increase the fast-key count.
    // Held keys do not supply additional evidence of a scanner. Once a frame
    // is identified its repeats are still swallowed by the frame handlers.
    if(gap<KEY_GAP_MS&&!repeat)fast++;
    if(gap<CANDIDATE_GAP_MS&&!repeat)slow++;
  }
  function isBulkFrame(text){
    return typeof text==='string'&&/^(?:EPC[:=\s]+)?[A-Fa-f0-9]{6,100}[\r\n]*$/.test(text);
  }
  function snapshot(el){
    if(!isField(el)||!('value' in el))return;
    const value=String(el.value);
    insertionSnapshots.set(el,{value,start:typeof el.selectionStart==='number'?el.selectionStart:value.length,
      end:typeof el.selectionEnd==='number'?el.selectionEnd:value.length});
  }
  // A keyboard-wedge frame may arrive as one browser text insertion rather than
  // one keydown per character. Guard that path before page input handlers run.
  document.addEventListener('beforeinput',e=>{
    if(readerOpen(e.target)||e.isComposing||!isField(e.target))return;
    snapshot(e.target);
    if(e.inputType==='insertText'&&isBulkFrame(e.data)){
      if(epcPending?.el===e.target)discardPending();
      lastScanKey=Date.now();beforeEl=e.target;burst=true;swallow(e);armEnd(lastScanKey);
    }
  },true);
  document.addEventListener('input',e=>{
    const el=e.target;
    if(readerOpen(el)||e.isComposing||!isField(el)||!('value' in el))return;
    if(e.inputType==='insertText'&&isBulkFrame(e.data)){
      if(epcPending?.el===el)discardPending();
      const previous=insertionSnapshots.get(el),value=String(el.value),data=String(e.data);
      if(previous&&value===previous.value.slice(0,previous.start)+data+previous.value.slice(previous.end)){
        el.value=previous.value;
        try{el.setSelectionRange(previous.start,previous.end)}catch(_){}
      }else{
        const end=typeof el.selectionStart==='number'?el.selectionStart:value.length,start=end-data.length;
        if(start>=0&&value.slice(start,end)===data){
          el.value=value.slice(0,start)+value.slice(end);
          try{el.setSelectionRange(start,start)}catch(_){}
        }
      }
      lastScanKey=Date.now();beforeEl=el;burst=true;armEnd(lastScanKey);
      e.stopPropagation?.();e.stopImmediatePropagation?.();
    }
    snapshot(el);
  },true);
  document.addEventListener('focusin',e=>{snapshot(e.target)},true);
  document.addEventListener('keydown',e=>{
    if(e.key==='Shift'||e.key==='CapsLock')return;
    if(e.defaultPrevented)return;
    if(readerOpen(e.target)||e.ctrlKey||e.metaKey||e.altKey||
       (e.repeat&&!readerRepeat(e,Date.now(),scanChar(e)))||e.isComposing||e.keyCode===229){
      if(burst||fast)endBurst(false);lastScanKey=-Infinity;return;
    }
    const key=e.key,scan=scanChar(e),enter=key==='Enter',printable=typeof key==='string'&&key.length===1;
    if(!enter&&!printable){endBurst(false);lastScanKey=-Infinity;snapshot(e.target);return}
    const el=e.target,field=isField(el),now=Date.now(),gap=now-last;last=now;
    if(burst&&el!==beforeEl){endBurst(false);lastScanKey=-Infinity}
    if(burst){
      // Reader still typing + its closing Enter: swallow. A slower key is a person: end the burst, let it through.
      if((scan&&gap<=BURST_HOLD_GAP_MS)||(enter&&now-lastScanKey<=ENTER_AFTER_MS)){
        lastScanKey=now;swallow(e);
        // Enter completes the frame. Do not hold the following person's hex
        // keys for another frame-pause interval after the reader has finished.
        if(enter){endBurst(false);closingEnter=true;closingEnterAt=now}else armEnd(now);
        return;
      }
      endBurst(false);
    }
    if(enter){
      // Closing Enter of a read while a button/page has focus: never let it click that button.
      if(!field&&now-lastScanKey<=ENTER_AFTER_MS)swallow(e);
      return;                                                   // a person pressing Enter
    }
    if(!scan){                                                // non-hex input is left to the person; no inferred device identity
      fast=0;slow=0;remember(el);
      return;
    }
    // Wait for a complete, plausibly reader-speed hexadecimal prefix. Four fast
    // letters also occur in normal typing, so they must never trigger a rollback.
    // Rich contenteditable fields are not rewritten by this plain-input fallback.
    if(el?.isContentEditable){fast=0;slow=0;return}
    trackCandidate(el,now,gap,scan,e.repeat);
    if(fast>=BURST_KEYS||slow>=SLOW_BURST_KEYS){burst=true;lastScanKey=now;swallow(e);rollback(el);armEnd(now)}
  },true);
  ['keypress','keyup'].forEach(type=>document.addEventListener(type,e=>{
    if((burst||(closingEnter&&e.key==='Enter'))&&!readerOpen(e.target))swallow(e);
    if(type==='keyup'&&e.key==='Enter')closingEnter=false;
  },true));
  globalThis.QuickMartInputGuard={
    // Timing fallback, not physical-device authentication. A verified raw bridge
    // or reader-delimited protocol is still required for absolute separation.
    isDiscarding:el=>Boolean((burst&&el===beforeEl&&Date.now()-lastScanKey<=BURST_END_MS)||
      (epcDropping&&el===epcDropEl&&Date.now()-epcDropAt<=EPC_FRAME_END_MS))
  };
})();
