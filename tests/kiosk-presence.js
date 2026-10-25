// Browser-free regression test for the kiosk cart:
//  * bursty 20-tag scans are coalesced into ONE serialized PHP lookup
//  * a scanned item is LATCHED: it stays in the cart when the reader stops seeing it
//  * the customer can remove items (whole line or part of a line); removed tags that
//    are still on the reader are not re-added until they have really left it
//  * "Check your cart" popup comes before the QR screen; popups block the reader
//  * scanner-speed typing into the Input Tag field is discarded, human typing is kept
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/kiosk.js','utf8');
const elements=new Map(),listeners={},requests=[],notifications=[];
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
let readerOn=false,readerBlocked=false,present=[],rawConnected=false;
const reader={setEnabled:v=>{readerOn=Boolean(v)},isEnabled:()=>readerOn,
  setBlocked:v=>{readerBlocked=Boolean(v)},isBlocked:()=>readerBlocked,
  getPresentEpcs:()=>present,disable:()=>{readerOn=false},getBridgeHealth:()=>({connected:rawConnected})};
const state={cart:[],current:null,processing:false,kioskOn:false,tags:[],products:[]};
const backend={detect:epcs=>new Promise((resolve,reject)=>requests.push({epcs:[...epcs],resolve,reject})),
  newSessionId:()=>('TEST-'+requests.length),revokeScan:async()=>{},logSession:async()=>{},
  saveCheckout:async id=>checkoutResult(id,'CART'),reviewCheckout:async id=>checkoutResult(id,'REVIEWED'),
  confirmCheckout:async id=>checkoutResult(id,'PAYMENT'),closeCheckout:async id=>checkoutResult(id,'VOIDED')};
function checkoutResult(id,status){return {session:{session_id:id,status,revision:1,
  cart:state.cart.map(item=>({...item,scanned:[...item.scanned]})),deadline_at:now+300000}}}
