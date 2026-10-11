/* QuickMart USB-HID keyboard-emulation UHF reader.
   Hardware must continuously report tags to estimate removal.
   This is presence inference, NOT a hardware-defined 14x16-inch read boundary. */
(() => {
  const KEY_GAP_MS=85,MAX_EPC_LENGTH=100,MIN_EPC_LENGTH=6;
  // Presence follows ACTUAL repeated EPC reads. No 12-second display hold.
  // First read: allow brief scan jitter. Continuous reads refresh lastSeen.
  // Removal: infer after ~1–2.5 seconds without a repeat (hardware-dependent).
  const FIRST_MISS_MS=1500,MIN_MISS_MS=1000,MAX_MISS_MS=2500;
  const present=new Map();
  let enabled=false,buffer='',timer=null,lastKeyAt=0;

  const normalize=value=>String(value??'').trim().replace(/\s+/g,'').toUpperCase();
  const valid=epc=>epc.length>=MIN_EPC_LENGTH&&epc.length<=MAX_EPC_LENGTH
    &&/^[A-Z0-9:_-]+$/.test(epc);
  const list=()=>[...present.keys()];
  function emitTray(){window.dispatchEvent(new CustomEvent('rfid:tray',{detail:list()}))}
  function clearPresence(){
    if(!present.size)return;
    present.clear();emitTray();
  }
  function register(raw){
    const epc=normalize(raw);
    if(!valid(epc)||!enabled)return false;
    const now=performance.now(),old=present.get(epc);
    if(old){
      const gap=now-old.lastSeen;
      if(gap>=100&&gap<=30000)old.interval=old.interval===null?gap:(old.interval*.6+gap*.4);
      old.lastSeen=now;old.reads++;
    }else{
      present.set(epc,{lastSeen:now,interval:null,reads:1});
      emitTray();
      // Single newly detected EPC event for *deliberate* one-tag restocking.
      window.dispatchEvent(new CustomEvent('rfid:epc',{detail:epc}));
    }
    window.dispatchEvent(new CustomEvent('rfid:read',{detail:{epc,at:now}}));
    return true;
  }
  function flush(){
    clearTimeout(timer);timer=null;
    const value=buffer;buffer='';
    if(value)register(value);
  }
  function setEnabled(value){
    const next=Boolean(value);
    if(next===enabled)return;
    enabled=next;
    clearTimeout(timer);timer=null;buffer='';lastKeyAt=0;
    if(!enabled)clearPresence();
  }
  function expire(){
    if(!enabled)return;
    const now=performance.now();let changed=false;
    for(const [epc,meta] of present){
      const allowance=meta.interval===null?FIRST_MISS_MS:
        Math.max(MIN_MISS_MS,Math.min(MAX_MISS_MS,meta.interval*3));
      if(now-meta.lastSeen>allowance){present.delete(epc);changed=true}
    }
    if(changed)emitTray();
  }
  document.addEventListener('keydown',event=>{
    if(!enabled||event.ctrlKey||event.altKey||event.metaKey)return;
    // Never mistake a manager typing in a field for an RFID read.
    const active=document.activeElement;
    if(active&&(['INPUT','TEXTAREA','SELECT'].includes(active.tagName)||active.isContentEditable))return;
    const now=performance.now(),burst=now-lastKeyAt<=KEY_GAP_MS;
    lastKeyAt=now;
    if(event.key==='Enter'){
      if(buffer){event.preventDefault();event.stopPropagation();flush()}
      return;
    }
    if(event.key.length!==1||!/^[A-Za-z0-9:_-]$/.test(event.key))return;
    if(buffer&&!burst)flush();
    buffer+=event.key;
    if(buffer.length>MAX_EPC_LENGTH){buffer='';return}
    event.preventDefault();
    clearTimeout(timer);
    timer=setTimeout(flush,KEY_GAP_MS+30);
  },true);
  setInterval(expire,250);
  window.RFIDScanner={
    enable:()=>setEnabled(true),disable:()=>setEnabled(false),setEnabled,
    isEnabled:()=>enabled,
    getPresentEpcs:list,
    getDiagnostics:()=>[...present].map(([epc,d])=>({
      epc,reads:d.reads,estimatedReadIntervalMs:d.interval,
      ageSinceLastReadMs:Math.round(performance.now()-d.lastSeen),
      expiryToleranceMs:Math.round(d.interval===null?FIRST_MISS_MS:
        Math.max(MIN_MISS_MS,Math.min(MAX_MISS_MS,d.interval*3)))
    }))
  };
})();
