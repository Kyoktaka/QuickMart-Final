/* ===== INVENTORY ===== */
const codeFor=id=>'PRD-'+String(id).padStart(4,'0');
const nextProductId=()=>Math.max(0,...state.products.map(x=>x.id))+1;
const INV_PAGE=5;let invPage=1,invSel=null;
function renderInventory(){const cats=[...new Set(state.products.map(p=>p.category))].sort(),cur=$('#inv-cat').value||'all';
  $('#inv-cat').innerHTML='<option value="all">All Categories</option>'+cats.map(c=>`<option ${c===cur?'selected':''}>${esc(c)}</option>`).join('');
  $('#p-cats').innerHTML=cats.map(c=>`<option value="${esc(c)}">`).join('');
  const q=$('#inv-search').value.trim().toLowerCase(),c=$('#inv-cat').value,st=$('#inv-status').value,sk=$('#inv-stock').value;
  $('#inv-filter-btn').classList.toggle('has-filter',st!=='all'||sk!=='all');
  const rows=state.products.filter(p=>p.name.toLowerCase().includes(q)&&(c==='all'||p.category===c)
    &&(st==='all'||(p.active===false?'deactivated':'activated')===st)&&(sk==='all'||p.stock<=LOW));
  const total=rows.length,pages=Math.max(1,Math.ceil(total/INV_PAGE));invPage=Math.min(invPage,pages);
  const start=(invPage-1)*INV_PAGE,slice=rows.slice(start,start+INV_PAGE);
  $('#inv-body').innerHTML=slice.map((p,i)=>{const act=p.active!==false;
    return `<tr data-product-id="${p.id}" class="${p.id===invSel?'sel':''}"><td class="num">${start+i+1}</td><td class="nm">${esc(p.name)}</td><td>${esc(p.category)}</td>
    <td class="center">${p.stock} ${p.stock<=LOW?'<span class="badge b-low">Low</span>':''}</td><td class="center">${peso(p.price)}</td>
    <td class="center"><span class="status ${act?'activated':'deactivated'}">${act?'Activated':'Deactivated'}</span></td></tr>`}).join('')
    ||'<tr class="empty"><td colspan="6">No products found. Click "Add Product" to create one.</td></tr>';
  const nav=$('#inv-pagination');nav.innerHTML='';
  if(pages>1){nav.innerHTML=`<button data-page="${invPage-1}" ${invPage===1?'disabled':''}>&lt;</button>`
    +Array.from({length:pages},(_,k)=>`<button data-page="${k+1}" class="${k+1===invPage?'active':''}">${k+1}</button>`).join('')
    +`<button data-page="${invPage+1}" ${invPage===pages?'disabled':''}>&gt;</button>`;
    nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{if(b.disabled)return;invPage=+b.dataset.page;renderInventory()})}
  $('#inv-count').textContent=total?`Showing ${start+1}-${start+slice.length} of ${total}`:'Showing 0 of 0'}
['inv-search','inv-cat','inv-status','inv-stock'].forEach(id=>$('#'+id).addEventListener('input',()=>{invPage=1;renderInventory()}));
$('#inv-body').addEventListener('click',e=>{const r=e.target.closest('tr[data-product-id]');if(!r)return;
  const id=+r.dataset.productId;invSel=invSel===id?null:id;
  $$('#inv-body tr').forEach(t=>t.classList.toggle('sel',+t.dataset.productId===invSel))});
$('#inv-filter-btn').addEventListener('click',e=>togglePop($('#inv-filter-pop'),e));
$('#inv-edit').onclick=()=>invSel?openProduct(invSel):toast('Select a product row first');
$('#inv-toggle').onclick=async()=>{const p=state.products.find(x=>x.id===invSel);if(!p)return toast('Select a product row first');
  const on=p.active===false;if(!confirm(`${on?'Activate':'Deactivate'} "${p.name}"?`))return;
  p.active=on;await Backend.saveProduct(p);pushActivity(`Product ${on?'activated':'deactivated'} - ${p.name}`);toast(on?'Product activated':'Product deactivated');renderInventory()};

async function deleteProduct(id){
  const p=state.products.find(x=>x.id===id);if(!p)return;
  if(confirm(`Are you sure you want to delete "${p.name}"?`)){
    await Backend.deleteProduct(id);
    state.products=state.products.filter(x=>x.id!==id);
    saveProducts();toast('Product deleted');pushActivity(`Product deleted - ${p.name}`);renderInventory();
  }
}
function openProduct(id){
  const p=state.products.find(x=>x.id===id);
  $('#ep').textContent='';
  $('#p-title').textContent=p?'Edit product':'Add new product';
  $('#p-id').value=p?p.id:'';
  $('#p-code').value=p?(p.code||codeFor(p.id)):codeFor(nextProductId());
  $('#p-name').value=p?p.name:'';$('#p-desc').value=p?(p.description||''):'';
  $('#p-cat').value=p?p.category:'';$('#p-price').value=p?p.price:'';
  openModal('m-product');
}
$('#btn-add').onclick=()=>openProduct();
$('#btn-save-product').onclick=async()=>{
  const name=$('#p-name').value.trim(),desc=$('#p-desc').value.trim(),cat=$('#p-cat').value.trim(),price=parseFloat($('#p-price').value);
  if(!name||!cat||isNaN(price)||price<0)return $('#ep').textContent='Please fill in the product name, category, and a valid price.';
  const id=+$('#p-id').value;let p=state.products.find(x=>x.id===id);
  if(p){Object.assign(p,{name,description:desc,category:cat,price});toast('Product updated')}
  else{const nid=nextProductId();p={id:nid,code:codeFor(nid),name,description:desc,category:cat,stock:0,price,epcs:[]};state.products.push(p);toast('New product added');pushActivity(`Product created - ${name}`)}
  await Backend.saveProduct(p);closeModal('m-product');renderInventory();
};

function fillEpc(){const p=state.products.find(x=>x.id==$('#epc-product').value);if(!p)return;
  $('#epc-cat').value=p.category;$('#epc-stock').value=p.stock;$('#epc-price').value=peso(p.price);$('#epc-code').value='';$('#ee').textContent=''}
function openEpc(id){
  if(!state.products.length)return toast('Add a product first');
  $('#epc-product').innerHTML=state.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(id)$('#epc-product').value=id;fillEpc();openModal('m-epc')}
$('#btn-epc-mode').onclick=()=>openEpc();$('#epc-product').onchange=fillEpc;
window.addEventListener('rfid:epc',async e=>{if(!$('#m-epc').classList.contains('on'))return;const p=state.products.find(x=>x.id==$('#epc-product').value),epc=e.detail;
  if(state.products.some(x=>x.epcs.includes(epc)))return $('#ee').textContent='This EPC is already assigned to a product.';
  if(!(await Backend.assignEpc(p.id,epc)))return $('#ee').textContent='Could not assign EPC. Scan again.';
  p.epcs.push(epc);p.stock++;saveProducts();$('#epc-code').value=epc;$('#epc-stock').value=p.stock;pushActivity(`EPC assigned - ${p.name}`);toast('EPC assigned. Stock +1');renderInventory()});
