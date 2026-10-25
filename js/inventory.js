/* Inventory presentation from the final frontend team, data from PHP/MySQL. */
const INV_PAGE=5,invState={page:1},codeForInv=id=>'PRD-'+String(id).padStart(4,'0');
let invSel=null;
const tagsFor=id=>state.tags.filter(t=>Number(t.product_id)===Number(id));
/* Categories and search ignore upper/lower case: "Egg", "egg" and "EGG" are the same category. */
const lc=v=>String(v??'').trim().toLowerCase();
function categoryList(){
  const seen=new Map();   // lower-case key -> first spelling found
  for(const p of state.products){const k=lc(p.category);if(k&&!seen.has(k))seen.set(k,String(p.category).trim())}
  return [...seen].map(([key,label])=>({key,label})).sort((a,b)=>a.label.localeCompare(b.label));
}
// Typing "egg" when "Egg" is already registered reuses the registered spelling (no duplicate category).
function canonicalCategory(name,exceptId=null){
  const typed=String(name??'').trim(),k=lc(typed);
  const hit=state.products.find(p=>p.id!==exceptId&&lc(p.category)===k);
  return hit?String(hit.category).trim():typed;
}
function renderInventory(){
  const cats=categoryList();
  const cat=$('#inv-cat'),chosen=cat.value||'all';
  cat.innerHTML='<option value="all">All Categories</option>'+cats.map(c=>`<option value="${esc(c.key)}" ${c.key===chosen?'selected':''}>${esc(c.label)}</option>`).join('');
  $('#p-cats').innerHTML=cats.map(c=>`<option value="${esc(c.label)}">`).join('');
  const q=lc($('#inv-search').value),c=cat.value,st=$('#inv-status').value,sk=$('#inv-stock').value;
  $('#inv-filter-btn').classList.toggle('has-filter',st!=='all'||sk!=='all');
  const rows=state.products.filter(p=>(!q||lc(p.name).includes(q)||lc(p.category).includes(q))&&(c==='all'||lc(p.category)===c)&&
    (st==='all'||(p.active===false?'deactivated':'activated')===st)&&
    (sk==='all'||p.stock<=LOW));
  const pages=Math.max(1,Math.ceil(rows.length/INV_PAGE));
  invState.page=Math.min(Math.max(1,invState.page),pages);
  const start=(invState.page-1)*INV_PAGE,pageRows=rows.slice(start,start+INV_PAGE);
  $('#inv-body').innerHTML=pageRows.map((p,i)=>{
    const tags=tagsFor(p.id);
    const tagRows=tags.length?tags.map(t=>{
      const purchased=t.status==='PURCHASED';return `<tr><td><code>${esc(t.epc)}</code></td><td><span class="epc-state ${purchased?'purchased':'active'}">${purchased?'Purchased':esc(t.status)}</span></td></tr>`;
    }).join(''):'<tr><td colspan="2">No EPC tags assigned to this product yet.</td></tr>';
    const active=p.active!==false;
    return `<tr data-product-id="${p.id}" class="${invSel===p.id?'sel':''}">
      <td class="num">${start+i+1}</td>
      <td class="nm"><button type="button" class="epc-toggle" data-epc-toggle="${p.id}" aria-expanded="false"><span class="epc-chevron">▶</span>${esc(p.name)}</button></td>
      <td>${esc(p.category)}</td><td class="description-cell">${esc(p.description||'—')}</td>
      <td class="center">${p.stock} ${p.stock<=LOW?'<span class="badge b-low">Low</span>':''}</td>
      <td class="center">${peso(p.price)}</td>
      <td class="center"><span class="status ${active?'activated':'deactivated'}">${active?'Active':'Inactive'}</span></td></tr>
      <tr class="epc-detail-row" data-epc-detail="${p.id}" hidden><td colspan="7"><div class="epc-detail"><table><thead><tr><th>EPC Tag</th><th>Status</th></tr></thead><tbody>${tagRows}</tbody></table></div></td></tr>`;
  }).join('')||'<tr class="empty"><td colspan="7">No products found.</td></tr>';
  $('#inv-count').textContent=rows.length?`Showing ${start+1}–${start+pageRows.length} of ${rows.length} product${rows.length===1?'':'s'}`:'No products to show';
  renderPager($('#inv-pg'),invState.page,pages,n=>{invState.page=n;renderInventory()});
}
['inv-search','inv-cat','inv-status','inv-stock'].forEach(id=>$('#'+id).addEventListener('input',()=>{invState.page=1;renderInventory()}));
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
  const name=$('#p-name').value.trim(),description=$('#p-desc').value.trim();
  const price=Number($('#p-price').value),id=Number($('#p-id').value);
  const category=canonicalCategory($('#p-cat').value,id||null);
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
  $('#ee').textContent='';
}
/* The EPC list is scanner-only: tags can never be typed or pasted into it. Every unique RFID
   reading appears on its own row, even after Stop Scanning, with a Remove button for a wrong tag. */
