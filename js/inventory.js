/* Inventory presentation from the final frontend team, data from PHP/MySQL. */
const INV_PAGE=100000,codeForInv=id=>'PRD-'+String(id).padStart(4,'0');
let invSel=null;
const tagsFor=id=>state.tags.filter(t=>Number(t.product_id)===Number(id));
function renderInventory(){
  const cats=[...new Set(state.products.map(p=>p.category))].filter(Boolean).sort();
  const cat=$('#inv-cat'),chosen=cat.value||'all';
  cat.innerHTML='<option value="all">All Categories</option>'+cats.map(c=>`<option value="${esc(c)}" ${c===chosen?'selected':''}>${esc(c)}</option>`).join('');
  $('#p-cats').innerHTML=cats.map(c=>`<option value="${esc(c)}">`).join('');
  const q=$('#inv-search').value.trim().toLowerCase(),c=cat.value,st=$('#inv-status').value,sk=$('#inv-stock').value;
  $('#inv-filter-btn').classList.toggle('has-filter',st!=='all'||sk!=='all');
  const rows=state.products.filter(p=>p.name.toLowerCase().includes(q)&&(c==='all'||p.category===c)&&
    (st==='all'||(p.active===false?'deactivated':'activated')===st)&&
    (sk==='all'||p.stock<=LOW));
  $('#inv-body').innerHTML=rows.map((p,i)=>{
    const tags=tagsFor(p.id);
    const tagRows=tags.length?tags.map(t=>{
      const purchased=t.status==='PURCHASED';return `<tr><td><code>${esc(t.epc)}</code></td><td><span class="epc-state ${purchased?'purchased':'active'}">${purchased?'Purchased':esc(t.status)}</span></td></tr>`;
    }).join(''):'<tr><td colspan="2">No EPC tags assigned to this product yet.</td></tr>';
    const active=p.active!==false;
    return `<tr data-product-id="${p.id}" class="${invSel===p.id?'sel':''}">
      <td class="num">${i+1}</td>
      <td class="nm"><button type="button" class="epc-toggle" data-epc-toggle="${p.id}" aria-expanded="false"><span class="epc-chevron">▶</span>${esc(p.name)} <span class="badge">${tags.length} EPC</span></button></td>
      <td>${esc(p.category)}</td><td class="description-cell">${esc(p.description||'—')}</td>
      <td class="center">${p.stock} ${p.stock<=LOW?'<span class="badge b-low">Low</span>':''}</td>
      <td class="center">${peso(p.price)}</td>
      <td class="center"><span class="status ${active?'activated':'deactivated'}">${active?'Active':'Inactive'}</span></td></tr>
      <tr class="epc-detail-row" data-epc-detail="${p.id}" hidden><td colspan="7"><div class="epc-detail"><table><thead><tr><th>EPC Tag</th><th>Status</th></tr></thead><tbody>${tagRows}</tbody></table></div></td></tr>`;
  }).join('')||'<tr class="empty"><td colspan="7">No products found.</td></tr>';
  $('#inv-count').textContent=`${rows.length} product${rows.length===1?'':'s'} · scroll to view all`;
}
['inv-search','inv-cat','inv-status','inv-stock'].forEach(id=>$('#'+id).addEventListener('input',renderInventory));
$('#inv-body').addEventListener('click',e=>{
  const tog=e.target.closest('[data-epc-toggle]');
  if(tog){e.stopPropagation();const row=$(`#inv-body tr[data-epc-detail="${tog.dataset.epcToggle}"]`);
    const open=tog.getAttribute('aria-expanded')!=='true';tog.setAttribute('aria-expanded',String(open));if(row)row.hidden=!open;return}
  const r=e.target.closest('tr[data-product-id]');if(!r)return;
  const id=Number(r.dataset.productId);invSel=invSel===id?null:id;
  $$('#inv-body tr[data-product-id]').forEach(row=>row.classList.toggle('sel',+row.dataset.productId===invSel));
});
$('#inv-filter-btn').onclick=e=>togglePop($('#inv-filter-pop'),e);
$('#inv-edit').onclick=()=>invSel?openProduct(invSel):toast('Select a product row first');
$('#inv-toggle').onclick=async()=>{
  const p=state.products.find(x=>x.id===invSel);if(!p)return toast('Select a product row first');
  const active=p.active===false;
  if(!confirm((active?'Activate':'Deactivate')+' "'+p.name+'"?'))return;
  try{await Backend.setProductStatus(p.id,active);await refreshAll();toast(active?'Product activated':'Product deactivated')}
  catch(e){toast(e.message,'error')}
};
function openProduct(id){
  const p=state.products.find(x=>x.id===Number(id));
  $('#ep').textContent='';$('#p-title').textContent=p?'Edit product':'Add new product';
  $('#p-id').value=p?p.id:'';
  $('#p-code').value=p?(p.code||codeForInv(p.id)):'Assigned after save';
  $('#p-name').value=p?p.name:'';$('#p-desc').value=p?p.description||'':'';
  $('#p-cat').value=p?p.category:'';$('#p-price').value=p?p.price:'';
  openModal('m-product');setTimeout(()=>$('#p-name').focus(),60);
}
$('#btn-add').onclick=()=>openProduct();
$('#btn-save-product').onclick=async()=>{
  const name=$('#p-name').value.trim(),description=$('#p-desc').value.trim(),category=$('#p-cat').value.trim();
  const price=Number($('#p-price').value),id=Number($('#p-id').value);
  if(!name||!category||$('#p-price').value===''||!Number.isFinite(price)||price<0)
    return $('#ep').textContent='Provide product name, category and valid price.';
  const btn=$('#btn-save-product');btn.disabled=true;
  try{await Backend.saveProduct({id:id||null,name,description,category,price});closeModal('m-product');await refreshAll();
    toast(id?'Product updated':'New product added')}
  catch(e){$('#ep').textContent=e.message}finally{btn.disabled=false}
};
function fillEpc(){
  const p=state.products.find(x=>x.id===Number($('#epc-product').value));if(!p)return;
  $('#epc-cat').value=p.category;$('#epc-stock').value=p.stock;$('#epc-price').value=peso(p.price);
  $('#epc-code').value='';$('#ee').textContent='';
}
/* Scan many EPCs into ONE editable multiline list. A USB keyboard-emulation
   reader types EPCs as keystrokes, so scan capture is only enabled on the
   intentional inventory Scan stage, never while editing the EPC field. */
