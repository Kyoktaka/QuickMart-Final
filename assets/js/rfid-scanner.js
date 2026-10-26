/* QuickMart USB-HID keyboard-emulation UHF reader.
   Presence is inferred ONLY from repeated EPC inventory output.
   No JavaScript setting can increase antenna RF range or guarantee 20-tag reads.
   This is an adaptive read-gap tolerance, not an on-screen countdown. */
(() => {
  // Some USB-HID readers throttle each character during multi-tag inventory.
  // 85ms split the middle of 24-character EPCs into multiple false fragments.
  // Wait longer for a delayed suffix; Enter still flushes immediately.
  const KEY_GAP_MS=240,IDLE_FLUSH_MS=340,MAX_EPC_LENGTH=100,MIN_EPC_LENGTH=6;
  // First sightings need longer protection when the reader inventories many tags.
  // Once rounds are observed, require roughly three missed cycles for removal.
  // Limit stale items: if the reader stops outputting, tags eventually expire.
  const FIRST_MISS_MS=6000,FIRST_PER_PEER_MS=400;
  const MIN_MISS_MS=4500,MAX_MISS_MS=22000,FIRST_MAX_MS=16000;
  const present=new Map();
  let enabled=false,blocked=false,blockedAt=null,buffer='',timer=null,lastKeyAt=0,lastReadAt=null,deadline=0,lastFlushAt=-1e9;
  const CLOSING_ENTER_MS=600;

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
    // While a kiosk popup is open (typing an EPC, checking the cart, removing an
    // item) the reader is blocked: its output is swallowed and never registered.
    if(!valid(epc)||!enabled||blocked)return false;
    const now=performance.now(),old=present.get(epc);
    const previousReadAt=old?.lastSeen??null;
    const previousCycleMs=Math.max(old?.interval||0,estimatedCycle(now));
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
    window.dispatchEvent(new CustomEvent('rfid:read',{detail:{epc,at:now,previousReadAt,previousCycleMs}}));
    return true;
  }
  function flush(){
    clearTimeout(timer);timer=null;
    const value=buffer;buffer='';
    if(value){lastFlushAt=performance.now();register(value)}
  }
  // One timer per burst instead of clear+set on every character: a reader can send thousands of keys per second.
  function armFlush(now){
    deadline=now+IDLE_FLUSH_MS;
    if(timer===null)timer=setTimeout(onIdle,IDLE_FLUSH_MS);
  }
  function onIdle(){
    timer=null;
    if(!buffer)return;
    const left=deadline-performance.now();
    if(left>2){timer=setTimeout(onIdle,left);return}
    flush();
  }
  function setBlocked(value){
    const next=Boolean(value);
    if(next===blocked)return;
    const now=performance.now();
    if(next)blockedAt=now;
    else if(blockedAt!==null){
      const paused=now-blockedAt;
      for(const meta of present.values())meta.lastSeen+=paused;
      if(lastReadAt!==null)lastReadAt+=paused;
      blockedAt=null;
    }
    blocked=next;
    // Drop any half-received reader burst so its prefix cannot be stitched across
    // the boundary. A keyboard-wedge suffix is still ambiguous until its delimiter;
    // backend validation remains mandatory for every resulting EPC frame.
    clearTimeout(timer);timer=null;buffer='';lastKeyAt=0;
    if(blocked)bridgeStop();else bridgeStart();
  }
  // USB bridge (rfid-bridge/rfid_bridge.py): reader is claimed raw, so it never types.
  // Valve: poll only while enabled. Scans made while disabled are cleared on enable.
  // Without explicit bridge pairing, the keyboard-wedge path below still works.
  // Once paired, an unavailable bridge reports failure instead of silently falling back.
  // Pair explicitly with the token printed by the locally configured bridge.
  // A single tab owns a short lease; other tabs/origins cannot drain its reads.
  const BRIDGE_POLL_MS=120,BRIDGE_RETRY_MS=1000,BRIDGE_STORAGE='qm_rfid_bridge';
  let bridgeConfig=null,bridgeTimer=null,bridgeOnline=false,bridgeBusy=false,bridgeRetryAt=0,bridgeGen=0;
  let bridgeOwner=null,bridgeClaimed=false,bridgeError=null,bridgeLastVerifiedConnected=false;
  function bridgeHeaders(config,owner){return {
    'X-QuickMart-Bridge-Token':config.token,'X-QuickMart-Bridge-Owner':owner
  }}
  async function bridgeRequest(path,method,config,owner){
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),2000):null;
    try{
      const res=await fetch('http://127.0.0.1:'+config.port+path,{
        method,headers:bridgeHeaders(config,owner),cache:'no-store',credentials:'omit',
        ...(controller?{signal:controller.signal}:{})
      });
      if(!res.ok)throw new Error('RFID bridge request failed ('+res.status+').');
      return await res.json();
    }finally{if(timeout!==null)clearTimeout(timeout)}
  }
  async function bridgePoll(gen){
    if(bridgeBusy||!enabled||blocked||!bridgeConfig||gen!==bridgeGen)return;
    const now=performance.now();
    if(now<bridgeRetryAt)return;
    const config=bridgeConfig,owner=bridgeOwner;
    bridgeBusy=true;
    try{
      if(!bridgeClaimed){
        await bridgeRequest('/claim','POST',config,owner);
        if(gen!==bridgeGen){void bridgeRequest('/release','POST',config,owner).catch(()=>{});return}
        bridgeClaimed=true;
      }
      const data=await bridgeRequest('/scans','GET',config,owner);
      if(gen!==bridgeGen)return;
      bridgeOnline=data.connected===true;
      bridgeLastVerifiedConnected=bridgeOnline;
      bridgeError=bridgeOnline?null:'Reader disconnected or unsupported. Check the bridge console.';
      // register() drops everything while blocked (kiosk popups, password prompts).
      if(enabled&&!blocked&&bridgeOnline&&Array.isArray(data.epcs))data.epcs.forEach(register);
    }catch(e){
      if(gen===bridgeGen){bridgeOnline=false;bridgeLastVerifiedConnected=false;bridgeClaimed=false;bridgeError=e.message;bridgeRetryAt=performance.now()+BRIDGE_RETRY_MS}
    }finally{if(gen===bridgeGen)bridgeBusy=false}
  }
  function bridgeStart(){
    if(!bridgeConfig||!enabled||blocked||typeof fetch!=='function'||typeof setInterval!=='function'||bridgeTimer!==null)return;
    if(!globalThis.crypto?.getRandomValues){bridgeError='Secure random owner IDs are unavailable.';return}
    const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
    bridgeOwner=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
    const gen=++bridgeGen;
    bridgeTimer=setInterval(()=>bridgePoll(gen),BRIDGE_POLL_MS);
    void bridgePoll(gen);
  }
  function bridgeStop(){
    const config=bridgeConfig,owner=bridgeOwner;
    bridgeGen++;if(bridgeTimer!==null&&typeof clearInterval==='function')clearInterval(bridgeTimer);
    bridgeTimer=null;bridgeOnline=false;bridgeRetryAt=0;bridgeBusy=false;bridgeClaimed=false;bridgeOwner=null;
    if(config&&owner&&typeof fetch==='function')void bridgeRequest('/release','POST',config,owner).catch(()=>{});
  }
  function configureBridge(options){
    const token=String(options?.token||''),port=Number(options?.port??5757);
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)||!Number.isInteger(port)||port<1024||port>65535)
      throw new Error('Provide the bridge token and a port from 1024 to 65535.');
    bridgeStop();bridgeConfig={token,port};bridgeError=null;bridgeLastVerifiedConnected=false;
    try{sessionStorage.setItem(BRIDGE_STORAGE,JSON.stringify(bridgeConfig))}catch(_){}
    bridgeStart();return true;
  }
  function disconnectBridge(){
    bridgeStop();bridgeConfig=null;bridgeError=null;bridgeLastVerifiedConnected=false;
    try{sessionStorage.removeItem(BRIDGE_STORAGE)}catch(_){}
  }

  function setEnabled(value){
    const next=Boolean(value);
    if(next===enabled)return;
    enabled=next;
    clearTimeout(timer);timer=null;buffer='';lastKeyAt=0;lastReadAt=null;
    if(!enabled)clearPresence();
    if(enabled)bridgeStart();else bridgeStop();
  }
  function expire(){
    if(!enabled||blocked)return;
    const now=performance.now();let changed=false;
    // Compute all tolerances against the SAME pre-expiry cohort.
    const allowances=new Map([...present].map(([epc,meta])=>[epc,tolerance(meta,now)]));
    for(const [epc,meta] of present){
      if(now-meta.lastSeen>allowances.get(epc)){
        present.delete(epc);changed=true;
        window.dispatchEvent(new CustomEvent('rfid:absent',{detail:{epc}}));
      }
    }
    if(changed)emitTray();
  }
  document.addEventListener('keydown',event=>{
    if(!enabled||event.ctrlKey||event.altKey||event.metaKey)return;
    if(event.key==='Shift'||event.key==='CapsLock')return;
    // Normal physical keyboard input into editable fields must pass through
    // (js/password-guard.js discards recognized fast hexadecimal EPC bursts there).
    const active=document.activeElement;
    // During a scan batch, the read-only EPC list can be focused without
    // interrupting reader capture. Its readonly state prevents HID text edits.
    const safeScanList=active?.id==='epc-code'&&active.readOnly===true;
    if(active&&!safeScanList&&(['INPUT','TEXTAREA','SELECT'].includes(active.tagName)||active.isContentEditable))return;
    // In paired raw-USB mode the browser keyboard is for the person only.
    // A disconnected bridge reports its failure instead of treating typing as EPCs.
    if(bridgeConfig)return;
    const now=performance.now(),burst=now-lastKeyAt<=KEY_GAP_MS;
    lastKeyAt=now;
    if(event.key==='Enter'){
      if(buffer){event.preventDefault();event.stopPropagation();flush()}
      // The idle flush can fire just before the reader's Enter: that Enter must not click a focused button.
      else if(now-lastFlushAt<=CLOSING_ENTER_MS){event.preventDefault();event.stopPropagation()}
      return;
    }
    let key=event.key;
    if(typeof key!=='string'||key.length!==1)return;
    // The same physical reader keys must produce the same EPC while a person
    // holds Shift or toggles Caps Lock. Ordinary editable fields bypass this
    // capture handler above and retain their actual characters.
    if(/^(?:Digit[0-9]|Key[A-F])$/.test(event.code||''))key=event.code.slice(-1);
    if(!/^[A-Za-z0-9:_-]$/.test(key))return;
    if(buffer&&!burst)flush();
    buffer+=key;
    if(buffer.length>MAX_EPC_LENGTH){buffer='';return}
    event.preventDefault();
    armFlush(now);
  },true);
  setInterval(expire,250);
  window.RFIDScanner={
    enable:()=>setEnabled(true),disable:()=>setEnabled(false),setEnabled,
    setBlocked,isBlocked:()=>blocked,
    isEnabled:()=>enabled,isBridgeOnline:()=>bridgeOnline,getPresentEpcs:list,
    getLastReadAt:epc=>present.get(normalize(epc))?.lastSeen??null,
    configureBridge,disconnectBridge,
    // A capture pause releases queue ownership, not the bridge's USB interface.
    // Last verified health is explicit; paused state is never labelled live-connected.
    getBridgeHealth:()=>({configured:Boolean(bridgeConfig),connected:bridgeOnline,
      lastVerifiedConnected:bridgeLastVerifiedConnected,paused:Boolean(bridgeConfig&&(!enabled||blocked)),error:bridgeError}),
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
  try{const saved=sessionStorage.getItem(BRIDGE_STORAGE);if(saved)configureBridge(JSON.parse(saved))}catch(_){}
})();
