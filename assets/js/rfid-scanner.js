/* HID UHF keyboard reader, based on current QuickMart grace-period logic. */
(()=>{
  const present=new Map();let enabled=false,buffer='',timer,lastKey=0;
  const list=()=>[...present.keys()];
  const valid=s=>s.length>=6&&s.length<=100&&/^[A-Z0-9:_-]+$/.test(s);
  const emit=()=>window.dispatchEvent(new CustomEvent('rfid:tray',{detail:list()}));
  const clear=()=>{if(present.size){present.clear();emit()}};
  const flush=()=>{clearTimeout(timer);timer=null;const value=buffer.trim().toUpperCase();buffer='';if(!enabled||!valid(value))return;
    const now=performance.now(),prior=present.get(value);
    if(prior){const gap=now-prior.lastSeen;if(gap>=100&&gap<=30000)prior.interval=prior.interval===null?gap:prior.interval*.6+gap*.4;
      prior.lastSeen=now;prior.reads++}
    else{present.set(value,{lastSeen:now,interval:null,reads:1});emit();window.dispatchEvent(new CustomEvent('rfid:epc',{detail:value}))}
    window.dispatchEvent(new CustomEvent('rfid:read',{detail:{epc:value,at:now}}));
  };
  const setEnabled=value=>{if(!!value===enabled)return;enabled=!!value;clearTimeout(timer);buffer='';lastKey=0;if(!enabled)clear()};
  document.addEventListener('keydown',e=>{
    if(!enabled||e.ctrlKey||e.metaKey||e.altKey)return;
    const active=document.activeElement;if(active&&(['INPUT','TEXTAREA','SELECT'].includes(active.tagName)||active.isContentEditable))return;
    const now=performance.now(),burst=now-lastKey<=85;lastKey=now;
    if(e.key==='Enter'){if(buffer){e.preventDefault();e.stopPropagation();flush()}return}
    if(e.key.length!==1||!/^[A-Za-z0-9:_-]$/.test(e.key))return;
    if(buffer&&!burst)flush();buffer+=e.key;if(buffer.length>100){buffer='';return}
    e.preventDefault();clearTimeout(timer);timer=setTimeout(flush,115);
  },true);
  setInterval(()=>{if(!enabled)return;const now=performance.now();let changed=false;
    for(const [epc,d] of present){const ttl=d.interval===null?6000:Math.max(4500,Math.min(9000,d.interval*5));
      if(now-d.lastSeen>ttl){present.delete(epc);changed=true}}
    if(changed)emit();
  },250);
  window.RFIDScanner={enable:()=>setEnabled(true),disable:()=>setEnabled(false),setEnabled,
    isEnabled:()=>enabled,getPresentEpcs:list,
    getDiagnostics:()=>[...present].map(([epc,d])=>({epc,reads:d.reads,estimatedReadIntervalMs:d.interval,
      ageSinceLastReadMs:Math.round(performance.now()-d.lastSeen)}))};
})();
