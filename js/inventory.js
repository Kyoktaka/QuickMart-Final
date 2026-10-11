/* ===== INVENTORY: PHP/MySQL AUTHORITATIVE ===== */
const codeFor=id=>'PRD-'+String(id).padStart(8,'0');
const INV_PAGE=5;let invPage=1,invSel=null;
function renderInventory(){
  const cats=[...new Set(state.products.map(p=>p.category))].filter(Boolean).sort();
  const cur=$('#inv-cat').value||'all';
  $('#inv-cat').innerHTML='<option value="all">All Categories</option>'+
    cats.map(c=>'<option '+(c===cur?'selected':'')+' value="'+esc(c)+'">'+esc(c)+'</option>').join('');
  $('#p-cats').innerHTML=cats.map(c=>'<option value="'+esc(c)+'">').join('');
  const q=$('#inv-search').value.trim().toLowerCase(),c=$('#inv-cat').value;
  const st=$('#inv-status').value,sk=$('#inv-stock').value;
  $('#inv-filter-btn').classList.toggle('has-filter',st!=='all'||sk!=='all');
  const rows=state.products.filter(p=>
    p.name.toLowerCase().includes(q)&&(c==='all'||p.category===c)&&
    (st==='all'||(p.active===false?'deactivated':'activated')===st)&&
    (sk==='all'||p.stock<=LOW));
  const total=rows.length,pages=Math.max(1,Math.ceil(total/INV_PAGE));
  invPage=Math.min(invPage,pages);
  const start=(invPage-1)*INV_PAGE,slice=rows.slice(start,start+INV_PAGE);
  $('#inv-body').innerHTML=slice.map((p,i)=>{
    const act=p.active!==false;
    return '<tr data-product-id="'+p.id+'" class="'+(p.id===invSel?'sel':'')+'">'+
      '<td class="num">'+(start+i+1)+'</td><td class="nm">'+esc(p.name)+'</td>'+
      '<td>'+esc(p.category)+'</td><td class="center">'+p.stock+
      (p.stock<=LOW?'<span class="badge b-low">Low</span>':'')+'</td>'+
      '<td class="center">'+peso(p.price)+'</td><td class="center"><span class="status '+
      (act?'activated':'deactivated')+'">'+(act?'Activated':'Deactivated')+'</span></td></tr>';
  }).join('')||'<tr class="empty"><td colspan="6">No products found. Click "Add Product" to create one.</td></tr>';
  const nav=$('#inv-pagination');nav.innerHTML='';
  if(pages>1){
    nav.innerHTML='<button data-page="'+(invPage-1)+'" '+(invPage===1?'disabled':'')+'>&lt;</button>'+
      Array.from({length:pages},(_,k)=>'<button data-page="'+(k+1)+'" class="'+(k+1===invPage?'active':'')+'">'+(k+1)+'</button>').join('')+
      '<button data-page="'+(invPage+1)+'" '+(invPage===pages?'disabled':'')+'>&gt;</button>';
    nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{
      if(b.disabled)return;invPage=+b.dataset.page;renderInventory();
    });
  }
  $('#inv-count').textContent=total?'Showing '+(start+1)+'-'+(start+slice.length)+' of '+total:'Showing 0 of 0';
}
['inv-search','inv-cat','inv-status','inv-stock'].forEach(id=>
  $('#'+id).addEventListener('input',()=>{invPage=1;renderInventory()}));
