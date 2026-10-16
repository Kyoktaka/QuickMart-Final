// Scan-only EPC registration: scanner writes a display-only list.
// Browser-free UI regressions; actual USB reader still requires live testing.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/inventory.js','utf8');
const html=fs.readFileSync('manager/inventory.html','utf8');
assert(/<textarea\b[^>]*id="epc-code"[^>]*\breadonly\b/.test(html),
  'EPC textarea must be readonly in HTML before scripts run');
assert(!html.includes('You can also paste or type multiple EPCs'),
  'EPC display must not advertise typing or pasting');
const elements=new Map(),listeners={},batches=[],notices=[];
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
  Backend:{async registerEpcs(productId,epcs){
    batches.push({productId,epcs:[...epcs]});
    return {registered_epcs:epcs,already_registered_epcs:[],
      already_registered_other_product_epcs:[],invalid_epcs:[]}
  }},
  toast:m=>notices.push(m),async refreshAll(){},
  openModal(){},closeModal(){},togglePop(){},
  peso:n=>String(n),esc:String,confirm:()=>true,LOW:2,setTimeout:()=>0
};
vm.runInNewContext(source,sandbox);
const epc=element('#epc-code'),count=element('#epc-captured');
const arm=element('#epc-arm'),product=element('#epc-product');
const read=value=>listeners['rfid:read']({detail:{epc:value}});
async function run(){
  element('#btn-epc-mode').onclick();
  assert.equal(epc.readOnly,true,'EPC code box is readonly before scanning');
  assert(!epc.handlers.input,'No typing or paste listener may register EPCs');
  assert.equal(arm.textContent,'Start Scanning');
  read('NOT-ACTIVE');
  assert.equal(epc.value,'','RFID reads do not register outside capture phase');
  await arm.onclick();
  assert.equal(reader.enabled,true);
  read('E2827802000000000DFFD26D');
  read('E2827802000000000DFFD36D');
  read('E2827802000000000DFFA0ED');
  read('E2827802000000000DFFD26D');
  assert.equal(epc.value,[
    'E2827802000000000DFFD26D',
    'E2827802000000000DFFD36D',
    'E2827802000000000DFFA0ED'
  ].join('\n'),'All unique EPCs must appear INSIDE the main readonly box');
  assert.equal(count.textContent,'3 tags');
  assert.equal(epc.readOnly,true);
  await arm.onclick();
  assert.equal(reader.enabled,false);
  assert.equal(epc.readOnly,true,'Stop Scanning must NEVER allow typing or paste');
  assert.match(arm.textContent,/Register 3 Tags/);
  // Even a malicious script changing the textarea is not used as source data.
  epc.value='FORGED-MANUAL-CODE';
  await arm.onclick();
  assert.deepEqual(batches[0].epcs,[
    'E2827802000000000DFFD26D',
    'E2827802000000000DFFD36D',
    'E2827802000000000DFFA0ED'
  ],'Registration must trust captured Set, not textarea text');
  assert.equal(epc.value,'');
  assert.equal(epc.readOnly,true);
  assert.equal(count.textContent,'0 tags');

  // Product selection cannot steal previously captured EPCs.
  await arm.onclick();read('EPC-ONLY-PRODUCT-1');
  sandbox.confirm=()=>false;
  product.value='2';product.onchange();
  assert.equal(String(product.value),'1','Cancel restores original product');
  assert.equal(epc.value,'EPC-ONLY-PRODUCT-1');
  sandbox.confirm=()=>true;
  product.value='2';product.onchange();
  assert.equal(reader.enabled,false);
  assert.equal(epc.value,'');
  await arm.onclick();read('EPC-ONLY-PRODUCT-2');
  await arm.onclick();await arm.onclick();
  assert.equal(batches[1].productId,2);
  assert.deepEqual(batches[1].epcs,['EPC-ONLY-PRODUCT-2']);

  // Twenty individual RFID tags are shown in the box and registered together.
  element('#btn-epc-mode').onclick();
  await arm.onclick();
  const twenty=Array.from({length:20},(_,n)=>'EPC-'+String(n+1).padStart(3,'0'));
  twenty.forEach(read);read(twenty[0]);read(twenty[19]);
  read('ILLEGAL/EPC'); // Invalid characters are never added.
  assert.equal(epc.value.split('\n').length,20);
  assert.equal(count.textContent,'20 tags');
  assert.equal(epc.readOnly,true);
  await arm.onclick();
  assert.equal(epc.readOnly,true);
  await arm.onclick();
  assert.equal(batches[2].epcs.length,20);
  assert.deepEqual(batches[2].epcs,twenty);

  // Clear removes pending reads but does not change database rows.
  element('#btn-epc-mode').onclick();
  await arm.onclick();read('EPC-CLEAR');
  element('#epc-clear').onclick();
  assert.equal(reader.enabled,false);
  assert.equal(epc.value,'');
  assert.equal(count.textContent,'0 tags');
  assert.equal(epc.readOnly,true);
  assert.equal(batches.length,3);
  console.log('Scan-only read-only EPC box, 20-tag display and batch registration tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});