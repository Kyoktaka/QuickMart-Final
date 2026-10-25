// Restocking: EPC tags are registered ONLY after the manager password is verified.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/inventory.js','utf8');
const html=fs.readFileSync('manager/inventory.html','utf8');
for(const id of ['m-restock-auth','restock-pw','restock-err','restock-auth-ok','restock-auth-cancel'])
  assert(html.includes('id="'+id+'"'),'inventory.html is missing #'+id);
assert(/<input type="password" id="restock-pw"/.test(html),'Manager password box must be a password field');

const elements=new Map(),listeners={},batches=[],authCalls=[],modals=new Set();
let clock=1000000,tick=null,redirect=null,registerError=null,authError=null;
function element(sel){
  if(!elements.has(sel))elements.set(sel,{value:'',textContent:'',innerHTML:'',readOnly:sel==='#epc-code',disabled:false,
    onclick:null,onchange:null,handlers:{},addEventListener(t,fn){this.handlers[t]=fn},
    click(){return this.onclick&&this.onclick()},classList:{contains:()=>true,toggle(){}},
    blur(){},focus(){},setAttribute(){},getAttribute(){return 'false'}});
  return elements.get(sel);
}
const reader={enabled:false,enable(){this.enabled=true},disable(){this.enabled=false}};
const state={products:[{id:1,name:'Zonrox',category:'Home',price:30,stock:0,active:true}],tags:[]};
element('#epc-product').value='1';
const sandbox={
  state,$:element,$$:()=>[],RFIDScanner:reader,location:{replace:u=>{redirect=u}},
  window:{RFIDScanner:reader,addEventListener(n,fn){listeners[n]=fn}},
  document:{activeElement:{blur(){}},querySelector(){return null}},
  Date:{now:()=>clock},setInterval:fn=>{tick=fn;return 7},clearInterval:()=>{tick=null},setTimeout:()=>0,
  Backend:{
    async authorizeRestock(pw){authCalls.push(pw);if(authError)throw authError;
      if(pw!=='manager-secret'){const e=new Error('Incorrect manager password. 2 attempts left.');e.status=401;e.data={retry_after:0};throw e}
      return {success:true}},
    async registerEpcs(productId,epcs){
      if(registerError)throw registerError;
      batches.push({productId,epcs:[...epcs]});
      return {registered_epcs:epcs,already_registered_epcs:[],already_registered_other_product_epcs:[],invalid_epcs:[]}}
  },
  toast(){},async refreshAll(){},openModal:id=>modals.add(id),closeModal:id=>modals.delete(id),togglePop(){},
  peso:n=>String(n),esc:String,confirm:()=>true,LOW:2
};
vm.runInNewContext(source,sandbox);
const arm=element('#epc-arm'),pw=element('#restock-pw'),ok=element('#restock-auth-ok'),
  err=element('#restock-err'),msg=element('#ee'),epc=element('#epc-list');
const shown=()=>[...String(epc.innerHTML).matchAll(/data-epc-remove="([^"]+)"/g)].map(m=>m[1]);
const read=v=>listeners['rfid:read']({detail:{epc:v}});
async function toReview(...tags){
  element('#btn-epc-mode').onclick();
  await arm.onclick();tags.forEach(read);await arm.onclick();
  assert.match(arm.textContent,/Register \d+ Tag/);
}
(async()=>{
  // 1) Pressing Register only opens the password popup.
  await toReview('TAG-0001','TAG-0002');
  await arm.onclick();
  assert(modals.has('m-restock-auth'),'password popup opens');
  assert.equal(reader.enabled,false,'reader is off while the password is typed');
  assert.equal(batches.length,0);assert.equal(authCalls.length,0);

  // 2) Empty password: nothing is sent.
  pw.value='';await ok.onclick();
  assert.match(err.textContent,/Enter the manager password/);
  assert.equal(authCalls.length,0);assert.equal(batches.length,0);

  // 3) Wrong password: nothing is registered, tags stay in the box.
  pw.value='wrong';await ok.onclick();
  assert.match(err.textContent,/Incorrect manager password/);
  assert.equal(batches.length,0,'wrong password must not register tags');
  assert.deepEqual(shown(),['TAG-0001','TAG-0002'],'captured tags are kept');
  assert(modals.has('m-restock-auth'),'popup stays open for another try');
  assert.equal(pw.value,'','wrong password is cleared');

  // 4) Cancel keeps the tags but registers nothing.
  element('#restock-auth-cancel').onclick();
  assert(!modals.has('m-restock-auth'));assert.equal(batches.length,0);
  assert.deepEqual(shown(),['TAG-0001','TAG-0002']);
  assert.match(msg.textContent,/cancelled/i);

  // 5) Correct password: registered exactly once.
  await arm.onclick();pw.value='manager-secret';await ok.onclick();
  assert.deepEqual(batches,[{productId:1,epcs:['TAG-0001','TAG-0002']}]);
  assert(!modals.has('m-restock-auth'),'popup closes after success');
  assert.equal(pw.value,'','password is wiped from the box');
  assert.deepEqual(shown(),[]);

  // 6) PHP says the approval expired (403): tags are kept and the manager is told.
  await toReview('TAG-0003');
  await arm.onclick();
  registerError=Object.assign(new Error('Manager password is required to register EPC tags.'),{status:403,data:{code:'RESTOCK_AUTH_REQUIRED'}});
  pw.value='manager-secret';await ok.onclick();
  assert.match(msg.textContent,/permission expired/i);
  assert.deepEqual(shown(),['TAG-0003'],'tags survive an expired approval');
  assert.match(arm.textContent,/Register 1 Tag/);
  registerError=null;

  // 7) Registering again asks for the password again (no password reuse).
  const before=authCalls.length;
  await arm.onclick();assert(modals.has('m-restock-auth'));
  pw.value='manager-secret';await ok.onclick();
  assert.equal(authCalls.length,before+1);assert.equal(batches.length,2);

  // 8) Session lost while typing the password -> back to the login page.
  await toReview('TAG-0004');await arm.onclick();
  authError=Object.assign(new Error('Manager authentication required.'),{status:401,data:{authenticated:false}});
  pw.value='x';await ok.onclick();authError=null;
  assert.equal(redirect,'login.html');assert.equal(batches.length,2);
  element('#restock-auth-cancel').onclick();

  // 9) 3 wrong tries -> locked popup; no request while locked; unlocks after the countdown.
  authError=Object.assign(new Error('Too many failed attempts. Try again in 60 seconds.'),{status:429,data:{retry_after:60}});
  await arm.onclick();pw.value='wrong';await ok.onclick();authError=null;
  assert.equal(ok.disabled,true);assert.equal(pw.disabled,true);
  assert.match(err.textContent,/Try again in 60 second/);
  const calls=authCalls.length;pw.value='manager-secret';await ok.onclick();
  assert.equal(authCalls.length,calls,'no request while locked');assert.equal(batches.length,2);
  clock+=61000;tick();
  assert.equal(ok.disabled,false);assert.equal(pw.disabled,false);
  pw.value='manager-secret';await ok.onclick();
  assert.equal(batches.length,3);assert.deepEqual(batches[2].epcs,['TAG-0004']);
  console.log('Restock needs the manager password: gate, wrong/empty password, cancel, expiry, lockout tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
