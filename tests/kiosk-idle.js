// Browser-free regression test: the shopping cart returns to the scanning screen after 2 idle minutes.
// (harness copied from kiosk-presence.js)
// Original header:
//  * bursty 20-tag scans are coalesced into ONE serialized PHP lookup
//  * a scanned item is LATCHED: it stays in the cart when the reader stops seeing it
//  * the customer can remove items (whole line or part of a line); removed tags that
//    are still on the reader are not re-added until they have really left it
//  * "Check your cart" popup comes before the QR screen; popups block the reader
//  * scanner-speed typing into the Input Tag field is discarded, human typing is kept
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/kiosk.js','utf8');
const docListeners={},logged=[],elements=new Map(),listeners={},requests=[],notifications=[];
const screens=['k-idle','k-cart','k-qr','k-success','k-fail'];
let now=0,nextTimer=0;
const timers=new Map();
function el(selector){
  if(!elements.has(selector)){
    const classes=new Set(),handlers={};
    elements.set(selector,{
      id:selector.startsWith('#')?selector.slice(1):'',
      innerHTML:'',textContent:'',value:'',onclick:null,hidden:false,disabled:false,handlers,
      classList:{
        contains:cl=>classes.has(cl),add:cl=>classes.add(cl),remove:cl=>classes.delete(cl),
        toggle:(cl,force)=>{const on=force===undefined?!classes.has(cl):Boolean(force);
          if(on)classes.add(cl);else classes.delete(cl);return on}
      },
      addEventListener(type,fn){handlers[type]=fn},focus(){},blur(){}
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
  for(let i=0;i<24;i++)await Promise.resolve();
}
let readerOn=false,readerBlocked=false,present=[];
const reader={setEnabled:v=>{readerOn=Boolean(v)},isEnabled:()=>readerOn,
  setBlocked:v=>{readerBlocked=Boolean(v)},isBlocked:()=>readerBlocked,
  getPresentEpcs:()=>present,disable:()=>{readerOn=false}};
const state={cart:[],current:null,processing:false,kioskOn:false,tags:[],products:[]};
const backend={detect:epcs=>new Promise((resolve,reject)=>requests.push({epcs:[...epcs],resolve,reject})),
  newSessionId:()=>('TEST-'+requests.length),revokeScan:async()=>{},logSession:async s=>{logged.push(s)},
  saveCheckout:async id=>checkoutResult(id,'CART'),
  closeCheckout:async id=>{logged.push({id,status:'cancelled'});return checkoutResult(id,'VOIDED')}};
function checkoutResult(id,status){return {session:{session_id:id,status,revision:1,
  cart:state.cart.map(item=>({...item,scanned:[...item.scanned]})),deadline_at:now+300000}}}
let qrStarted=0;
const context=vm.createContext({
  state,Backend:backend,RFIDScanner:reader,SS_KIOSK:'kiosk',TIMEOUT:300,
  $:el,$$:selector=>selector==='.screen'?screens.map(s=>el('#'+s)):[],
  window:{addEventListener:(type,cb)=>{listeners[type]=cb}},
  document:{addEventListener(t,fn){(docListeners[t]=docListeners[t]||[]).push(fn)}},
  setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,
  setInterval:()=>0,clearInterval(){},
  stopCameraScanner(){},async startCameraScanner(){qrStarted++},resetQrFailureAttempts(){},
  closeModal:id=>el('#'+id).classList.remove('on'),openModal:id=>el('#'+id).classList.add('on'),openAuth(){},
  toast:msg=>notifications.push(msg),pushActivity(){},esc:String,
  peso:n=>String(n),codeFor:n=>String(n),
  sessionStorage:{removeItem(){},setItem(){},getItem(){return null}},location:{href:''},Date:{now:()=>now}
});
vm.runInContext(source,context);
const run=code=>vm.runInContext(code,context);
state.kioskOn=true;run("screen('k-idle')");
const isOn=id=>el('#'+id).classList.contains('on');
function emit(epcs){present=[...epcs];listeners['rfid:tray']({detail:epcs})}
function result(req){
  return {grouped_items:[{product_id:1,product_name:'Product 1',unit_price:10,quantity:req.epcs.length,epcs:[...req.epcs]}],
    unknown_epcs:[],purchased_epcs:[],inactive_epcs:[]};
}
async function settle(req){req.resolve(result(req));await advance(0)}
function activity(type){for(const fn of docListeners[type]||[])fn({})}
const SEC=1000;
async function addTag(epc){emit([...present,epc]);await advance(180);await settle(requests.at(-1))}

async function main(){
  for(const t of ['pointerdown','mousemove','keydown','touchstart','wheel','scroll'])
    assert.ok((docListeners[t]||[]).length>0,'activity listener for '+t);

  // ---- 1. nothing happens for 2 minutes -> back to the scanning (welcome) screen ----
  await addTag('AEPC0001');
  assert.equal(isOn('k-cart'),true);
  await advance(119*SEC);
  assert.equal(isOn('k-cart'),true,'Cart must stay for the full 2 minutes');
  await advance(2*SEC);
  assert.equal(isOn('k-idle'),true,'After 2 idle minutes the scanning screen returns');
  assert.equal(state.cart.length,0);assert.equal(state.current,null);
  assert.equal(logged.length,1);assert.equal(logged[0].status,'cancelled','Timed-out cart is logged as cancelled');
  assert.equal(notifications.at(-1),'Session timed out due to inactivity.');
  // the item is still lying on the reader: it must NOT jump straight back into the cart
  const calls=requests.length;
  emit(['AEPC0001']);await advance(500);
  assert.equal(requests.length,calls,'Held tag is not re-added right after a timeout');
  assert.equal(isOn('k-idle'),true);

  // ---- 2. any action restarts the 2 minutes ----
  await advance(10*SEC);emit([]);await advance(9*SEC);          // item taken away, release delay passes
  await addTag('AEPC0002');
  await advance(100*SEC);activity('pointerdown');
  await advance(100*SEC);
  assert.equal(isOn('k-cart'),true,'A tap restarts the countdown');
  await advance(15*SEC);activity('keydown');
  await advance(100*SEC);activity('touchstart');
  await advance(100*SEC);activity('scroll');
  await advance(100*SEC);
  assert.equal(isOn('k-cart'),true,'Repeated activity keeps the cart open');
  await advance(21*SEC);
  assert.equal(isOn('k-idle'),true,'...and 2 quiet minutes after the last action it resets');
  assert.equal(logged.length,2);

  // ---- 3. scanning another product counts as activity ----
  await advance(20*SEC);emit([]);await advance(9*SEC);
  await addTag('AEPC0003');
  await advance(100*SEC);
  await addTag('AEPC0004');
  await advance(100*SEC);
  assert.equal(isOn('k-cart'),true,'A newly scanned tag restarts the countdown');
  await advance(21*SEC);
  assert.equal(isOn('k-idle'),true);
  assert.equal(logged.length,3);
  emit([]);await advance(9*SEC);

  // ---- 4. the payment (QR) screen is not affected ----
  await addTag('AEPC0005');
  run("screen('k-qr')");
  await advance(600*SEC);
  assert.equal(isOn('k-qr'),true,'The idle timer only runs on the cart screen');
  run("screen('k-cart')");
  await advance(121*SEC);
  assert.equal(isOn('k-idle'),true,'Coming back to the cart starts a fresh 2 minutes');
  emit([]);await advance(9*SEC);

  // ---- 5. never reset underneath the manager password popup ----
  await addTag('AEPC0006');
  el('#m-auth').classList.add('on');
  await advance(121*SEC);
  assert.equal(isOn('k-cart'),true,'Cart is kept while the manager password popup is open');
  el('#m-auth').classList.remove('on');
  await advance(121*SEC);
  assert.equal(isOn('k-idle'),true);

  console.log('Kiosk 2-minute cart inactivity reset passed');
}
main().catch(e=>{console.error(e);process.exit(1)});
