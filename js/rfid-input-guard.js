/* Protect manager credentials, search and edit fields from a USB HID RFID
   reader which types EPCs as keyboard events, even when RFIDScanner.disable()
   is called. A web page cannot identify which physical keyboard sent a key:
   this short-burst filter is a best effort. A reader with configurable prefix
   or a vendor serial/HID inventory API is the reliable hardware solution. */
(() => {
  const MAX_GAP_MS=85, FLUSH_IDLE_MS=140, FAST_AVG_MS=45;
  const MIN_EPC_CHARS=6, MAX_EPC_CHARS=100, SUFFIX_GRACE_MS=220;
  let pending=null, idleTimer=null, suppressSuffixUntil=0;

  const now=()=>performance.now();
  const editTarget=element=>{
    if(!element)return null;
    if(element.isContentEditable)return null; // Do not synthesize rich-text edits.
    const tag=element.tagName;
    if(tag==='TEXTAREA')return element.readOnly||element.disabled?null:element;
    if(tag!=='INPUT'||element.readOnly||element.disabled)return null;
    const type=(element.type||'text').toLowerCase();
    return ['text','password','email','search','url','tel','number'].includes(type)?element:null;
  };
  function putBack(target,text){
    if(!text||!target||!target.isConnected)return;
    const value=target.value||'';
    let start=target.selectionStart,end=target.selectionEnd;
    if(!Number.isInteger(start)||!Number.isInteger(end)){start=end=value.length}
    try{
      target.setRangeText(text,start,end,'end');
    }catch(e){
      target.value=value.slice(0,start)+text+value.slice(end);
    }
    target.dispatchEvent(new Event('input',{bubbles:true,inputType:'insertText',data:text}));
  }
  function plausibleEpc(p){
    const raw=p.text;
    if(raw.length<MIN_EPC_CHARS||raw.length>MAX_EPC_CHARS)return false;
    if(!/^[A-Za-z0-9:_-]+$/.test(raw))return false;
    if(p.gaps.length<MIN_EPC_CHARS-1)return false;
    const avg=p.gaps.reduce((a,b)=>a+b,0)/p.gaps.length;
    return avg<=FAST_AVG_MS&&Math.max(...p.gaps)<=MAX_GAP_MS;
  }
  function finish(fromSuffix=false){
    clearTimeout(idleTimer);idleTimer=null;
    const p=pending;pending=null;
    if(!p)return false;
    // Six fast characters with Enter can be an EPC; without a suffix we
    // demand 12+ to avoid dropping short manually typed usernames/passwords.
    const scannerLike=plausibleEpc(p)&&(fromSuffix||p.text.length>=12);
    if(scannerLike){
      suppressSuffixUntil=now()+SUFFIX_GRACE_MS;
      return true;
    }
    putBack(p.target,p.text);
    return false;
  }
  function schedule(){
    clearTimeout(idleTimer);
    idleTimer=setTimeout(()=>finish(false),FLUSH_IDLE_MS);
  }
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;
    const target=editTarget(document.activeElement);
    const time=now();
    if(!target){
      // Complete pending human text when the user switches focus.
      if(pending)finish(false);
      return;
    }
    if(event.key==='Enter'||event.key==='Tab'){
      const dropped=finish(true);
      if(dropped||time<suppressSuffixUntil){
        event.preventDefault();event.stopImmediatePropagation();
      }
      return;
    }
    if(event.key.length!==1){
      if(pending)finish(false);
      return;
    }
    if(!/^[A-Za-z0-9:_-]$/.test(event.key)){
      if(pending)finish(false);
      return;
    }
    // Hold plausible EPC characters briefly before placing ANY of them
    // into passwords, email, search or product form inputs.
    if(pending&&(pending.target!==target||time-pending.lastAt>MAX_GAP_MS))
      finish(false);
    if(!pending)pending={target,text:'',lastAt:time,gaps:[]};
    else pending.gaps.push(Math.max(0,time-pending.lastAt));
    pending.text+=event.key;
    pending.lastAt=time;
    event.preventDefault();event.stopImmediatePropagation();
    if(pending.text.length>MAX_EPC_CHARS)finish(false);
    else schedule();
  },true);
  document.addEventListener('focusout',()=>{if(pending)finish(false)},true);
  // Expose diagnostics, never the actual credentials or pending text.
  window.RFIDInputGuard={
    isFiltering:()=>Boolean(pending),
    flushTyping:()=>finish(false)
  };
})();