let qrStarted=0;
const context=vm.createContext({
  state,Backend:backend,RFIDScanner:reader,SS_KIOSK:'kiosk',TIMEOUT:300,
  $:el,$$:selector=>selector==='.screen'?screens.map(s=>el('#'+s)):[],
  window:{addEventListener:(type,cb)=>{listeners[type]=cb}},
  document:{addEventListener(){}},
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
assert.equal(readerOn,true);
const isOn=id=>el('#'+id).classList.contains('on');
function emit(epcs){present=[...epcs];listeners['rfid:tray']({detail:epcs})}
// A-tags belong to product 1, B-tags to product 2.
function result(req){
  const groups=new Map();
  for(const epc of req.epcs){
    const id=epc.startsWith('B')?2:1;
    if(!groups.has(id))groups.set(id,{product_id:id,product_name:'Product '+id,unit_price:10*id,quantity:0,epcs:[]});
    const g=groups.get(id);g.quantity++;g.epcs.push(epc);
  }
  return {grouped_items:[...groups.values()],unknown_epcs:[],purchased_epcs:[],inactive_epcs:[]};
}
async function settle(req){req.resolve(result(req));await advance(0)}
const qtyOf=id=>state.cart.find(i=>i.id===id)?.qty??0;
function click(sel){el(sel).onclick&&el(sel).onclick()}

async function main(){
  const tags=Array.from({length:20},(_,i)=>'AEPC'+String(i+1).padStart(4,'0'));
  // ---- 20 rapid arrivals use ONE backend call containing ALL 20 EPCs ----
  for(let i=1;i<=20;i++)emit(tags.slice(0,i));
  await advance(180);
  assert.equal(requests.length,1,'Twenty rapid RFID arrivals must coalesce');
  assert.equal(requests[0].epcs.length,20);
  await settle(requests[0]);
  assert.equal(qtyOf(1),20);assert.equal(isOn('k-cart'),true);

  // ---- LATCH: the reader loses tags (unstable scanner) but nothing leaves the cart ----
  emit(tags.slice(0,19));await advance(500);
  assert.equal(qtyOf(1),20,'A tag the reader stopped seeing must stay in the cart');
  emit([]);await advance(5000);
  assert.equal(qtyOf(1),20,'An empty reader must not clear the cart');
  assert.equal(isOn('k-cart'),true,'Cart screen must not fall back to the welcome screen');
  assert.equal(requests.length,1,'Losing tags must not trigger lookups');
  // a flickering tag coming back is not duplicated
  emit([tags[3]]);await advance(500);
  assert.equal(requests.length,1);assert.equal(qtyOf(1),20);

  // ---- a NEW tag joins; the lookup carries every latched EPC ----
  emit(['BEPC0001']);await advance(180);
  assert.equal(requests.length,2);
  assert.equal(requests[1].epcs.length,21,'Lookup must include the latched tags too');
  await settle(requests[1]);
  assert.equal(qtyOf(1),20);assert.equal(qtyOf(2),1);

  // ---- never overlap PHP lookups; stale reply is discarded; newest is retried ----
  emit(['BEPC0002']);await advance(180);
  assert.equal(requests.length,3);
  emit(['BEPC0003']);await advance(180);
  assert.equal(requests.length,3,'Do not overlap PHP RFID lookups');
  requests[2].resolve(result(requests[2]));await advance(0);
  assert.equal(qtyOf(2),1,'Stale backend reply cannot overwrite the cart');
  await advance(100);
  assert.equal(requests.length,4,'Newest snapshot must be retried');
  assert.equal(requests[3].epcs.length,23);
  await settle(requests[3]);
  assert.equal(qtyOf(2),3);

  // ---- backend failure keeps the cart and retries ----
  emit(['BEPC0004']);await advance(180);
  requests[4].reject(new Error('db down'));await advance(0);
  assert.equal(state.cart.length,2,'A failed lookup must not clear the cart');
  await advance(2500);await advance(180);
  assert.equal(requests.length,6,'A failed lookup is retried automatically');
  await settle(requests[5]);
  assert.equal(qtyOf(2),4);

  // ---- REMOVE: part of a line ----
  const before=requests.length;
  assert.equal(run("removeFromCart(2,3)"),true);
  assert.equal(qtyOf(2),1,'Removing 3 of 4 leaves 1');
  assert.equal(notifications.at(-1).startsWith('Removed 3 × Product 2'),true);
  await advance(180);
  assert.equal(requests.length,before+1,'Remaining cart is re-verified');
  assert.equal(requests.at(-1).epcs.includes('BEPC0004'),false,'Removed EPC must not be sent');
  assert.equal(requests.at(-1).epcs.includes('BEPC0003'),false);
  assert.equal(requests.at(-1).epcs.includes('BEPC0002'),false);
  assert.equal(requests.at(-1).epcs.includes('BEPC0001'),true);
  await settle(requests.at(-1));
  assert.equal(qtyOf(2),1);

  // removed tags still lying on the reader must NOT come back
  const n=requests.length;
  emit(['BEPC0004','BEPC0003','BEPC0002','BEPC0001']);await advance(500);
  assert.equal(requests.length,n,'Removed tags that are still being read are ignored');
  assert.equal(qtyOf(2),1);

  // ... until the reader reports genuine absence. No extra fixed release delay follows it.
  present=[];run('releaseRemoved()');
  assert.equal(run("removedEpcs.has('BEPC0004')"),true,'A cleared snapshot alone cannot prove physical absence');
  listeners['rfid:absent']({detail:{epc:'BEPC0004'}});
  assert.equal(run("removedEpcs.has('BEPC0004')"),false,'Absence immediately re-arms the removed EPC');
  emit(['BEPC0004']);await advance(180);
  assert.equal(requests.length,n+1,'A released tag can be scanned again');
  await settle(requests.at(-1));
  assert.equal(qtyOf(2),2);

  // ---- REMOVE: whole product line, then everything -> welcome screen ----
  run("removeFromCart(1,999)");
  assert.equal(qtyOf(1),0,'Removing more than the quantity removes the line');
  assert.equal(state.cart.length,1);
  await advance(180);await settle(requests.at(-1));
  run("removeFromCart(2,2)");
  assert.equal(state.cart.length,0);
  assert.equal(isOn('k-idle'),true,'Empty cart returns to the welcome screen');
  assert.ok(state.current,'An empty recoverable cart retains its backend checkout identity');

  // ---- Remove button -> popup -> stepper -> confirm ----
  emit(['AREM0001','AREM0002','AREM0003']);await advance(180);await settle(requests.at(-1));
  assert.equal(qtyOf(1),3);
  assert.match(el('#cart-body').innerHTML,/data-remove="1"/);
  el('#cart-body').handlers.click({target:{closest:()=>({dataset:{remove:'1'}})}});
  assert.equal(isOn('m-remove'),true);assert.equal(readerBlocked,true,'Reader blocked in the remove popup');
  assert.equal(el('#rm-count').textContent,3);
  click('#rm-minus');click('#rm-minus');click('#rm-minus');
  assert.equal(el('#rm-count').textContent,1,'Stepper cannot go below 1');
  click('#rm-plus');assert.equal(el('#rm-count').textContent,2);
  click('#rm-confirm');
  assert.equal(isOn('m-remove'),false);assert.equal(readerBlocked,false);
  assert.equal(qtyOf(1),1);
  await advance(180);await settle(requests.at(-1));

  // ---- "Check your cart" comes BEFORE the QR screen ----
  click('#btn-checkout');await advance(0);
  assert.equal(isOn('m-confirm'),true);assert.equal(isOn('k-qr'),false,'No QR screen before confirming');
  assert.equal(readerBlocked,true,'Reader blocked while checking the cart');
  assert.match(el('#confirm-body').innerHTML,/Product 1/);
  assert.equal(el('#confirm-items').textContent,1);
  click('#confirm-back');
  assert.equal(isOn('m-confirm'),false);assert.equal(isOn('k-cart'),true);assert.equal(readerBlocked,false);
  assert.equal(qrStarted,0);
  click('#btn-checkout');await advance(0);click('#confirm-ok');await advance(0);
  assert.equal(isOn('m-confirm'),false);assert.equal(isOn('k-qr'),true,'Confirm Checkout opens the QR screen');
  assert.equal(qrStarted,1);
  click('#btn-qr-back');assert.equal(isOn('k-cart'),true);assert.equal(qtyOf(1),1);

  // ---- Cancel Order clears the cart and keeps its tags out while they stay on the reader ----
  emit(['ACAN0001']);await advance(180);await settle(requests.at(-1));
  assert.equal(qtyOf(1),2,'earlier item + the new tag');
  const m=requests.length;
  await run("cancelOrder()");
  assert.equal(isOn('k-idle'),true);assert.equal(state.cart.length,0);
  click('#btn-checkout');assert.equal(isOn('m-confirm'),false,'An empty cart cannot be checked out');
  emit(['ACAN0001']);await advance(500);
  assert.equal(requests.length,m,'A cancelled tag still on the reader must not reappear');

  // ---- Input Tag popup: reader blocked, scanner-speed typing discarded ----
  click('#btn-idle-tag');
  assert.equal(isOn('m-tag'),true);assert.equal(readerBlocked,true,'Reader blocked while typing an EPC');
  const field=el('#tag-modal-input'),keydown=field.handlers.keydown;
  function press(key,gapMs,properties={}){
    now+=gapMs;
    const ev={key,ctrlKey:false,metaKey:false,altKey:false,repeat:false,defaultPrevented:false,...properties,
      preventDefault(){this.defaultPrevented=true}};
    keydown(ev);
    if(!ev.defaultPrevented&&key.length===1)field.value+=key;   // what the browser would do
    return ev;
  }
  field.value='';notifications.length=0;
  const actualEpc='E28011700000021905AC150B';
  [...actualEpc].forEach((c,i)=>press(c,i?4:300));   // reader: ~4 ms between characters
  const enterEv=press('Enter',4);
  assert.equal(field.value,'','Scanner-speed characters must not stay in the field');
  assert.equal(enterEv.defaultPrevented,true,"Scanner's closing Enter must not submit");
  assert.equal(field.value,'','Rejected scanner input is silently removed from the manual field');
  const calls=requests.length;await advance(300);
  assert.equal(requests.length,calls,'Scanner burst must not be looked up');
  await advance(500);field.value='';
  for(const c of actualEpc){
    if(/[A-F]/.test(c))press('Shift',2);
    press(c,4);
  }
  press('Enter',4);
  assert.equal(field.value,'','Standalone Input Tag fallback must keep uppercase Shift transitions inside the rejected reader frame');
  assert.equal(requests.length,calls,'Reader Shift transitions cannot cause a manual lookup');
  await advance(500);field.value='';
  for(const [index,c] of [...actualEpc].entries()){
    if(index===5)press('CapsLock',2);
    const letter=/[A-F]/.test(c),key=letter?c.toLowerCase():')!@#$%^&*('[Number(c)];
    press(key,4,{code:letter?'Key'+c:'Digit'+c,shiftKey:true});
  }
  press('Enter',4);await advance(0);
  assert.equal(field.value,'','Standalone Input Tag fallback rejects CapsLock letters and Shift-modified digits');
  assert.equal(requests.length,calls,'Modifier-distorted reader output cannot trigger a manual lookup');
  // a person typing at a normal pace is untouched, including a fast typist (~90 ms/char)
  await advance(600);
  field.value='';
  for(const c of 'AEPC1234')press(c,c==='A'?300:90);
  assert.equal(field.value,'AEPC1234');
  field.value='';await advance(300);
  const fastHuman=[...'James2026'].map((c,i)=>press(c,i?7:300));
  assert.equal(field.value,'James2026','Three fast ordinary keys must never erase manual input');
  assert(fastHuman.every(e=>!e.defaultPrevented),'Ordinary fast typing is passed through immediately');
  // person typing after a scanner burst still works
  field.value='';
  [...actualEpc].forEach((c,i)=>press(c,i?3:300));
  await advance(500);field.value='';
  for(const c of 'ABCD')press(c,c==='A'?300:120);
  assert.equal(field.value,'ABCD');
  // text typed BEFORE a scanner burst is preserved
  field.value='';
  for(const c of 'ZZ')press(c,150);
  [...actualEpc].forEach((c,i)=>press(c,i===0?300:3));   // reader starts after the person paused
  assert.equal(field.value,'ZZ','Only the scanner characters are rolled back');
  await advance(500);
  // Closing a popup while manual validation is pending must discard its late
  // result; a repeated Enter must not issue duplicate backend lookups.
  field.value='ASTALE000001';
  const beforeManual=requests.length;
  press('Enter',100);press('Enter',100);await advance(0);
  assert.equal(requests.length,beforeManual+1,'Only one manual lookup may be in flight');
  const stale=requests.at(-1);
  el('#m-tag').handlers.click({target:{id:'m-tag'}});
  await settle(stale);await advance(200);
  assert.equal(state.cart.length,0,'Closed-popup validation must not populate a new checkout');
  assert.equal(run("latchedEpcs.has('ASTALE000001')"),false,'Closed popup cannot latch its stale EPC');
  click('#btn-idle-tag');await advance(100);
  // manual entry submits with Enter and joins the cart
  field.value='';
  for(const c of 'ATYPED000001')press(c,c==='A'?300:100);
  press('Enter',100);await advance(0);
  assert.equal(requests.at(-1).epcs.join(),'ATYPED000001');
  await settle(requests.at(-1));              // verify call for the typed EPC
  await advance(180);await settle(requests.at(-1));
  assert.equal(isOn('m-tag'),false);assert.equal(readerBlocked,false);
  assert.equal(qtyOf(1),1,'Manually entered tag joins the cart');
  // With independently verified raw USB, even fast hexadecimal physical-keyboard
  // input remains intact and Enter still submits it for authoritative validation.
  click('#btn-input-tag-toggle');rawConnected=true;field.value='';
  const rawHuman=[...actualEpc].map((c,i)=>press(c,i?7:300));
  assert(rawHuman.every(e=>!e.defaultPrevented));assert.equal(field.value,actualEpc);
  assert.equal(press('Enter',7).defaultPrevented,true,'Raw mode keeps manual Enter submission');
  await advance(0);assert.equal(requests.at(-1).epcs.join(),actualEpc);
  await settle(requests.at(-1));await advance(180);await settle(requests.at(-1));
  assert.equal(qtyOf(1),2,'Fast raw-mode manual EPC is validated and joins the existing cart');
  rawConnected=false;
  // Escape closes the popup and releases the reader
  click('#btn-input-tag-toggle');assert.equal(readerBlocked,true);
  assert.equal(typeof el('#m-tag').handlers.click,'function');
  el('#m-tag').handlers.click({target:{id:'m-tag'}});
  assert.equal(isOn('m-tag'),false);assert.equal(readerBlocked,false);
  console.log('Kiosk burst coalescing, latched cart, remove, check-your-cart popup, reader block and typing filter passed');
}
main().catch(err=>{console.error(err);process.exitCode=1});
