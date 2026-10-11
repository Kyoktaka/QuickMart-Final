// Batch registration wiring test: multiple distinct tags per one product, no silent
// spillover when switching product before confirmation. No real hardware required.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const full=fs.readFileSync('js/inventory.js','utf8');
const mark='/* BATCH RESTOCKING';
assert(full.includes(mark));
const src=full.slice(full.indexOf(mark));
const dom=new Map(),listeners={},batches=[],statuses=[];
const element=id=>{
  if(!dom.has(id))dom.set(id,{
    value:'',innerHTML:'',textContent:'',disabled:false,
    classList:{contains:()=>true},blur(){},onclick:null,onchange:null
  });
  return dom.get(id);
};
const products=[
  {id:1,name:'Argentina Giniling',category:'Food',price:69,stock:0,active:true},
  {id:2,name:'Zonrox',category:'Home',price:30,stock:0,active:true}
];
const scanner={
  enabled:false,enable(){this.enabled=true},disable(){this.enabled=false}
};
const sandbox={
  state:{products}, $:element, $$:()=>[],
  window:{
    RFIDScanner:scanner,
    addEventListener(name,cb){listeners[name]=cb}
  },
  RFIDScanner:scanner,
  document:{activeElement:{blur(){}}},
  Backend:{
    async registerEpcs(productId,epcs){
      batches.push({productId,epcs:[...epcs]});
      return {registered_epcs:epcs,already_registered_epcs:[],
        already_registered_other_product_epcs:[],invalid_epcs:[]};
    },
    async loadProducts(){return products}
  },
  toast(m){statuses.push(m)},pushActivity(){},renderInventory(){},
  fillEpc(){},openModal(){},peso(n){return String(n)},
  esc:s=>String(s),confirm:()=>true
};
element('#epc-product').value='1';
vm.runInNewContext(src,sandbox);
const read=epc=>listeners['rfid:read']({detail:{epc}});
const button=element('#epc-arm');
async function run(){
  element('#btn-epc-mode').onclick();
  await button.onclick(); // start continuous batch scan
  assert.equal(scanner.enabled,true);
  read('EPC-001');read('EPC-002');read('EPC-003');read('EPC-001');
  assert.match(element('#epc-captured').textContent,/3 unique EPCs/);
  await button.onclick(); // stop & review
  assert.equal(scanner.enabled,false);
  assert.match(button.textContent,/Register 3 Tags/);
  await button.onclick(); // POST one batch
  assert.equal(batches.length,1);
  assert.equal(batches[0].productId,1);
  assert.deepEqual(batches[0].epcs,['EPC-001','EPC-002','EPC-003']);
  // A pending scan is discarded when manager selects a different product.
  await button.onclick();read('EPC-LEFT-BEHIND');
  element('#epc-product').value='2';
  element('#epc-product').onchange();
  assert.equal(scanner.enabled,false);
  await button.onclick();read('EPC-ZONROX-ONLY');
  await button.onclick();await button.onclick();
  assert.equal(batches.length,2);
  assert.equal(batches[1].productId,2);
  assert.deepEqual(batches[1].epcs,['EPC-ZONROX-ONLY']);
  console.log('Batch restock + product-change isolation tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});
