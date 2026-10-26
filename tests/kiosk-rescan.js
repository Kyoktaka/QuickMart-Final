// Exercise the actual scanner cadence estimator and cart suppression together.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const EPC='E28011700000021905AC150B',OTHER='E28011700000021905AC150C';
let checks=0;
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++}
const html=fs.readFileSync('manager/kiosk.html','utf8');
for(const id of ['btn-rescan-idle','btn-rescan-cart'])
  check(new RegExp('<button\\b[^>]*id="'+id+'"[^>]*type="button"[^>]*hidden[^>]*>Rescan products</button>').test(html),true,
    'Rescan is a real, initially hidden button in '+id);
function setup(){
  let now=0,nextTimer=0,nextSession=0;
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
    revokeScan:async()=>{},checkoutStatus:async id=>result(id,'CART')};
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
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},location:{href:''},
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
  return {state,scanner,run,el,advance,readAt,lookups,reads,statuses,time:()=>now,
    suppressed:epc=>run('removedEpcs.has('+JSON.stringify(epc||EPC)+')'),
    async warmup(interval=1000){for(const at of [1000,1000+interval,1000+interval*2])await readAt(at);await advance(180)},
    async remove(){run('removeFromCart(1,1)');await advance(0)},
    async click(id){await el('#'+id).onclick();await settle()}};
}
async function main(){
  {
    const h=setup();await h.readAt(1000);await h.advance(180);await h.remove();await h.readAt(3000);
    check(h.suppressed(),true,'An unmeasured first inventory repeat cannot prove removal');
    await h.click('btn-rescan-idle');await h.readAt(3500);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Explicit Rescan remains immediate for an unmeasured reader cadence');
  }
  {
    const h=setup();await h.warmup();await h.remove();
    check(h.el('#btn-rescan-idle').hidden,false,'Removing the last item exposes Rescan on the idle screen');
    await h.readAt(5000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'First returning read after a two-second gap restores the item');
    check(h.suppressed(),false,'Last-read baseline survives removal');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();
    await h.readAt(11000);await h.advance(180);
    check(h.reads.at(-1).previousCycleMs,3000,'Returning read carries the pre-gap inventory cycle');
    check(h.scanner.getReadHealth().estimatedInventoryCycleMs,3400,'Actual estimator includes the new gap after its snapshot');
    check(h.state.cart[0]?.qty,1,'A four-second return no longer inflates its own release threshold');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();
    for(const at of [10000,13000,16000])await h.readAt(at);
    check(h.suppressed(),true,'Normal slow inventory rounds cannot re-add a removed tag');
    check(h.state.cart.length,0,'Removed product stays out while continuously read');
    const calls=h.lookups.length;
    await h.click('btn-rescan-idle');
    check(h.lookups.length,calls,'Rescan waits for a fresh read rather than trusting a stale presence snapshot');
    check(h.el('#btn-rescan-idle').hidden,true,'Rescan control hides after explicit release');
    await h.readAt(17000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Explicit Rescan accepts the next read without an absence timeout');
    await h.readAt(18000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Repeated reads after Rescan remain deduplicated');
  }
  {
    const h=setup();await h.warmup();await h.readAt(3500,OTHER);await h.advance(180);await h.remove();
    check(h.state.cart[0]?.qty,1,'Partial removal retains the other physical item');
    check(h.el('#btn-rescan-cart').hidden,false,'Partial removal exposes Rescan on the cart screen');
    await h.click('btn-rescan-cart');await h.readAt(4000,OTHER);await h.advance(180);
    check(h.state.cart[0]?.qty,2,'Explicit Rescan restores only the newly read missing EPC');
  }
  {
    const h=setup();await h.warmup();await h.click('btn-cancel');
    check(h.state.cart.length,0,'Cancellation clears the cart');
    check(h.suppressed(),true,'Cancellation keeps continuous reads suppressed');
    await h.readAt(5000);await h.advance(180);
    check(h.state.cart[0]?.qty,1,'Cancellation preserves the last-read timestamp for the first returning scan');
  }
  {
    const h=setup();await h.warmup();await h.remove();
    h.run("openHold('m-tag')");await h.advance(10000);h.run("closeHold('m-tag')");
    await h.readAt(14000);await h.advance(180);
    check(h.suppressed(),true,'Time spent in a blocked popup cannot masquerade as physical removal');
    h.run("openHold('m-tag')");await h.click('btn-rescan-idle');
    check(h.suppressed(),true,'Rescan cannot bypass an open blocking popup');
  }
  for(const status of ['PURCHASED','INACTIVE',null]){
    const h=setup();await h.warmup();await h.remove();
    if(status)h.statuses.set(EPC,status);else h.statuses.delete(EPC);
    await h.click('btn-rescan-idle');await h.readAt(3500);await h.advance(180);
    check(h.state.cart.length,0,'Explicit Rescan still requires backend eligibility validation: '+status);
    const calls=h.lookups.length;await h.readAt(4500);await h.advance(180);
    check(h.lookups.length,calls,'Repeated rejected reads cannot restart lookups after explicit Rescan');
  }
  {
    const h=setup();await h.warmup(3000);await h.remove();await h.advance(9500);
    check(h.suppressed(),false,'Genuine adaptive absence still releases a removed EPC');
  }
  console.log(`${checks} integrated scanner/cart rescan checks passed (simulated hardware and API)`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
