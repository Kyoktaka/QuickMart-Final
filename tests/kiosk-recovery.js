// Browser-free lifecycle regression tests. Real PHP/MySQL behavior is tested separately.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/kiosk.js','utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const stored=new Map(),sessions=new Map();
let now=100000,nextId=0,saveFailure=false,closeFailure=false,confirmTerminal=false,saveTerminal=false;
const epc='E28012340000000000000001';
function cartFor(epcs){return epcs.length?[{id:1,name:'Alcohol Dispenser',price:30,qty:epcs.length,scanned:[...epcs]}]:[]}
function receipt(session){return {session_id:session.session_id,total_items:session.epcs.length,total_amount:session.epcs.length*30}}
function response(session){return {session:session?clone(session):null,...(session?.status==='SUCCESSFUL'?{purchase:receipt(session)}:{})}}
function notFound(){const error=new Error('Checkout not found');error.status=404;error.data={code:'CHECKOUT_NOT_FOUND'};return error}
function createFrame(){
  const elements=new Map(),listeners=new Map(),timers=new Map(),notifications=[],historyEntries=[];
  let nextTimer=0,enabled=false,blocked=false,present=[];
  function el(selector){
    if(!elements.has(selector)){
      const classes=new Set(),handlers={};
      elements.set(selector,{id:selector.slice(1),innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,style:{},handlers,
        classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),
          toggle(name,on){on=on===undefined?!classes.has(name):Boolean(on);if(on)classes.add(name);else classes.delete(name);return on}},
        addEventListener(type,fn){handlers[type]=fn},focus(){},blur(){}});
    }
    return elements.get(selector);
  }
  function listen(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)}
  const state={cart:[],current:null,processing:false,kioskOn:false,tags:[],products:[]};
  const backend={
    newSessionId:()=>`RECOVERY-${++nextId}`,
    async saveCheckout(id,epcs){
      if(saveFailure)throw new Error('Connection interrupted');
      let session=sessions.get(id);
      if(!session){session={session_id:id,status:'CART',epcs:[],cart:[],revision:0,failed_attempts:0,deadline_at:null};sessions.set(id,session)}
      if(saveTerminal){session.status='VOIDED';session.reason='payment_timeout'}
      if(!['SUCCESSFUL','VOIDED'].includes(session.status)){
        session.epcs=[...epcs];session.cart=cartFor(epcs);session.revision++;session.status='CART';
      }
      return response(session);
    },
    async reviewCheckout(id,epcs){
      const result=await this.saveCheckout(id,epcs);
      const session=sessions.get(id);if(session.status!=='VOIDED')session.status='REVIEWED';
      return response(session);
    },
    async confirmCheckout(id,revision){
      const session=sessions.get(id);assert.equal(revision,session.revision,'Confirm uses the server review revision');
      if(confirmTerminal){session.status='VOIDED';session.reason='payment_timeout'}
      else{session.status='PAYMENT';session.deadline_at??=now+300000}
      return response(session);
    },
    async checkoutStatus(id){
      if(id){if(!sessions.has(id))throw notFound();return response(sessions.get(id))}
      return response([...sessions.values()].find(s=>['CART','REVIEWED','PAYMENT'].includes(s.status))||null);
    },
    async closeCheckout(id){
      if(closeFailure)throw new Error('Server unavailable');
      const session=sessions.get(id);if(session.status!=='SUCCESSFUL')session.status='VOIDED';return response(session);
    },
    async revokeScan(){},
    async detect(epcs){return {grouped_items:epcs.length?[{product_id:1,product_name:'Alcohol Dispenser',unit_price:30,quantity:epcs.length,epcs}]:[]}}
  };
  const context=vm.createContext({state,Backend:backend,RFIDScanner:{
    setEnabled:value=>{enabled=Boolean(value)},isEnabled:()=>enabled,disable:()=>{enabled=false},
    setBlocked:value=>{blocked=Boolean(value)},isBlocked:()=>blocked,getPresentEpcs:()=>present},
    SS_KIOSK:'qm_kiosk',TIMEOUT:300,$:el,$$:()=>['k-idle','k-cart','k-qr','k-success','k-fail'].map(id=>el('#'+id)),
    window:{addEventListener:listen},document:{addEventListener(){}},history:{pushState:entry=>historyEntries.push(entry)},
    sessionStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
    location:{href:'http://localhost/manager/kiosk.html',replace(){}},Date:{now:()=>now},
    setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),
    setInterval:()=>++nextTimer,clearInterval(){},stopCameraScanner:async()=>{},startCameraScanner:async()=>{},resetQrFailureAttempts(){},
    openModal:id=>el('#'+id).classList.add('on'),closeModal:id=>el('#'+id).classList.remove('on'),openAuth(){},
    toast:message=>notifications.push(message),pushActivity(){},esc:String,peso:String,codeFor:String});
  vm.runInContext(source,context);state.kioskOn=true;
  const run=code=>vm.runInContext(code,context);
  async function flush(){for(let i=0;i<40;i++)await Promise.resolve()}
  return {state,backend,el,run,flush,notifications,historyEntries,
    isOn:id=>el('#'+id).classList.contains('on'),blocked:()=>blocked,enabled:()=>enabled,
    async recover(){await run('recoverCheckout()');await flush()},
    async seed(id){const result=await backend.saveCheckout(id,[epc]);context.__session=result.session;run("applyCheckout(__session);renderCart();screen('k-cart')");await flush()},
    async click(selector){await el(selector).onclick();await flush()},
    emit(type,event={}){for(const listener of listeners.get(type)||[])listener(event)}};
}
async function main(){
  let frame=createFrame();await frame.recover();
  assert(frame.isOn('k-idle'));assert(frame.enabled(),'Fresh authorized kiosk enables the scanner');
  await frame.seed('RECOVERY-FIRST');
  const saved=JSON.parse(stored.get('qm_checkout'));
  assert.deepEqual(saved.epcs,[epc]);assert.equal('cart' in saved,false);assert.equal('price' in saved,false);
  frame=createFrame();await frame.recover();
  assert(frame.isOn('k-cart'));assert.equal(frame.state.cart[0].price,30);assert.equal(frame.state.cart[0].qty,1);
  assert.match(frame.el('#cart-body').innerHTML,/Currently Not Detected/,'Recovered item remains despite an empty reader');
  await frame.click('#btn-checkout');assert(frame.blocked());assert(frame.isOn('m-confirm'));
  await frame.click('#confirm-ok');assert(frame.isOn('k-qr'));assert(!frame.enabled());
  const originalDeadline=sessions.get('RECOVERY-FIRST').deadline_at;
  sessions.get('RECOVERY-FIRST').failed_attempts=2;
  now+=47000;frame=createFrame();await frame.recover();
  assert(frame.isOn('k-qr'));assert.equal(frame.state.checkout.failed_attempts,2);
  assert.equal(frame.state.checkout.deadline_at,originalDeadline);assert.equal(frame.run('left'),253,'Refresh cannot restart the payment deadline');
  const before=frame.historyEntries.length;frame.emit('popstate');
  assert.equal(frame.historyEntries.length,before+1);assert(frame.isOn('k-qr'),'Browser Back cannot skip the active payment');
  let warned=false;frame.emit('beforeunload',{preventDefault(){warned=true}});assert(warned);
  frame.run("screen('k-fail')");const existingId=frame.state.current;
  await frame.click('#btn-retry');assert.equal(frame.state.current,existingId,'Retry cannot replace a still-active payment');assert(frame.isOn('k-qr'));
  sessions.get(existingId).status='SUCCESSFUL';frame=createFrame();await frame.recover();
  assert(frame.isOn('k-success'));assert.equal(frame.state.cart.length,0);assert.equal(stored.has('qm_checkout'),false);
  frame=createFrame();await frame.recover();assert(frame.isOn('k-idle'),'A new unhinted visit does not replay an old receipt');

  stored.set('qm_checkout',JSON.stringify({id:'FIRST-SAVE-INTERRUPTED',epcs:[epc],removed:[]}));
  frame=createFrame();await frame.recover();
  assert(frame.isOn('k-cart'));assert(sessions.has('FIRST-SAVE-INTERRUPTED'),'Interrupted first save is validated again by PHP');
  closeFailure=true;await frame.click('#btn-cancel');
  assert.equal(frame.state.cart.length,1);assert(stored.has('qm_checkout'),'Failed cancellation preserves recovery');closeFailure=false;
  sessions.get(frame.state.current).status='VOIDED';sessions.get(frame.state.current).reason='three_failed_attempts';
  frame=createFrame();await frame.recover();assert(frame.isOn('k-fail'));
  await frame.click('#btn-retry');assert(frame.isOn('m-confirm'));assert(!frame.isOn('k-qr'),'New order requires customer review again');
  confirmTerminal=true;await frame.click('#confirm-ok');
  assert(frame.isOn('k-fail'));assert(!frame.isOn('k-qr'),'Expiry while confirming never starts a payment');confirmTerminal=false;
  await frame.click('#btn-retry');frame.run("closeHold('m-confirm');screen('k-cart')");
  saveTerminal=true;await frame.run('saveCart()');await frame.flush();
  assert(frame.isOn('k-fail'),'An expired queued save moves to the terminal screen');saveTerminal=false;
  saveFailure=true;const failedId=frame.state.current;await assert.rejects(frame.run('saveCart()'),/Connection interrupted/);
  assert.equal(frame.state.current,failedId);assert(stored.has('qm_checkout'));saveFailure=false;
  console.log('Kiosk refresh, server deadline/attempt recovery, navigation, terminal races and interrupted-save checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});