$('#inv-body').addEventListener('click',e=>{
  const row=e.target.closest('tr[data-product-id]');if(!row)return;
  const id=+row.dataset.productId;invSel=invSel===id?null:id;
  $$('#inv-body tr').forEach(t=>t.classList.toggle('sel',+t.dataset.productId===invSel));
});
$('#inv-filter-btn').addEventListener('click',e=>togglePop($('#inv-filter-pop'),e));
$('#inv-edit').onclick=()=>invSel?openProduct(invSel):toast('Select a product row first');
$('#inv-toggle').onclick=async()=>{
  const p=state.products.find(x=>x.id===invSel);
  if(!p)return toast('Select a product row first');
  const enabled=p.active===false;
  if(!confirm((enabled?'Activate':'Deactivate')+' "'+p.name+'"?'))return;
  try{
    await Backend.setProductStatus(p.id,enabled);await refreshAll();
    pushActivity('Product '+(enabled?'activated':'deactivated')+' - '+p.name);
    toast(enabled?'Product activated':'Product deactivated');
  }catch(e){toast(e.message)}
};
async function deleteProduct(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  if(!confirm('Deactivate "'+p.name+'"?'))return;
  try{
    await Backend.deleteProduct(id);await refreshAll();
    pushActivity('Product deactivated - '+p.name);toast('Product deactivated');
  }catch(e){toast(e.message)}
}
function openProduct(id){
  const p=state.products.find(x=>x.id===id);
  $('#ep').textContent='';
  $('#p-title').textContent=p?'Edit product':'Add new product';
  $('#p-id').value=p?p.id:'';
  $('#p-code').value=p?(p.code||codeFor(p.id)):'Assigned after save';
  $('#p-name').value=p?p.name:'';
  $('#p-desc').value=p?p.description||'':'';
  $('#p-cat').value=p?p.category:'';
  $('#p-price').value=p?p.price:'';
  openModal('m-product');
}
$('#btn-add').onclick=()=>openProduct();
$('#btn-save-product').onclick=async()=>{
  const name=$('#p-name').value.trim(),desc=$('#p-desc').value.trim();
  const cat=$('#p-cat').value.trim(),price=Number($('#p-price').value);
  const id=Number($('#p-id').value);
  if(!name||!cat||$('#p-price').value===''||!Number.isFinite(price)||price<0){
    $('#ep').textContent='Please provide product name, category and valid price.';return;
  }
  const button=$('#btn-save-product');button.disabled=true;
  try{
    await Backend.saveProduct({id:id||null,name,description:desc,category:cat,price});
    closeModal('m-product');await refreshAll();
    pushActivity((id?'Product updated':'Product created')+' - '+name);
    toast(id?'Product updated':'New product added');
  }catch(e){$('#ep').textContent=e.message}
  finally{button.disabled=false}
};
function fillEpc(){
  const p=state.products.find(x=>x.id===Number($('#epc-product').value));
  if(!p)return;
  $('#epc-cat').value=p.category;$('#epc-stock').value=p.stock;
  $('#epc-price').value=peso(p.price);$('#epc-code').value='';
  $('#ee').textContent='';
}
/* BATCH RESTOCKING — capture distinct EPCs, then explicitly confirm assignment.
   Never submit whole tray snapshots during a product-selection change. */
