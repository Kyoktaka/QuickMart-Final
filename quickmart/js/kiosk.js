/* kiosk.js */
function screen(id){$$('.screen').forEach(s=>s.classList.toggle('on',s.id===id));$('#kiosk').classList.toggle('idle',id==='k-idle');$('#kiosk').classList.toggle('cartview',id==='k-cart');if(id!=='k-qr'){stopTimer();stopCameraScanner()}}
let timerId=null,left=TIMEOUT;
const cartTotal=()=>state.cart.reduce((a,i)=>a+i.price*i.qty,0),cartQty=()=>state.cart.reduce((a,i)=>a+i.qty,0);
function stopTimer(){clearInterval(timerId);timerId=null}
function startTimer(){stopTimer();left=TIMEOUT;drawTimer();timerId=setInterval(()=>{left--;drawTimer();if(left<=0){stopTimer();stopCameraScanner();
  const reason='Payment timed out after 5 minutes.';$('#fail-reason').textContent=reason;finalize('failed',reason);screen('k-fail')}},1000)}
function drawTimer(){$('#qr-timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')}
function renderCart(){$('#cart-body').innerHTML=state.cart.map((i,n)=>`<tr data-product-id="${i.id}"><td>${n+1}</td><td>${esc(i.name)}</td><td class="pid">${esc(i.code||codeFor(i.id))}</td><td>${peso(i.price)}</td><td>${i.qty}</td><td><b>${peso(i.price*i.qty)}</b></td></tr>`).join('');
  $('#sum-items').textContent=cartQty();$('#sum-tax').textContent=peso(0);$('#sum-total').textContent=peso(cartTotal());$('#qr-total').textContent=peso(cartTotal())}

async function finalize(status,failReason){
  const itemsDetail=state.cart.flatMap(i=>(i.scanned||[]).map(epc=>({epc,name:i.name,qty:1,price:i.price})));
  const ex=state.sessions.findIndex(x=>x.id===state.current),prev=ex>=0?state.sessions[ex].failReason:null;
  const s={id:state.current,date:new Date(),items:cartQty(),amount:cartTotal(),status,itemsDetail,failReason:status==='success'?null:(failReason||prev||null)};
  ex>=0?state.sessions[ex]=s:state.sessions.unshift(s);
  if(status==='success')state.cart.forEach(i=>{
    const p=state.products.find(x=>x.id===i.id);
    if(p){p.stock=Math.max(0,p.stock-i.qty);p.epcs=p.epcs.filter(x=>!(i.scanned||[]).includes(x))}
  });
  saveProducts();
  await Backend.saveSession(s);
  pushActivity(`Session ${s.id.slice(-4)} ${status==='success'?'Completed':status==='failed'?'Failed':'Cancelled'} - ${peso(s.amount)}`);
  return s;
}
function resetKiosk(){stopTimer();stopCameraScanner();state.cart=[];state.current=null;state.processing=false;closeModal('m-tag');closeModal('m-blocked');screen('k-idle')}
async function exitKiosk(){if(state.cart.length&&state.current){const ex=state.sessions.find(x=>x.id===state.current);if(!ex||ex.status!=='failed')await finalize('cancelled')}
  state.kioskOn=false;resetKiosk();sessionStorage.removeItem(SS_KIOSK);location.href='dashboard.html'}
$('#btn-kiosk-exit').onclick=()=>openAuth(exitKiosk,2,true);

