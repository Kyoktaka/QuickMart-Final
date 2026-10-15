/* QuickMart USB-HID keyboard-emulation UHF reader.
   Presence is inferred ONLY from repeated EPC inventory output.
   No JavaScript setting can increase antenna RF range or guarantee 20-tag reads.
   This is an adaptive read-gap tolerance, not an on-screen countdown. */
(() => {
  const KEY_GAP_MS=85,MAX_EPC_LENGTH=100,MIN_EPC_LENGTH=6;
  // First sightings need longer protection when the reader inventories many tags.
  // Once rounds are observed, require roughly three missed cycles for removal.
  // Limit stale items: if the reader stops outputting, tags eventually expire.
  const FIRST_MISS_MS=6000,FIRST_PER_PEER_MS=400;
  const MIN_MISS_MS=4500,MAX_MISS_MS=22000,FIRST_MAX_MS=16000;
  const present=new Map();
  let enabled=false,buffer='',timer=null,lastKeyAt=0,lastReadAt=null;

  const normalize=value=>String(value??'').trim().replace(/\s+/g,'').toUpperCase();
  const valid=epc=>epc.length>=MIN_EPC_LENGTH&&epc.length<=MAX_EPC_LENGTH
    &&/^[A-Z0-9:_-]+$/.test(epc);
  const list=()=>[...present.keys()];
  function emitTray(){window.dispatchEvent(new CustomEvent('rfid:tray',{detail:list()}))}
  function clearPresence(){
    if(!present.size)return;
    present.clear();emitTray();
  }
  function estimatedCycle(now){
    const periods=[...present.values()]
      .filter(m=>m.interval!==null&&now-m.lastSeen<=MAX_MISS_MS)
      .map(m=>m.interval).sort((a,b)=>a-b);
    // A typical slower scan cycle, not an outlier or a burst of duplicate EPCs.
    return periods.length?periods[Math.floor((periods.length-1)*.75)]:0;
  }
  function tolerance(meta,now){
    const cycle=Math.max(meta.interval||0,estimatedCycle(now));
    if(meta.reads<2){
      const first=Math.min(FIRST_MAX_MS,FIRST_MISS_MS+
        Math.max(0,present.size-1)*FIRST_PER_PEER_MS);
      return Math.min(MAX_MISS_MS,Math.max(first,cycle*3));
    }
    return Math.max(MIN_MISS_MS,Math.min(MAX_MISS_MS,cycle*3));
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
      // Inventory restock intentionally listens to rfid:read, not bulk tray snapshots.
      window.dispatchEvent(new CustomEvent('rfid:epc',{detail:epc}));
    }
    lastReadAt=now;
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
    clearTimeout(timer);timer=null;buffer='';lastKeyAt=0;lastReadAt=null;
    if(!enabled)clearPresence();
  }
  function expire(){
    if(!enabled)return;
    const now=performance.now();let changed=false;
    // Compute all tolerances against the SAME pre-expiry cohort.
    const allowances=new Map([...present].map(([epc,meta])=>[epc,tolerance(meta,now)]));
    for(const [epc,meta] of present){
      if(now-meta.lastSeen>allowances.get(epc)){present.delete(epc);changed=true}
    }
    if(changed)emitTray();
  }
  document.addEventListener('keydown',event=>{
    if(!enabled||event.ctrlKey||event.altKey||event.metaKey)return;
    // Ignore typing into forms (including the manual EPC input modal).
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
    isEnabled:()=>enabled,getPresentEpcs:list,
    getDiagnostics:()=>{const now=performance.now();return [...present].map(([epc,d])=>({
      epc,reads:d.reads,estimatedReadIntervalMs:d.interval,
      ageSinceLastReadMs:Math.round(now-d.lastSeen),
      expiryToleranceMs:Math.round(tolerance(d,now))
    }))},
    getReadHealth:()=>{
      const now=performance.now();
      return {enabled,trackedTags:present.size,
        estimatedInventoryCycleMs:Math.round(estimatedCycle(now)),
        ageSinceAnyReadMs:lastReadAt===null?null:Math.round(now-lastReadAt)}
    }
  };
})();