let restockPhase='idle',restockProductId=null,restockBusy=false;
const pendingEpcs=new Set(),MAX_BATCH=100;
const EPC_PATTERN=/^[A-Z0-9:_-]{1,100}$/;
function parseEpcEditor(){
  const raw=$('#epc-code').value.trim();
  const tokens=raw?raw.split(/[\s,;]+/).filter(Boolean):[];
  const values=[...new Set(tokens.map(epc=>epc.toUpperCase()))];
  if(values.length>MAX_BATCH)return {error:'Maximum '+MAX_BATCH+' unique EPC tags per registration batch.'};
  const invalid=values.filter(epc=>!EPC_PATTERN.test(epc));
  if(invalid.length)return {error:'Invalid EPC format: '+invalid.slice(0,3).join(', ')};
  return {values};
}
function importEpcEditor(){
  const parsed=parseEpcEditor();
  if(parsed.error){$('#ee').textContent=parsed.error;return false}
  pendingEpcs.clear();
  parsed.values.forEach(epc=>pendingEpcs.add(epc));
  $('#ee').textContent='';
  return true;
}
function drawPending(syncList=false){
  const count=pendingEpcs.size,field=$('#epc-code');
  field.readOnly=restockBusy||restockPhase==='capturing';
  if(syncList)field.value=[...pendingEpcs].join('\n');
  $('#epc-captured').textContent=count+' tag'+(count===1?'':'s');
  $('#epc-arm').textContent=restockPhase==='capturing'?`Stop Scanning (${count})`:restockPhase==='review'?`Register ${count} Tag${count===1?'':'s'}`:'Start Scanning';
  $('#epc-arm').disabled=restockBusy;$('#epc-clear').disabled=restockBusy;
}
function resetPending(){
  window.RFIDScanner?.disable();pendingEpcs.clear();restockPhase='idle';restockProductId=null;drawPending(true);
}
function openEpc(id){
  const active=state.products.filter(p=>p.active!==false);
  if(!active.length)return toast('Add or activate a product first');
  resetPending();$('#epc-product').innerHTML=active.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(id)$('#epc-product').value=id;
  fillEpc();openModal('m-epc');
  $('#ee').textContent='Scan tags for the selected product, stop, review, then register the batch.';
}
$('#btn-epc-mode').onclick=()=>openEpc();
$('#epc-product').onchange=()=>{
  if(restockBusy){$('#epc-product').value=restockProductId;return}
  // Include manually typed EPCs in the discard confirmation.
  const hasCodes=pendingEpcs.size||$('#epc-code').value.trim();
  if(hasCodes&&!confirm('Discard pending EPC tags for previous product?')){
    $('#epc-product').value=restockProductId||$('#epc-product').value;return;
  }
  resetPending();fillEpc();
};
$('#epc-code').addEventListener('input',()=>{
  if(restockBusy||restockPhase==='capturing')return;
  const parsed=parseEpcEditor();
  if(parsed.error){$('#ee').textContent=parsed.error;return}
  pendingEpcs.clear();parsed.values.forEach(epc=>pendingEpcs.add(epc));
  $('#ee').textContent='';
  drawPending(false);
});
$('#epc-clear').onclick=()=>{if(restockBusy)return;resetPending();$('#ee').textContent='Pending EPCs cleared; database unchanged.'};
$$('#m-epc [data-close]').forEach(b=>b.addEventListener('click',resetPending));
$('#epc-arm').onclick=async()=>{
  if(restockBusy)return;
  if(restockPhase==='idle'){
    if(!importEpcEditor())return;
    restockProductId=Number($('#epc-product').value);
    if(!state.products.some(p=>p.id===restockProductId&&p.active!==false))return;
    restockPhase='capturing';document.activeElement?.blur();RFIDScanner.enable();
    $('#ee').textContent='Scanning tags for one selected product. Stop before changing product.';
    drawPending(true);return;
  }
  if(restockPhase==='capturing'){
    RFIDScanner.disable();
    // The field was readonly while scanning; it can now be edited.
    restockPhase=pendingEpcs.size?'review':'idle';
    $('#ee').textContent=pendingEpcs.size?'Review the EPC list. You may edit it before registration.':'No EPCs captured. Check scanner connection.';
    drawPending(true);return;
  }
  if(restockPhase!=='review')return;
  // Edits and manual pasted additions/removals are reflected in final batch.
  if(!importEpcEditor())return;
  if(!pendingEpcs.size){restockPhase='idle';drawPending(true);$('#ee').textContent='Enter or scan at least one EPC.';return}
  const id=restockProductId,epcs=[...pendingEpcs],product=state.products.find(p=>p.id===id);
  if(id!==Number($('#epc-product').value)||!product){resetPending();return}
  restockBusy=true;drawPending(true);
  try{const r=await Backend.registerEpcs(id,epcs);
    const registered=r.registered_epcs||[],same=r.already_registered_epcs||[],other=r.already_registered_other_product_epcs||[];
    const invalid=r.invalid_epcs||[];
    await refreshAll();
    $('#epc-stock').value=state.products.find(p=>p.id===id)?.stock??'';
    $('#ee').textContent=registered.length+' registered to '+product.name+'; '+same.length+
      ' already here; '+other.length+' belong to other products; '+invalid.length+' invalid.';
    toast(registered.length+' tags registered');
    pendingEpcs.clear();restockPhase='idle';restockProductId=null;
  }catch(e){$('#ee').textContent=e.message}
  finally{restockBusy=false;drawPending(!pendingEpcs.size)}
};
window.addEventListener('rfid:read',e=>{
  if(restockPhase!=='capturing'||restockBusy||!$('#m-epc').classList.contains('on'))return;
  if(restockProductId!==Number($('#epc-product').value)){resetPending();return}
  const epc=String(e.detail?.epc||'').trim().toUpperCase();
  if(!EPC_PATTERN.test(epc)||pendingEpcs.has(epc))return;
  pendingEpcs.add(epc);drawPending(true);
  if(pendingEpcs.size>=MAX_BATCH){RFIDScanner.disable();restockPhase='review';
    $('#ee').textContent='100 tags captured. Review and register this batch.';drawPending(true)}
});
window.PAGE_RENDER=renderInventory;
