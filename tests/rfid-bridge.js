// Bridge poll: enabled -> exclusive authenticated claim then /scans; disabled
// releases ownership; blocked output is dropped at its source rather than drained
// by an arbitrary browser. The old unauthenticated /clear contract is forbidden.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const code=fs.readFileSync('assets/js/rfid-scanner.js','utf8');
const calls=[],events=[],timers=[],storage=new Map();
let queue=[],keyHandler,now=0,pendingScan=null,connected=true,requestStatus=200;
const win={dispatchEvent:e=>events.push(e)};
class CE{constructor(t,o){this.type=t;this.detail=o&&o.detail}}
const response=data=>({ok:requestStatus===200,status:requestStatus,json:async()=>data});
const ctx={window:win,document:{addEventListener(t,f){if(t==='keydown')keyHandler=f},activeElement:null},
  CustomEvent:CE,performance:{now:()=>now},crypto:webcrypto,
  sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
  setTimeout,clearTimeout,setInterval:f=>{timers.push(f);return timers.length},clearInterval:id=>{timers[id-1]=null},
  fetch:async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/scans')){
      if(pendingScan)return pendingScan;
      return response({connected,epcs:queue.splice(0)});
    }
    return response({status:'ok'});
  }};
ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const S=win.RFIDScanner,token='a'.repeat(43);
  S.enable();await settle();
  assert.equal(calls.length,0,'An optional bridge never auto-connects without pairing');
  assert.throws(()=>S.configureBridge({token:'short'}),/token/);
  assert.throws(()=>S.configureBridge({token,port:80}),/port/);
  S.configureBridge({token});await settle();
  assert(calls[0].url.endsWith('/claim'));assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers['X-QuickMart-Bridge-Token'],token);
  const owner=calls[0].options.headers['X-QuickMart-Bridge-Owner'];
  assert.match(owner,/^[a-f0-9]{32}$/);
  assert.equal(calls[1].options.headers['X-QuickMart-Bridge-Owner'],owner);
  queue.push('E280AABB1122');await timers[1]();
  assert.deepEqual([...S.getPresentEpcs()],['E280AABB1122']);assert(S.isBridgeOnline());
  assert.equal(S.getBridgeHealth().lastVerifiedConnected,true);
  assert(storage.has('qm_rfid_bridge'),'Pairing stays in this browser session only');

  // Paired mode must never mistake physical keyboard input for a tag.
  for(const key of 'E280AABB9999')keyHandler({key,preventDefault(){},stopPropagation(){}});
  keyHandler({key:'Enter',preventDefault(){},stopPropagation(){}});
  assert.deepEqual([...S.getPresentEpcs()],['E280AABB1122']);
  S.setBlocked(true);await settle();
  assert.equal(timers[1],null,'Popup stops polling and releases ownership');
  assert(calls.at(-1).url.endsWith('/release'));
  assert.equal(S.getBridgeHealth().connected,false,'Paused capture is never reported as currently connected');
  assert.equal(S.getBridgeHealth().paused,true);
  assert.equal(S.getBridgeHealth().lastVerifiedConnected,true,'USB verification survives a deliberate capture pause');
  assert.deepEqual([...S.getPresentEpcs()],['E280AABB1122'],'Blocking preserves presence');
  S.setBlocked(false);await settle();
  const nextOwner=calls.findLast(c=>c.url.endsWith('/claim')).options.headers['X-QuickMart-Bridge-Owner'];
  assert.notEqual(nextOwner,owner,'Each capture period gets independent queue ownership');

  let resolveScan;pendingScan=new Promise(resolve=>{resolveScan=resolve});
  const inFlight=timers[2]();await settle();S.disable();
  resolveScan(response({connected:true,epcs:['E280AABB7788']}));await inFlight;await settle();
  assert.equal(timers[2],null);assert.equal(S.getPresentEpcs().length,0,
    'A late HTTP result from a closed capture cannot add tags');
  pendingScan=null;connected=false;S.enable();await settle();
  assert.equal(S.isBridgeOnline(),false,'HTTP availability is not proof of reader connection');
  assert.equal(S.getBridgeHealth().lastVerifiedConnected,false,'An observed reader disconnect clears prior verification');
  assert.equal(S.getPresentEpcs().length,0);
  requestStatus=401;now+=2000;await timers.at(-1)();
  assert.match(S.getBridgeHealth().error,/401/);assert.equal(S.isBridgeOnline(),false);
  assert.equal(S.getBridgeHealth().lastVerifiedConnected,false,'A failed poll cannot retain verified isolation');
  S.disconnectBridge();await settle();assert.equal(storage.has('qm_rfid_bridge'),false);
  assert.equal(S.getBridgeHealth().configured,false);
  assert(calls.every(c=>!c.url.endsWith('/clear')),'No arbitrary queue clearing endpoint');
  console.log('Optional bridge pairing, queue ownership, popup valve and stale-response regressions passed');
})().catch(e=>{console.error(e);process.exitCode=1});
