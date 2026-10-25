// Category / search ignore upper-lower case: "Egg", "egg" and "EGG" are one category.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/inventory.js','utf8');
const els=new Map(),listeners={};
function el(sel){
  if(!els.has(sel))els.set(sel,{value:'',textContent:'',innerHTML:'',readOnly:false,disabled:false,handlers:{},
    addEventListener(t,fn){this.handlers[t]=fn},classList:{contains:()=>false,toggle(){},add(){},remove(){}},
    blur(){},focus(){},setAttribute(){},getAttribute(){return 'false'}});
  return els.get(sel);
}
const products=[
  {id:1,name:'Fresh Eggs',category:'Egg',price:10,stock:5,active:true},
  {id:2,name:'Salted Egg',category:'egg',price:12,stock:5,active:true},
  {id:3,name:'Milk',category:'Dairy',price:20,stock:5,active:true}
];
el('#inv-status').value='all';el('#inv-stock').value='all';el('#inv-cat').value='all';
const saved=[];
const sandbox={state:{products,tags:[]},$:el,$$:()=>[],window:{addEventListener(n,fn){listeners[n]=fn}},
  document:{activeElement:{blur(){}}},RFIDScanner:{enable(){},disable(){}},
  renderPager(){},LOW:2,peso:String,esc:String,confirm:()=>true,toast(){},setTimeout:()=>0,
  openModal(){},closeModal(){},togglePop(){},refreshAll:async()=>{},
  Backend:{saveProduct:async p=>{saved.push(p)}}};
vm.runInNewContext(source+"\nthis.__t={renderInventory,canonicalCategory,categoryList};",sandbox);
const {renderInventory,canonicalCategory,categoryList}=sandbox.__t;
const names=()=>[...el('#inv-body').innerHTML.matchAll(/data-product-id="(\d+)" class/g)].map(m=>+m[1]);

// Category dropdown lists "Egg" once, whatever the stored casing.
assert.equal(categoryList().length,2,'Egg/egg collapse into one category');
renderInventory();
assert.equal((el('#inv-cat').innerHTML.match(/<option value="egg"/g)||[]).length,1);
assert.deepEqual(names(),[1,2,3]);

// Search: egg / EGG / Egg / eGg all find both egg products (name or category), no matter the case.
for(const q of ['egg','EGG','Egg','eGg','  EGG  ']){el('#inv-search').value=q;renderInventory();assert.deepEqual(names(),[1,2],'search "'+q+'"')}
el('#inv-search').value='DAIRY';renderInventory();assert.deepEqual(names(),[3],'category text is searchable in any case');
el('#inv-search').value='';
// Category filter picks both spellings.
el('#inv-cat').value='egg';renderInventory();assert.deepEqual(names(),[1,2]);
el('#inv-cat').value='all';

// Saving "EGG" / "egg" reuses the registered "Egg" (no new duplicate category).
assert.equal(canonicalCategory('EGG'),'Egg');
assert.equal(canonicalCategory('  egg '),'Egg');
assert.equal(canonicalCategory('Snacks'),'Snacks');
assert.equal(canonicalCategory('dairy',3),'dairy','a product may re-case its own sole category');

// Product rows no longer show the "0 EPC" badge.
renderInventory();assert(!/>\s*\d+ EPC</.test(el('#inv-body').innerHTML),'no "N EPC" badge');
console.log('Category/search case-insensitive, duplicate categories merged, EPC badge removed');
