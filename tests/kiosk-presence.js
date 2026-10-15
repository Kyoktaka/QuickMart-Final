// Browser-free regression test for bursty 20-tag kiosk requests and removals.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/kiosk.js','utf8');
const elements=new Map(),listeners={},requests=[],notifications=[];
const screens=['k-idle','k-cart','k-qr','k-success','k-fail'];
let now=0,nextTimer=0;
const timers=new Map();
function el(selector){
  if(!elements.has(selector)){
    const classes=new Set();
    elements.set(selector,{
      innerHTML:'',textContent:'',value:'',onclick:null,
      classList:{
        contains:cl=>classes.has(cl),add:cl=>classes.add(cl),remove:cl=>classes.delete(cl),
        toggle:(cl,force)=>{const on=force===undefined?!classes.has(cl):Boolean(force);
          if(on)classes.add(cl);else classes.delete(cl);return on}
      },
      addEventListener(){},focus(){},blur(){}
    });
  }
  return elements.get(selector);
}
function setTimeoutFake(fn,ms){const id=++nextTimer;timers.set(id,{at:now+ms,fn});return id}
function clearTimeoutFake(id){timers.delete(id)}
async function advance(ms){
  now+=ms;
  for(let i=0;i<100;i++){
    const ready=[...timers].filter(([,v])=>v.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!ready)break;
    timers.delete(ready[0]);ready[1].fn();
  }
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
}
let readerOn=false;
const reader={setEnabled:v=>{readerOn=Boolean(v)},isEnabled:()=>readerOn,
  getPresentEpcs:()=>present,disable:()=>{readerOn=false}};
let present=[];
const state={cart:[],current:null,processing:false,kioskOn:false,tags:[],products:[]};
const backend={detect:epcs=>new Promise((resolve,reject)=>requests.push({epcs:[...epcs],resolve,reject})),
  newSessionId:()=>('TEST-'+requests.length),revokeScan:async()=>{},logSession:async()=>{}};
const context=vm.createContext({
  state,Backend:backend,RFIDScanner:reader,SS_KIOSK:'kiosk',TIMEOUT:300,
  $:el,$$:selector=>selector==='.screen'?screens.map(s=>el('#'+s)):[],
  window:{addEventListener:(type,cb)=>{listeners[type]=cb}},
  document:{addEventListener(){}},
  setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,
  setInterval:()=>0,clearInterval(){},
  stopCameraScanner(){},async startCameraScanner(){},
  closeModal(){},openModal(){},openAuth(){},
  toast:msg=>notifications.push(msg),pushActivity(){},esc:String,
  peso:n=>String(n),codeFor:n=>String(n),
  sessionStorage:{removeItem(){}},location:{href:''},Date
});
vm.runInContext(source,context);
state.kioskOn=true;vm.runInContext("screen('k-idle')",context);
assert.equal(readerOn,true);
function emit(epcs){
  present=[...epcs];
  listeners['rfid:tray']({detail:epcs});
}
function result(req){
  return {grouped_items:req.epcs.length?[{
    product_id:1,product_name:'Test product',unit_price:10,quantity:req.epcs.length,epcs:req.epcs
  }]:[],unknown_epcs:[],purchased_epcs:[],inactive_epcs:[]};
}
async function main(){
  const tags=Array.from({length:20},(_,i)=>'TESTEPC'+String(i+1).padStart(4,'0'));
  // Twenty rapid snapshots should use ONE backend call containing ALL 20 EPCs.
  for(let i=1;i<=20;i++)emit(tags.slice(0,i));
  await advance(180);
  assert.equal(requests.length,1,'Twenty rapid RFID arrivals must coalesce');
  assert.equal(requests[0].epcs.length,20);
  requests[0].resolve(result(requests[0]));await advance(0);
  assert.equal(state.cart[0].qty,20);
  // A single tag removal updates quantity but retains the remaining 19.
  emit(tags.slice(0,19));await advance(180);
  assert.equal(requests.length,2);
  requests[1].resolve(result(requests[1]));await advance(0);
  assert.equal(state.cart[0].qty,19);
  // Delay a database response while an even newer snapshot arrives.
  emit(tags.slice(0,18));await advance(180);
  assert.equal(requests.length,3);
  emit(tags.slice(0,17));await advance(180);
  assert.equal(requests.length,3,'Do not overlap PHP RFID lookups');
  requests[2].resolve(result(requests[2]));await advance(0);
  assert.equal(state.cart[0].qty,19,'Stale backend reply cannot overwrite cart');
  await advance(100);
  assert.equal(requests.length,4,'Newest 17-tag snapshot must be retried');
  assert.equal(requests[3].epcs.length,17);
  requests[3].resolve(result(requests[3]));await advance(0);
  assert.equal(state.cart[0].qty,17);
  // A short empty gap is not a physical removal signal.
  emit([]);await advance(500);
  assert.equal(state.cart[0].qty,17);
  emit(tags.slice(0,16));await advance(180);
  assert.equal(requests.length,5);
  requests[4].resolve(result(requests[4]));await advance(0);
  assert.equal(state.cart[0].qty,16);
  // Only a settled empty tray clears the kiosk.
  emit([]);await advance(1200);
  assert.equal(state.cart.length,0);
  assert.equal(el('#k-idle').classList.contains('on'),true);
  assert.equal(notifications.length,0);
  console.log('Kiosk 20-tag burst, serialized PHP reads, stale response, removal and empty tray passed');
}
main().catch(err=>{console.error(err);process.exitCode=1});
