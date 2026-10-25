// Scan-only EPC registration: scanner writes a display-only list.
// Browser-free UI regressions; actual USB reader still requires live testing.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/inventory.js','utf8');
const html=fs.readFileSync('manager/inventory.html','utf8');
assert(/id="epc-list"/.test(html)&&!/<(textarea|input)\b[^>]*id="epc-list"/.test(html),
  'Scanned EPCs must be shown in a list (not a typeable field)');
assert(!/<textarea\b[^>]*id="epc-code"/.test(html),'Old EPC textarea must be gone');
assert(!html.includes('You can also paste or type multiple EPCs'),
  'EPC display must not advertise typing or pasting');
const elements=new Map(),listeners={},batches=[],notices=[],authCalls=[],openModals=new Set();
function element(selector){
  if(!elements.has(selector))elements.set(selector,{
    value:'',textContent:'',innerHTML:'',readOnly:selector==='#epc-code',
    disabled:false,onclick:null,onchange:null,handlers:{},
    addEventListener(type,fn){this.handlers[type]=fn},
    classList:{contains:()=>true,toggle(){}},
    blur(){},focus(){},setAttribute(){},getAttribute(){return 'false'}
  });
  return elements.get(selector);
}
const products=[
  {id:1,name:'Argentina Giniling',category:'Food',price:69,stock:0,active:true},
  {id:2,name:'Zonrox',category:'Home',price:30,stock:0,active:true}
];
const reader={enabled:false,enable(){this.enabled=true},disable(){this.enabled=false}};
const state={products,tags:[]};
element('#epc-product').value='1';
const sandbox={
  state,$:element,$$:()=>[],RFIDScanner:reader,
  window:{RFIDScanner:reader,addEventListener(name,fn){listeners[name]=fn}},
  document:{activeElement:{blur(){}},querySelector(){return null}},
  Backend:{async authorizeRestock(password){
    authCalls.push(password);
    if(password!=='manager-secret'){const e=new Error('Incorrect manager password. 2 attempts left.');e.status=401;e.data={retry_after:0};throw e}
    return {success:true}
  },async registerEpcs(productId,epcs){
    batches.push({productId,epcs:[...epcs]});
    return {registered_epcs:epcs,already_registered_epcs:[],
      already_registered_other_product_epcs:[],invalid_epcs:[]}
  }},
  toast:m=>notices.push(m),async refreshAll(){},
  openModal:id=>openModals.add(id),closeModal:id=>openModals.delete(id),togglePop(){},
  peso:n=>String(n),esc:String,confirm:()=>true,LOW:2,setTimeout:()=>0
};
vm.runInNewContext(source,sandbox);
const epc=element('#epc-list'),count=element('#epc-captured');
const shown=()=>[...String(epc.innerHTML).matchAll(/data-epc-remove="([^"]+)"/g)].map(m=>m[1]);
const clickRemove=id=>epc.handlers.click({target:{closest:()=>({dataset:{epcRemove:id}})}});
const arm=element('#epc-arm'),product=element('#epc-product');
const read=value=>listeners['rfid:read']({detail:{epc:value}});
const approve=async(password='manager-secret')=>{element('#restock-pw').value=password;await element('#restock-auth-ok').onclick()};
async function run(){
  element('#btn-epc-mode').onclick();
  assert(!epc.handlers.input,'No typing or paste listener may register EPCs');
  assert.equal(arm.textContent,'Start Scanning');
  read('NOT-ACTIVE');
  assert.deepEqual(shown(),[],'RFID reads do not register outside capture phase');
  await arm.onclick();
  assert.equal(reader.enabled,true);
  read('E2827802000000000DFFD26D');
  read('E2827802000000000DFFD36D');
  read('E2827802000000000DFFA0ED');
  read('E2827802000000000DFFD26D');
  assert.deepEqual(shown(),[
    'E2827802000000000DFFD26D',
    'E2827802000000000DFFD36D',
    'E2827802000000000DFFA0ED'
  ],'All unique EPCs must appear in the list, one row each');
  assert.equal(count.textContent,'3 tags');
  await arm.onclick();
  assert.equal(reader.enabled,false);
  assert.match(arm.textContent,/Register 3 Tags/);
  // Even a script changing the list markup is not used as source data.
  epc.innerHTML='<div data-epc-remove="FORGED-MANUAL-CODE"></div>';
  await arm.onclick();
  assert(openModals.has('m-restock-auth'),'Register must ask for the manager password first');
  assert.equal(batches.length,0,'Nothing is registered before the password is verified');
  await approve();
  assert.deepEqual(batches[0].epcs,[
    'E2827802000000000DFFD26D',
    'E2827802000000000DFFD36D',
    'E2827802000000000DFFA0ED'
  ],'Registration must trust captured Set, not list markup');
  assert.deepEqual(shown(),[]);
  assert.equal(count.textContent,'0 tags');

  // Product selection cannot steal previously captured EPCs.
  await arm.onclick();read('EPC-ONLY-PRODUCT-1');
  sandbox.confirm=()=>false;
  product.value='2';product.onchange();
  assert.equal(String(product.value),'1','Cancel restores original product');
  assert.deepEqual(shown(),['EPC-ONLY-PRODUCT-1']);
  sandbox.confirm=()=>true;
  product.value='2';product.onchange();
  assert.equal(reader.enabled,false);
  assert.deepEqual(shown(),[]);
  await arm.onclick();read('EPC-ONLY-PRODUCT-2');
  await arm.onclick();await arm.onclick();await approve();
  assert.equal(batches[1].productId,2);
  assert.deepEqual(batches[1].epcs,['EPC-ONLY-PRODUCT-2']);

  // Twenty individual RFID tags are shown in the box and registered together.
  element('#btn-epc-mode').onclick();
  await arm.onclick();
  const twenty=Array.from({length:20},(_,n)=>'EPC-'+String(n+1).padStart(3,'0'));
  twenty.forEach(read);read(twenty[0]);read(twenty[19]);
  read('ILLEGAL/EPC'); // Invalid characters are never added.
  assert.equal(shown().length,20);
  assert.equal(count.textContent,'20 tags');
  await arm.onclick();
  await arm.onclick();await approve();
  assert.equal(batches[2].epcs.length,20);
  assert.deepEqual(batches[2].epcs,twenty);

  // Clear removes pending reads but does not change database rows.
  element('#btn-epc-mode').onclick();
  await arm.onclick();read('EPC-CLEAR');
  element('#epc-clear').onclick();
  assert.equal(reader.enabled,false);
  assert.deepEqual(shown(),[]);
  assert.equal(count.textContent,'0 tags');
  assert.equal(batches.length,3);

  // A wrongly scanned EPC can be removed from the batch.
  element('#btn-epc-mode').onclick();
  await arm.onclick();
  read('GOOD-TAG-1');read('WRONG-TAG-9');read('GOOD-TAG-2');
  clickRemove('WRONG-TAG-9');
  assert.deepEqual(shown(),['GOOD-TAG-1','GOOD-TAG-2'],'Remove deletes only that EPC');
  assert.equal(count.textContent,'2 tags');
  read('WRONG-TAG-9');   // still lying on the reader: must not come straight back
  assert.deepEqual(shown(),['GOOD-TAG-1','GOOD-TAG-2'],'A removed tag still in range is ignored');
  listeners['rfid:tray']({detail:['GOOD-TAG-1','GOOD-TAG-2']});   // it left the reader
  read('WRONG-TAG-9');
  assert(shown().includes('WRONG-TAG-9'),'Once it left the reader it can be scanned again');
  clickRemove('WRONG-TAG-9');
  await arm.onclick();   // Stop Scanning -> review
  assert.match(arm.textContent,/Register 2 Tags/);
  clickRemove('GOOD-TAG-2');   // removing also works while reviewing
  assert.match(arm.textContent,/Register 1 Tag$/);
  await arm.onclick();await approve();
  assert.deepEqual(batches[3].epcs,['GOOD-TAG-1'],'Removed EPCs are never registered');
  element('#btn-epc-mode').onclick();
  await arm.onclick();read('ONLY-ONE');await arm.onclick();
  clickRemove('ONLY-ONE');
  assert.equal(arm.textContent,'Start Scanning','Removing the last tag returns to Start Scanning');
  assert.deepEqual(shown(),[]);
  console.log('EPC list, remove-wrong-EPC, 20-tag display and batch registration tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});