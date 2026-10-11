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
/* ONE-TAG RESTOCKING. A tray snapshot must NEVER be bulk-assigned to the selected product. */
let restockArmed=false,restockBusy=false;
const registeredDuringModal=new Set();
function disarmRestock(){
  restockArmed=false;
  if(window.RFIDScanner)RFIDScanner.disable();
}
function openEpc(id){
  const products=state.products.filter(p=>p.active!==false);
  if(!products.length)return toast('Add or activate a product first');
  disarmRestock();
  $('#epc-product').innerHTML=products.map(p=>
    '<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  if(id)$('#epc-product').value=id;
  registeredDuringModal.clear();restockBusy=false;
  fillEpc();openModal('m-epc');
  $('#epc-arm').textContent='Start Scan';
  $('#ee').textContent='Select ONE product, keep other tags away, then click Start Scan.';
}
$('#btn-epc-mode').onclick=()=>openEpc();
$('#epc-product').onchange=()=>{
  disarmRestock();
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  fillEpc();$('#epc-arm').disabled=false;
  $('#epc-arm').textContent='Start Scan';
  $('#ee').textContent='Remove other tags, then click Start Scan for this product.';
};
$('#epc-arm').onclick=()=>{
  if(restockBusy)return;
  disarmRestock();
  const product=state.products.find(x=>x.id===Number($('#epc-product').value));
  if(!product)return $('#ee').textContent='Select a product first.';
  if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();
  restockArmed=true;$('#epc-arm').textContent='Waiting for tag…';
  $('#ee').textContent='Ready for ONE new EPC for '+product.name+'. Keep other tags away.';
  if(window.RFIDScanner)RFIDScanner.enable();
  else $('#ee').textContent='RFID hardware reader is not available.';
};
$$('#m-epc [data-close]').forEach(b=>b.addEventListener('click',disarmRestock));
window.addEventListener('rfid:epc',async event=>{
  if(!restockArmed||restockBusy||!$('#m-epc').classList.contains('on'))return;
  const selectedId=Number($('#epc-product').value);
  const p=state.products.find(x=>x.id===selectedId);
  if(!p||p.active===false)return;
  const epc=String(event.detail||'').trim().toUpperCase();
  if(!epc||registeredDuringModal.has(epc))return;
  // Stop capture BEFORE awaiting HTTP. Only one EPC can be bound per explicit scan.
  restockBusy=true;disarmRestock();$('#epc-arm').disabled=true;
  $('#epc-code').value=epc;
  $('#ee').textContent='Verifying tag with the database…';
  try{
    const r=await Backend.registerEpcs(selectedId,[epc]);
    const added=(r.registered_epcs||[]).includes(epc);
    const same=(r.already_registered_epcs||[]).includes(epc);
    const other=(r.already_registered_other_product_epcs||[]).includes(epc);
    registeredDuringModal.add(epc);
    if(added){
      state.products=await Backend.loadProducts();renderInventory();
      if(selectedId===Number($('#epc-product').value)){
        const updated=state.products.find(x=>x.id===selectedId);
        if(updated)$('#epc-stock').value=updated.stock;
      }
      pushActivity('RFID tag registered - '+p.name);
      $('#ee').textContent='Registered to '+p.name+'. Move the tag away before scanning another.';
      toast('Stock +1 for '+p.name);
    }else if(other){
      $('#ee').textContent='Tag already belongs to ANOTHER product. Not reassigned. Check RFID records.';
    }else if(same){
      $('#ee').textContent='This tag is already registered to '+p.name+'. No stock added.';
    }else{
      $('#ee').textContent='Tag was not registered. Review the response and try again.';
    }
  }catch(error){$('#ee').textContent=error.message}
  finally{
    restockBusy=false;$('#epc-arm').disabled=false;
    $('#epc-arm').textContent='Scan Next Tag';
  }
});