window.addEventListener('rfid:tray',e=>{if(!state.kioskOn||!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on'))return;
  const m={};[...new Set(e.detail)].forEach(epc=>{const p=state.products.find(p=>p.active!==false&&p.epcs.includes(epc));if(p)(m[p.id]=m[p.id]||[]).push(epc)});
  [...new Set(e.detail)].forEach(epc=>{if(!state.products.some(p=>p.active!==false&&p.epcs.includes(epc))){const n=purchasedName(epc);if(n)notifyBlocked(epc,n)}});
  state.cart=Object.entries(m).map(([id,epcs])=>({...state.products.find(p=>p.id==id),qty:epcs.length,scanned:epcs}));
  if(!state.cart.length){state.current=null;return screen('k-idle')}
  if(!state.current)state.current=Backend.newSessionId();
  renderCart();screen('k-cart')});
$('#btn-checkout').onclick=()=>{renderCart();screen('k-qr');startTimer();startCameraScanner()};
$('#btn-retry').onclick=()=>{screen('k-qr');startTimer();startCameraScanner()};
$('#btn-qr-back').onclick=()=>screen('k-cart');
$('#btn-cancel-scan').onclick=async()=>{await stopCameraScanner();stopTimer();await finalize('cancelled');resetKiosk();toast('Payment cancelled')};
async function completePayment(){stopTimer();await stopCameraScanner();const s=await finalize('success');
  $('#ok-sid').textContent=s.id;
  $('#ok-receipt').innerHTML=state.cart.map(i=>`<div class="row"><span>${i.qty} × ${esc(i.name)}</span><span>${peso(i.price*i.qty)}</span></div>`).join('')+`<div class="row tot" style="font-size:18px"><span>Total (${s.items} items)</span><span>${peso(s.amount)}</span></div>`;
  state.cart=[];state.current=null;screen('k-success')}
async function cancelOrder(){if(state.current)await finalize('cancelled');resetKiosk();toast('Order cancelled')}
$('#btn-cancel').onclick=cancelOrder;$('#btn-cancel2').onclick=cancelOrder;$('#btn-new').onclick=resetKiosk;
function addManualTag(inputId){const field=$('#'+inputId),epc=field.value.trim();if(!epc)return toast('Enter an EPC tag code first','error');const product=state.products.find(p=>p.active!==false&&(p.epcs||[]).some(tag=>String(tag).toLowerCase()===epc.toLowerCase()));if(!product){const sold=purchasedName(epc);if(sold){showBlocked(sold);return}return toast('EPC tag not found or product is inactive','error')}let item=state.cart.find(i=>i.id===product.id);if(item){if((item.scanned||[]).some(tag=>tag.toLowerCase()===epc.toLowerCase()))return toast('This EPC tag is already in the cart','error');item.qty++;item.scanned.push(epc)}else state.cart.push({...product,qty:1,scanned:[epc]});if(!state.current)state.current=Backend.newSessionId();field.value='';renderCart();screen('k-cart');toast(product.name+' added to cart')}
function purchasedName(epc){const k=String(epc).trim().toLowerCase();for(const s of state.sessions){if(s.status!=='success')continue;const hit=(s.itemsDetail||[]).find(x=>String(x.epc).toLowerCase()===k);if(hit)return hit.name||'This product'}return null}
let blockedTimer=null;const blockedSeen={};
function showBlocked(name){closeModal('m-tag');$('#tag-modal-input').value='';$('#blk-name').textContent=name;openModal('m-blocked');clearTimeout(blockedTimer);blockedTimer=setTimeout(()=>closeModal('m-blocked'),4000)}
function notifyBlocked(epc,name){const now=Date.now();if(blockedSeen[epc]&&now-blockedSeen[epc]<8000)return;blockedSeen[epc]=now;showBlocked(name)}
function openTagModal(){$('#tag-modal-input').value='';openModal('m-tag');setTimeout(()=>$('#tag-modal-input').focus(),60)}
function submitTagModal(){const f=$('#tag-modal-input');if(!f.value.trim())return toast('Enter an EPC tag code first','error');addManualTag('tag-modal-input');if(!f.value)closeModal('m-tag')}
$('#btn-idle-tag').onclick=openTagModal;$('#btn-input-tag-toggle').onclick=openTagModal;
$('#tag-modal-confirm').onclick=submitTagModal;
$('#tag-modal-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitTagModal()}});
$('#m-tag').addEventListener('click',e=>{if(e.target.id==='m-tag')closeModal('m-tag')});
$('#m-blocked').addEventListener('click',()=>{clearTimeout(blockedTimer);closeModal('m-blocked')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('m-tag');closeModal('m-blocked')}});

/* page init */
state.kioskOn=true;resetKiosk();
