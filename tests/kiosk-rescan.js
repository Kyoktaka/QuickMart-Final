// Exercise the actual scanner cadence estimator and cart suppression together.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const EPC='E28011700000021905AC150B',OTHER='E28011700000021905AC150C';
let checks=0;
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++}
const html=fs.readFileSync('manager/kiosk.html','utf8');
check(/btn-rescan|Rescan products/i.test(html),false,'Rescanning requires no button on either screen');
function setup(options={}){
  let now=options.now??0,nextTimer=0,nextSession=0;
  const stored=options.stored||new Map();
  const timers=new Map(),listeners=new Map(),keys=[],elements=new Map(),lookups=[],reads=[];
  const statuses=new Map([[EPC,'AVAILABLE'],[OTHER,'AVAILABLE']]);
  function el(selector){
    if(!elements.has(selector)){
      const classes=new Set(),handlers={};
      elements.set(selector,{id:selector.slice(1),value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,
        classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),
          toggle(name,force){const on=force===undefined?!classes.has(name):force;if(on)classes.add(name);else classes.delete(name)}},
        addEventListener:(name,fn)=>{handlers[name]=fn},handlers,focus(){},blur(){}});
    }
    return elements.get(selector);
  }
  const state={cart:[],current:null,processing:false,kioskOn:false,tags:[],products:[]};
  const result=(id,status)=>({session:{session_id:id,status,revision:1,
    cart:state.cart.map(item=>({...item,scanned:[...item.scanned]}))}});
  const backend={newSessionId:()=>String(++nextSession),
    async detect(epcs){
      lookups.push([...epcs]);const available=epcs.filter(epc=>statuses.get(epc)==='AVAILABLE');
      return {grouped_items:available.length?[{product_id:1,product_name:'Product',unit_price:100,quantity:available.length,epcs:available}]:[],
        purchased_epcs:epcs.filter(epc=>statuses.get(epc)==='PURCHASED'),
        unknown_epcs:epcs.filter(epc=>!statuses.has(epc)),inactive_epcs:epcs.filter(epc=>statuses.get(epc)==='INACTIVE')};
    },
    saveCheckout:async id=>result(id,'CART'),closeCheckout:async id=>result(id,'VOIDED'),
    revokeScan:async()=>{},checkoutStatus:async id=>id?result(id,'CART'):{session:null}};
  const schedule=(fn,ms,repeat=false)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms,ms,repeat});return id};
  const sandbox={state,Backend:backend,SS_KIOSK:'kiosk',TIMEOUT:300,$:el,
    $$:()=>['k-idle','k-cart','k-qr','k-success','k-fail'].map(id=>el('#'+id)),
    document:{activeElement:{tagName:'BODY'},addEventListener(name,fn){if(name==='keydown')keys.push(fn)}},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},
    dispatchEvent(event){if(event.type==='rfid:read')reads.push(event.detail);for(const fn of listeners.get(event.type)||[])fn(event)},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
    performance:{now:()=>now},Date:{now:()=>now},
    setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),
    openModal:id=>el('#'+id).classList.add('on'),closeModal:id=>el('#'+id).classList.remove('on'),
    stopCameraScanner(){},async startCameraScanner(){},resetQrFailureAttempts(){},openAuth(){},
    sessionStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},location:{href:''},
    toast(){},pushActivity(){},esc:String,peso:String,codeFor:String};
  sandbox.window=sandbox;vm.createContext(sandbox);
  for(const path of ['assets/js/rfid-scanner.js','js/kiosk.js'])vm.runInContext(fs.readFileSync(path,'utf8'),sandbox);
  const run=source=>vm.runInContext(source,sandbox),scanner=sandbox.RFIDScanner;
  state.kioskOn=true;run("screen('k-idle')");
  async function settle(){for(let index=0;index<24;index++)await Promise.resolve()}
  async function advance(ms){
    const target=now+ms;
    for(let count=0;count<2000;count++){
      const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      now=due[1].at;timers.delete(due[0]);
      if(due[1].repeat)timers.set(due[0],{...due[1],at:now+due[1].ms});
      due[1].fn();await settle();
      if(count===1999)throw Error('Timer did not settle');
    }
    now=target;await settle();
  }
  async function readAt(at,epc=EPC){
    assert(at-epc.length*8>=now,'Test reads must advance monotonically');
    await advance(at-epc.length*8-now);
    for(const key of epc){
      for(const fn of keys)fn({key,ctrlKey:false,metaKey:false,altKey:false,preventDefault(){},stopPropagation(){}});
      await advance(8);
    }
    for(const fn of keys)fn({key:'Enter',preventDefault(){},stopPropagation(){}});
    await settle();
  }
  return {state,scanner,run,el,advance,readAt,lookups,reads,statuses,backend,stored,time:()=>now,
    suppressed:epc=>run('removedEpcs.has('+JSON.stringify(epc||EPC)+')'),
    async warmup(interval=900){for(const at of [900,900+interval,900+interval*2])await readAt(at);await advance(180)},
    async remove(){run('removeFromCart(1,1)');await advance(0)},
    async click(id){await el('#'+id).onclick();await settle()}};
}
async function main(){
  {
    const h=setup();await h.readAt(1000);await h.advance(180);await h.remove();await h.readAt(1000);
    check(h.suppressed(),true,'An unmeasured first inventory repeat cannot prove removal');
  }
  {
    const h=setup();await h.warmup();await h.remove();
    await h.readAt(5000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'First returning read after a two-second gap restores the item');
    check(h.suppressed(),false,'Last-read baseline survives removal');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();
    await h.readAt(11000);await h.advance(180);
    check(h.reads.at(-1).previousCycleMs,1000,'Returning read carries the pre-gap inventory cycle');
    check(h.scanner.getReadHealth().estimatedInventoryCycleMs,3400,'Actual estimator includes the new gap after its snapshot');
    check(h.state.cart[0]?.qty,1,'A four-second return no longer inflates its own release threshold');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();
    for(const at of [10000,13000,16000])await h.readAt(at);
    check(h.suppressed(),true,'Normal slow inventory rounds cannot re-add a removed tag');
    check(h.state.cart.length,0,'Removed product stays out while continuously read');
  }
  {
    const h=setup();await h.warmup();await h.readAt(3500,OTHER);await h.advance(180);await h.remove();
    check(h.state.cart[0]?.qty,1,'Partial removal retains the other physical item');
    await h.readAt(5500,OTHER);await h.advance(180);
    check(h.state.cart[0]?.qty,2,'A physical read gap restores the removed unit automatically');
  }
  for(const button of ['btn-cancel','btn-cancel2','btn-cancel-scan']){
    const h=setup();await h.warmup();const previousId=h.state.current;
    if(button==='btn-cancel-scan')h.run("screen('k-qr')");
    if(button==='btn-cancel2')h.run("screen('k-fail')");
    await h.click(button);const cancelledAt=h.time(),calls=h.lookups.length;
    check(h.state.cart.length,0,button+': cancellation clears the cart');
    await h.readAt(cancelledAt+1000);
    await h.readAt(cancelledAt+2000);
    await h.readAt(cancelledAt+2999);
    check(h.state.cart.length,0,button+': reads before three seconds do not rebuild the cart');
    check(h.lookups.length,calls,button+': suppressed reads do not reach the API');
    await h.readAt(cancelledAt+3500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,button+': a fresh read between three and four seconds restores automatically');
    check(h.state.current!==previousId,true,button+': restored product starts a new checkout');
    await h.readAt(cancelledAt+4500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,button+': continued reads cannot duplicate the EPC');
  }
  {
    const h=setup();await h.readAt(1000);await h.advance(180);await h.click('btn-cancel');
    await h.readAt(h.time()+3000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Exact three-second boundary works without any measured inventory cadence');
  }
  {
    const h=setup();await h.warmup();await h.click('btn-cancel');const cancelledAt=h.time();
    await h.advance(3100);
    check(h.state.cart.length,0,'Expired cooldown does not restore a stale presence snapshot');
    await h.readAt(cancelledAt+4000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'A fresh read at four seconds restores the cancelled product');
  }
  {
    const h=setup();await h.warmup();await h.advance(4200);await h.click('btn-cancel');const cancelledAt=h.time();
    await h.readAt(cancelledAt+1000);await h.advance(180);
    check(h.state.cart.length,0,'An early presence-expiry event cannot bypass the cancellation pause');
    await h.readAt(cancelledAt+3500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Cancelled tag returns after three seconds even if its old presence expired');
  }
  {
    const h=setup();await h.warmup(7000);await h.click('btn-cancel');const cancelledAt=h.time();
    await h.readAt(cancelledAt+3500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Slow inventory cadence cannot extend the cancellation cooldown');
  }
  {
    const h=setup();await h.warmup();await h.readAt(3500,OTHER);await h.advance(180);await h.click('btn-cancel');
    const cancelledAt=h.time();await h.readAt(cancelledAt+3200);await h.readAt(cancelledAt+3500,OTHER);await h.advance(180);
    check(h.state.cart[0]?.qty,2,'Both distinct physical tags return automatically after cancellation');
  }
  {
    const h=setup();await h.warmup();await h.click('btn-cancel');const cancelledAt=h.time();
    const refreshed=setup({stored:h.stored,now:cancelledAt+2000});await refreshed.run('recoverCheckout()');
    await refreshed.readAt(cancelledAt+2999);await refreshed.advance(0);
    check(refreshed.state.cart.length,0,'Refresh retains the original cancellation deadline');
    await refreshed.readAt(cancelledAt+3500);await refreshed.advance(180);
    check(refreshed.state.cart[0]?.qty,1,'Refresh does not restart the three-second pause');
  }
  {
    const h=setup();await h.warmup();h.backend.closeCheckout=async()=>{throw Error('offline')};await h.click('btn-cancel');
    check(h.state.cart[0]?.qty,1,'Failed cancellation preserves the existing cart');
    check(h.run('cancelledUntil.size'),0,'Failed cancellation cannot arm a new checkout');
  }
  {
    const h=setup();await h.warmup();await h.remove();
    h.run("openHold('m-tag')");await h.advance(10000);h.run("closeHold('m-tag')");
    await h.readAt(14000);await h.advance(180);
    check(h.suppressed(),true,'Time spent in a blocked popup cannot masquerade as physical removal');
  }
  {
    const h=setup();await h.warmup();await h.click('btn-cancel');const cancelledAt=h.time();
    h.run("openHold('m-tag')");await h.readAt(cancelledAt+3500);await h.advance(180);
    check(h.state.cart.length,0,'Cancellation rearming cannot bypass a blocking popup');
    h.run("closeHold('m-tag')");await h.readAt(cancelledAt+4500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Automatic scanning resumes after the popup closes');
  }
  for(const status of ['PURCHASED','INACTIVE',null]){
    const h=setup();await h.warmup();await h.click('btn-cancel');const cancelledAt=h.time();
    if(status)h.statuses.set(EPC,status);else h.statuses.delete(EPC);
    await h.readAt(cancelledAt+3500);await h.advance(180);
    check(h.state.cart.length,0,'Automatic rescanning still requires backend eligibility validation: '+status);
    const calls=h.lookups.length;await h.readAt(cancelledAt+4500);await h.advance(180);
    check(h.lookups.length,calls,'Repeated rejected reads cannot restart lookups after cancellation');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();await h.advance(9500);
    check(h.suppressed(),false,'Genuine adaptive absence still releases a removed EPC');
  }
  console.log(`${checks} integrated scanner/cart rescan checks passed (simulated hardware and API)`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
