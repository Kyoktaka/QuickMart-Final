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
    listeners:{},addEventListener(type,fn){this.listeners[type]=fn},classList:{contains:()=>true,toggle(){}},
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
  assert.match(element('#epc-captured').textContent,/3 tags/);
  assert.equal(element('#epc-code').readOnly,true,'Batch scanner locks the live EPC list for reading');
  assert.equal(element('#epc-code').value,'EPC-001\\nEPC-002\\nEPC-003'.replace(/\\n/g,'\n'),
    'All unique EPCs must be visible in the main field, not only the last read');
  await arm.onclick();
  assert.equal(reader.enabled,false,'Reader stops before confirmation');
  assert.equal(element('#epc-code').readOnly,false,'Manual editing resumes after stop');
  element('#epc-code').value='EPC-001\nEPC-003\nEPC-MANUAL';
  element('#epc-code').listeners.input();
  assert.match(arm.textContent,/Register 3 Tags/);
  await arm.onclick();
  assert.equal(batches.length,1);
  assert.equal(batches[0].productId,1);
  assert.deepEqual(batches[0].epcs,['EPC-001','EPC-003','EPC-MANUAL'],
    'Editing the list should remove one scanned tag and add a manual EPC');
  assert.match(element('#epc-captured').textContent,/0 tags/);

  // Switching products in the middle of capture must discard earlier EPCs.
  await arm.onclick();
  read('EPC-LEFT-BEHIND');
  product.value='2';product.onchange();
  assert.equal(reader.enabled,false,'Switching product disables scanner');
  assert.match(element('#epc-captured').textContent,/0 tags/);
  await arm.onclick();read('EPC-ZONROX-ONLY');
  await arm.onclick();await arm.onclick();
  assert.equal(batches.length,2);
  assert.equal(batches[1].productId,2);
  assert.deepEqual(batches[1].epcs,['EPC-ZONROX-ONLY']);
  // Manual-only registration via the same multiline EPC field; distinct values
  // are deduplicated and sent together as a single atomic batch.
  element('#btn-epc-mode').onclick();
  element('#epc-code').value='EPC-PASTE-1, EPC-PASTE-2\nEPC-PASTE-1';
  element('#epc-code').listeners.input();
  await arm.onclick(); // Start Scanning, retaining manually pasted EPCs.
  assert.equal(element('#epc-code').value,'EPC-PASTE-1\nEPC-PASTE-2');
  await arm.onclick(); // Stop Scanning.
  await arm.onclick(); // Register.
  assert.deepEqual(batches[2].epcs,['EPC-PASTE-1','EPC-PASTE-2']);
  // Reject malformed EPC tokens before allowing the scan stage to start.
  element('#btn-epc-mode').onclick();
  element('#epc-code').value='ILLEGAL/EPC';
  await arm.onclick();
  assert.equal(reader.enabled,false,'Invalid manual EPC may not start capture');
  assert.match(element('#ee').textContent,/Invalid EPC format/);
  console.log('Multi-line EPC scan, manual typing, deduplication, batch restock and product isolation passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});