const restockDraft=new Set();
let restockPhase='idle',restockBusy=false,restockProductId=null;
const restockMax=100;
function renderRestockDraft(){
  const count=restockDraft.size;
  const el=$('#epc-captured');
  el.textContent=count?
    count+' unique EPC'+(count===1?'':'s')+' ready: '+[...restockDraft].map(x=>esc(x)).join(', '):
    'No EPCs captured yet.';
  const b=$('#epc-arm');
  b.disabled=restockBusy;
  b.textContent=restockPhase==='capturing'?'Stop Scanning ('+count+')':
    restockPhase==='review'?'Register '+count+' Tag'+(count===1?'':'s'):'Start Scanning';
  $('#epc-clear').disabled=restockBusy||restockPhase==='idle'&&count===0;
}
function endRestockCapture(){
  if(window.RFIDScanner)RFIDScanner.disable();
  if(restockPhase==='capturing')restockPhase=restockDraft.size?'review':'idle';
  renderRestockDraft();
}
function resetRestock(){
  if(window.RFIDScanner)RFIDScanner.disable();
  restockDraft.clear();restockPhase='idle';restockProductId=null;
  renderRestockDraft();
}
function openEpc(id){
  const products=state.products.filter(p=>p.active!==false);
  if(!products.length)return toast('Add or activate a product first');
  resetRestock();restockBusy=false;
  $('#epc-product').innerHTML=products.map(p=>
    '<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  if(id)$('#epc-product').value=id;
  fillEpc();openModal('m-epc');
  $('#ee').textContent='Select the product, click Start Scanning, place its tags, then Stop and Register.';
  renderRestockDraft();
}
$('#btn-epc-mode').onclick=()=>openEpc();
$('#epc-product').onchange=()=>{
  if(restockBusy){$('#epc-product').value=restockProductId;return}
  if(restockDraft.size&&!confirm('Discard the pending EPCs for the previous product?')){
    $('#epc-product').value=restockProductId;
    return;
  }
  resetRestock();fillEpc();
  $('#ee').textContent='Ready for another product. Start a new batch.';
};
$('#epc-clear').onclick=()=>{
  if(restockBusy)return;
  resetRestock();$('#ee').textContent='Pending EPCs discarded. No database changes made.';
};
$$('#m-epc [data-close]').forEach(b=>b.addEventListener('click',resetRestock));
$('#epc-arm').onclick=async()=>{
  if(restockBusy)return;
  if(restockPhase==='idle'){
    resetRestock();
    restockProductId=Number($('#epc-product').value);
    if(!state.products.some(p=>p.id===restockProductId&&p.active!==false))
      return $('#ee').textContent='Choose an active product.';
    restockPhase='capturing';
    if(document.activeElement?.blur)document.activeElement.blur();
    if(!window.RFIDScanner){resetRestock();return $('#ee').textContent='RFID scanner script unavailable.'}
    RFIDScanner.enable();
    $('#ee').textContent='Scanning multiple tags for '+state.products.find(p=>p.id===restockProductId).name+
      '. Stop the scan before switching products.';
    renderRestockDraft();return;
  }
  if(restockPhase==='capturing'){
    endRestockCapture();
    $('#ee').textContent=restockDraft.size?
      'Review these tags, then click Register to save the batch.':
      'No tags detected. Check the reader output and try again.';
    return;
  }
  if(restockPhase!=='review'||!restockDraft.size)return;
  const productId=restockProductId,product=state.products.find(p=>p.id===productId);
  if(!product||productId!==Number($('#epc-product').value)){
    resetRestock();return $('#ee').textContent='Product changed. Start a new scan.';
  }
  const epcs=[...restockDraft];
  restockBusy=true;renderRestockDraft();
  try{
    const response=await Backend.registerEpcs(productId,epcs);
    const registered=response.registered_epcs||[];
    const same=response.already_registered_epcs||[];
    const other=response.already_registered_other_product_epcs||[];
    const invalid=response.invalid_epcs||[];
    $('#ee').textContent=registered.length+' added to '+product.name+
      '; '+same.length+' already assigned here; '+other.length+
      ' assigned to OTHER products; '+invalid.length+' invalid.';
    state.products=await Backend.loadProducts();renderInventory();
    $('#epc-stock').value=state.products.find(p=>p.id===productId)?.stock??'';
    $('#epc-code').value=epcs.at(-1)||'';
    if(registered.length)pushActivity('Registered '+registered.length+' RFID tag(s) - '+product.name);
    toast(registered.length+' tag(s) saved for '+product.name);
    // Each batch is bound to exactly one product ID.
    restockDraft.clear();restockPhase='idle';restockProductId=null;
  }catch(error){$('#ee').textContent='Registration failed: '+error.message}
  finally{restockBusy=false;renderRestockDraft()}
};
window.addEventListener('rfid:read',event=>{
  if(restockPhase!=='capturing'||restockBusy||!$('#m-epc').classList.contains('on'))return;
  if(restockProductId!==Number($('#epc-product').value)){resetRestock();return}
  const epc=String(event.detail?.epc||'').trim().toUpperCase();
  if(!epc||restockDraft.has(epc))return;
  if(restockDraft.size>=restockMax){
    endRestockCapture();
    $('#ee').textContent='Maximum of 100 unique tags reached. Review and register this batch.';
    return;
  }
  restockDraft.add(epc);
  $('#epc-code').value=epc;
  renderRestockDraft();
  if(restockDraft.size===restockMax){
    endRestockCapture();
    $('#ee').textContent='100 unique tags captured. Review and register this batch.';
  }
});
