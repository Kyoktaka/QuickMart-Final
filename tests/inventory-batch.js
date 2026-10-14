// Batch registration regression test for the final QuickMart inventory UI.
// This checks actual UI handlers with simulated DOM and backend, no reader hardware.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../js/inventory.js'),'utf8');
const elements=new Map(),listeners={},batches=[],notices=[];
function element(selector){
  if(!elements.has(selector))elements.set(selector,{
    value:'',textContent:'',innerHTML:'',disabled:false,onclick:null,onchange:null,
    addEventListener(){},classList:{contains:()=>true,toggle(){}},
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
  state, $:element, $$:()=>[],RFIDScanner:reader,
  window:{RFIDScanner:reader,addEventListener(name,cb){listeners[name]=cb}},
  document:{activeElement:{blur(){}},querySelector(){return null}},
  Backend:{
    async registerEpcs(productId,epcs){
      batches.push({productId,epcs:[...epcs]});
      return {registered_epcs:epcs,already_registered_epcs:[],
        already_registered_other_product_epcs:[],invalid_epcs:[]};
    }
  },
  toast:m=>notices.push(m),async refreshAll(){},
  openModal(){},closeModal(){},togglePop(){},
  peso:n=>String(n),esc:s=>String(s),confirm:()=>true,
  LOW:2,setTimeout:()=>0
};
vm.runInNewContext(source,sandbox);
const read=epc=>listeners['rfid:read']({detail:{epc}});
const arm=element('#epc-arm'),product=element('#epc-product');
async function run(){
  element('#btn-epc-mode').onclick();
  await arm.onclick();
  assert.equal(reader.enabled,true,'Reader should start batch scan');
  read('EPC-001');read('EPC-002');read('EPC-003');read('EPC-001');
  assert.match(element('#epc-captured').textContent,/3 unique EPCs/);
  await arm.onclick();
  assert.equal(reader.enabled,false,'Reader stops before confirmation');
  assert.match(arm.textContent,/Register 3 Tags/);
  await arm.onclick();
  assert.equal(batches.length,1);
  assert.equal(batches[0].productId,1);
  assert.deepEqual(batches[0].epcs,['EPC-001','EPC-002','EPC-003']);
  assert.match(element('#epc-captured').textContent,/No EPCs captured/);

  // Switching products in the middle of capture must discard earlier EPCs.
  await arm.onclick();
  read('EPC-LEFT-BEHIND');
  product.value='2';product.onchange();
  assert.equal(reader.enabled,false,'Switching product disables scanner');
  assert.match(element('#epc-captured').textContent,/No EPCs captured/);
  await arm.onclick();read('EPC-ZONROX-ONLY');
  await arm.onclick();await arm.onclick();
  assert.equal(batches.length,2);
  assert.equal(batches[1].productId,2);
  assert.deepEqual(batches[1].epcs,['EPC-ZONROX-ONLY']);
  console.log('Final QuickMart batch restock and product-change isolation tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});