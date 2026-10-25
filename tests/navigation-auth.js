// Navigation is an application control; PHP authorization remains mandatory.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/main.js','utf8');
async function frame(page,auth,storedKiosk='1'){
  let reads=0,scanner=false,recovered=0;
  const redirects=[],listeners={},storage=new Map([['qm_kiosk',storedKiosk]]);
  const view={classList:{add(){},remove(){}}};
  const state={kioskOn:false};
  const context={state,SS_AUTH:'qm_auth',SS_KIOSK:'qm_kiosk',SS_FRESH:'qm_fresh',
    Backend:{me:async()=>auth,loadProducts:async()=>{reads++;return[]},loadTags:async()=>{reads++;return[]},loadSessions:async()=>{reads++;return[]},loadDashboard:async()=>{reads++;return{}}},
    $:selector=>selector==='#'+page?view:null,window:{addEventListener:(type,listener)=>{listeners[type]=listener}},
    RFIDScanner:{disable(){scanner=false},enable(){scanner=true}},
    sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    location:{replace:target=>redirects.push(target)},recoverCheckout:async()=>{recovered++},pushActivity(){},confirmLogout(){},toast(){},
    screen(){scanner=true},document:{body:view},setTimeout(){}};
  vm.runInNewContext(source,context);for(let i=0;i<20;i++)await Promise.resolve();
  return {state,redirects,listeners,reads:()=>reads,recovered:()=>recovered,scanner:()=>scanner};
}
async function main(){
  let page=await frame('kiosk',{authenticated:false});assert.deepEqual(page.redirects,['login.html']);assert.equal(page.reads(),0);
  page=await frame('kiosk',{authenticated:true,kiosk_active:false,scan_authorized:false});
  assert.deepEqual(page.redirects,['scan.html']);assert.equal(page.recovered(),0,'Tampered browser flag cannot authorize recognition');
  page=await frame('tab-inventory',{authenticated:true,kiosk_active:true,scan_authorized:true});
  assert.deepEqual(page.redirects,['kiosk.html']);assert.equal(page.reads(),0,'Kiosk cannot expose manager data before redirecting');
  page=await frame('kiosk',{authenticated:true,kiosk_active:true,scan_authorized:true},'');
  assert.equal(page.recovered(),1,'Server authorization supports refresh without a browser kiosk flag');
  assert.equal(page.state.kioskOn,true);
  page.listeners['quickmart:scan-authorization-expired']();
  assert.equal(page.state.kioskOn,false);assert.deepEqual(page.redirects,['scan.html']);
  page=await frame('tab-scan',{authenticated:true,kiosk_active:true,scan_authorized:false});
  assert.equal(page.reads(),0);assert.equal(page.redirects.length,0,'Expired recognition can reach the password renewal screen');
  page=await frame('login',{authenticated:true,kiosk_active:true,scan_authorized:true});assert.deepEqual(page.redirects,['kiosk.html']);
  page=await frame('tab-inventory',{authenticated:false});
  page.listeners.pageshow({persisted:true});for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(page.redirects.at(-1),'login.html','Browser history cache rechecks PHP authentication');
  console.log('Server-authorized kiosk entry, management redirects, expiry renewal and browser history cache checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});