let restockPhase='idle',restockProductId=null,restockBusy=false,lastSelectedProductId=null,restockAuthOpen=false;
const pendingEpcs=new Set(),MAX_BATCH=100;
const ignoredEpcs=new Set();   // tags the manager removed: ignored until they leave the reader's range
const TRASH_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const EPC_PATTERN=/^[A-Z0-9:_-]{1,100}$/;
/* Registering EPC tags needs the manager's password every time (PHP checks it again
   in api/rfid/authorize-restock.php + register.php). 3 wrong tries lock the popup for a while. */
let restockLockTimer=null,restockLockUntil=0;
function stopRestockLock(){
  clearInterval(restockLockTimer);restockLockTimer=null;restockLockUntil=0;
  $('#restock-auth-ok').disabled=false;$('#restock-pw').disabled=false;
}
function startRestockLock(seconds){
  clearInterval(restockLockTimer);restockLockUntil=Date.now()+seconds*1000;$('#restock-pw').value='';
  const tick=()=>{
    const left=Math.ceil((restockLockUntil-Date.now())/1000);
    if(left<=0){stopRestockLock();$('#restock-err').textContent='';setTimeout(()=>$('#restock-pw').focus(),30);return}
    $('#restock-auth-ok').disabled=true;$('#restock-pw').disabled=true;
    $('#restock-err').textContent='Too many failed attempts. Try again in '+left+' second'+(left===1?'':'s')+'.';
  };
  tick();restockLockTimer=setInterval(tick,500);
}
function openRestockAuth(){
  const pw=$('#restock-pw');pw.value='';$('#restock-err').textContent='';
  window.RFIDScanner?.disable(); // the reader must never capture the password being typed
  restockAuthOpen=true;openModal('m-restock-auth');
  if(restockLockUntil>Date.now())startRestockLock((restockLockUntil-Date.now())/1000);
  else setTimeout(()=>pw.focus(),60);
}
function closeRestockAuth(){
  const pw=$('#restock-pw');if(pw)pw.value='';
  if(document.activeElement?.closest?.('#m-restock-auth'))document.activeElement.blur();
  restockAuthOpen=false;closeModal('m-restock-auth');
}
function drawPending(){
  const epcs=[...pendingEpcs],count=epcs.length,list=$('#epc-list');
  const html=count?epcs.map(epc=>`<div class="epc-row" role="listitem"><code>${esc(epc)}</code>`+
    `<button type="button" class="epc-del" data-epc-remove="${esc(epc)}" aria-label="Remove EPC ${esc(epc)}"${restockBusy?' disabled':''}>${TRASH_SVG}Remove</button></div>`).join('')
    :'<div class="epc-empty">Scanned RFID tags appear here automatically.</div>';
  // Rebuild only when the rows changed, so a tap on Remove is never lost to a redraw.
  if(drawPending.last!==html){drawPending.last=html;list.innerHTML=html;if(count)list.scrollTop=list.scrollHeight}
  $('#epc-captured').textContent=count+' tag'+(count===1?'':'s');
  $('#epc-arm').textContent=restockPhase==='capturing'?`Stop Scanning (${count})`:restockPhase==='review'?`Register ${count} Tag${count===1?'':'s'}`:'Start Scanning';
  $('#epc-arm').disabled=restockBusy;$('#epc-clear').disabled=restockBusy;
}
/* Remove one wrongly scanned EPC from the batch (nothing is saved until Register + manager password). */
function removePending(epc){
  if(restockBusy||restockAuthOpen||(restockPhase!=='capturing'&&restockPhase!=='review'))return;
  if(!pendingEpcs.delete(epc))return;
  ignoredEpcs.add(epc);   // still lying on the reader? do not add it straight back
  if(!pendingEpcs.size&&restockPhase==='review')restockPhase='idle';
  $('#ee').textContent='Removed '+epc+'. Database unchanged.';
  drawPending();
}
function resetPending(){
  window.RFIDScanner?.disable();pendingEpcs.clear();ignoredEpcs.clear();restockPhase='idle';restockProductId=null;closeRestockAuth();drawPending();
}
function openEpc(id){
  const active=state.products.filter(p=>p.active!==false);
  if(!active.length)return toast('Add or activate a product first');
  resetPending();$('#epc-product').innerHTML=active.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(id)$('#epc-product').value=id;
  lastSelectedProductId=Number($('#epc-product').value);
  fillEpc();openModal('m-epc');
  $('#ee').textContent='Scan tags for the selected product, stop, review, then register the batch.';
}
$('#btn-epc-mode').onclick=()=>openEpc();
$('#epc-product').onchange=()=>{
  const nextProductId=Number($('#epc-product').value);
  if(restockBusy){$('#epc-product').value=String(lastSelectedProductId);return}
  // Ask before discarding captured RFID tags for the previous product.
  const hasCodes=pendingEpcs.size;
  if(hasCodes&&!confirm('Discard pending EPC tags for previous product?')){
    $('#epc-product').value=String(lastSelectedProductId);return;
  }
  resetPending();lastSelectedProductId=nextProductId;fillEpc();
};
$('#epc-clear').onclick=()=>{if(restockBusy)return;resetPending();$('#ee').textContent='Pending EPCs cleared; database unchanged.'};
$$('#m-epc [data-close]').forEach(b=>b.addEventListener('click',resetPending));
$('#epc-arm').onclick=async()=>{
  if(restockBusy)return;
  if(restockPhase==='idle'){
    restockProductId=Number($('#epc-product').value);
    if(!state.products.some(p=>p.id===restockProductId&&p.active!==false))return;
    restockPhase='capturing';document.activeElement?.blur();RFIDScanner.enable();
    $('#ee').textContent='Scanning tags for one selected product. Stop before changing product.';
    drawPending();return;
  }
  if(restockPhase==='capturing'){
    RFIDScanner.disable();
    restockPhase=pendingEpcs.size?'review':'idle';
    $('#ee').textContent=pendingEpcs.size?'Review the captured EPCs, then register the batch (manager password required). The EPC box is display-only.':'No EPCs captured. Check scanner connection.';
    drawPending();return;
  }
  if(restockPhase!=='review')return;
  // The pending Set is the source of truth; never trust textarea text as input.
  if(!pendingEpcs.size){restockPhase='idle';drawPending();$('#ee').textContent='Scan at least one RFID EPC.';return}
  const id=restockProductId,product=state.products.find(p=>p.id===id);
  if(id!==Number($('#epc-product').value)||!product){resetPending();return}
  // Manager permission first; the tags are saved only after the password is verified.
  openRestockAuth();
};
async function registerPending(){
  if(restockBusy||restockPhase!=='review')return;
  if(!pendingEpcs.size){restockPhase='idle';drawPending();$('#ee').textContent='Scan at least one RFID EPC.';return}
  const id=restockProductId,epcs=[...pendingEpcs],product=state.products.find(p=>p.id===id);
  if(id!==Number($('#epc-product').value)||!product){resetPending();return}
  restockBusy=true;drawPending();
  try{const r=await Backend.registerEpcs(id,epcs);
    const registered=r.registered_epcs||[],same=r.already_registered_epcs||[],other=r.already_registered_other_product_epcs||[];
    const invalid=r.invalid_epcs||[];
    await refreshAll();
    $('#epc-stock').value=state.products.find(p=>p.id===id)?.stock??'';
    $('#ee').textContent=registered.length+' registered to '+product.name+'; '+same.length+
      ' already here; '+other.length+' belong to other products; '+invalid.length+' invalid.';
    toast(registered.length+' tags registered');
    pendingEpcs.clear();restockPhase='idle';restockProductId=null;
  }catch(e){
    if(e.data?.authenticated===false){location.replace('login.html');return}
    // Captured tags stay in the box so the manager can just press Register again.
    $('#ee').textContent=e.data?.code==='RESTOCK_AUTH_REQUIRED'
      ?'Manager permission expired. Click Register again and enter the manager password.':e.message;
  }
  finally{restockBusy=false;drawPending()}
}
$('#restock-auth-ok').onclick=async()=>{
  if(restockBusy||Date.now()<restockLockUntil)return;
  if(restockPhase!=='review'||!pendingEpcs.size){closeRestockAuth();return}
  const pw=$('#restock-pw'),err=$('#restock-err'),btn=$('#restock-auth-ok');
  if(!pw.value){err.textContent='Enter the manager password.';return}
  btn.disabled=true;
  try{await Backend.authorizeRestock(pw.value)}
  catch(e){
    if(e.data?.authenticated===false){location.replace('login.html');return}
    err.textContent=e.message;pw.value='';
    if(e.data?.retry_after>0)startRestockLock(e.data.retry_after);else pw.focus();
    return;
  }
  finally{btn.disabled=Date.now()<restockLockUntil}
  closeRestockAuth();
  await registerPending();
};
$('#restock-auth-cancel').onclick=()=>{
  closeRestockAuth();
  if(restockPhase==='review')$('#ee').textContent='Registration cancelled. Captured EPCs are kept; click Register to try again.';
};
$('#restock-pw').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#restock-auth-ok').click()}});
$('#epc-list').addEventListener('click',e=>{
  const btn=e.target?.closest?.('[data-epc-remove]');if(!btn)return;
  removePending(btn.dataset.epcRemove);
});
// A removed tag is accepted again only after the reader stopped seeing it (taken away, then scanned again).
window.addEventListener('rfid:tray',e=>{
  if(!ignoredEpcs.size||restockPhase!=='capturing')return;
  const here=new Set((e.detail||[]).map(String));
  for(const epc of [...ignoredEpcs])if(!here.has(epc))ignoredEpcs.delete(epc);
});
window.addEventListener('rfid:read',e=>{
  if(restockPhase!=='capturing'||restockBusy||!$('#m-epc').classList.contains('on'))return;
  if(restockProductId!==Number($('#epc-product').value)){resetPending();return}
  const epc=String(e.detail?.epc||'').trim().toUpperCase();
  if(!EPC_PATTERN.test(epc)||pendingEpcs.has(epc)||ignoredEpcs.has(epc))return;
  pendingEpcs.add(epc);drawPending();
  if(pendingEpcs.size>=MAX_BATCH){RFIDScanner.disable();restockPhase='review';
    $('#ee').textContent='100 tags captured. Review and register this batch.';drawPending()}
});
if(typeof installPasswordEyes==='function')installPasswordEyes(); // show/hide eye on the manager password box
window.PAGE_RENDER=renderInventory;
/* The browser may auto-fill a saved email into the first text box on the page. Search must start empty,
   so anything that appears before the manager types is wiped. */
(function keepSearchEmpty(input,rerender){
  if(!input)return;let typed=false;
  ['keydown','paste','drop'].forEach(ev=>input.addEventListener(ev,()=>{typed=true}));
  const wipe=()=>{if(!typed&&input.value!==''){input.value='';rerender()}};
  [0,150,500,1200,2500].forEach(ms=>setTimeout(wipe,ms));
  window.addEventListener('pageshow',()=>{if(!typed)wipe()});
})($('#inv-search'),()=>{invState.page=1;renderInventory()});
