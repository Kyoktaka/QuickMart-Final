/* Original QuickMart kiosk design, server-authoritative RFID and transactions. */
let timerId=null,left=TIMEOUT,trayRevision=0,emptyTimer=null,blockedTimer=null;
let detectDebounce=null,detectInFlight=false,latestSnapshot=[];
const loggedSessions=new Set(),manuallyEnteredEpcs=new Set(),blockedShownAt=new Map();
const cartTotal=()=>state.cart.reduce((n,i)=>n+i.price*i.qty,0);
const cartQty=()=>state.cart.reduce((n,i)=>n+i.qty,0);
function stopTimer(){clearInterval(timerId);timerId=null}
function screen(id){
  $$('.screen').forEach(el=>el.classList.toggle('on',el.id===id));
  $('#kiosk').classList.toggle('idle',id==='k-idle');
  $('#kiosk').classList.toggle('cartview',id==='k-cart');
  if(id!=='k-qr'){stopTimer();stopCameraScanner()}
  RFIDScanner.setEnabled(state.kioskOn&&(id==='k-idle'||id==='k-cart')&&!$('#m-auth').classList.contains('on'));
}
function renderCart(){
  $('#cart-body').innerHTML=state.cart.map((i,n)=>`<tr data-product-id="${i.id}">
    <td>${n+1}</td><td>${esc(i.name)}</td><td class="pid">${esc(i.code||codeFor(i.id))}</td>
    <td>${peso(i.price)}</td><td>${i.qty}</td><td><b>${peso(i.price*i.qty)}</b></td></tr>`).join('')||
    '<tr><td colspan="6">No RFID products detected.</td></tr>';
  $('#sum-items').textContent=cartQty();$('#sum-tax').textContent=peso(0);
  $('#sum-total').textContent=peso(cartTotal());$('#qr-total').textContent=peso(cartTotal());
}
function drawTimer(){$('#qr-timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')}
function startTimer(){stopTimer();left=TIMEOUT;drawTimer();timerId=setInterval(()=>{
  left--;drawTimer();if(left<=0){stopTimer();stopCameraScanner();
    const reason='Payment timed out after 5 minutes.';
    $('#fail-reason').textContent=reason;void finalize('failed',reason);screen('k-fail');
  }
},1000)}
async function finalize(status,reason){
  if(!state.current||loggedSessions.has(state.current))return;
  const session={id:state.current,items:cartQty(),amount:cartTotal(),status};
  try{await Backend.logSession(session);loggedSessions.add(session.id);pushActivity('Session '+session.id.slice(-8)+' '+status+' - '+peso(session.amount))}
  catch(e){toast('Could not save checkout attempt: '+e.message,'error')}
}
function resetKiosk(){
  clearTimeout(emptyTimer);emptyTimer=null;clearTimeout(detectDebounce);detectDebounce=null;
  latestSnapshot=[];clearTimeout(blockedTimer);stopTimer();stopCameraScanner();trayRevision++;
  state.cart=[];state.current=null;state.processing=false;manuallyEnteredEpcs.clear();
  closeModal('m-tag');closeModal('m-blocked');screen('k-idle');
}
async function exitKiosk(){
  if(state.processing){toast('Payment is being verified. Please wait.');return}
  if(state.current&&state.cart.length&&!loggedSessions.has(state.current))await finalize('cancelled','Manager exited');
  try{await Backend.revokeScan()}catch(e){toast(e.message,'error');return}
  state.kioskOn=false;RFIDScanner.disable();sessionStorage.removeItem(SS_KIOSK);location.href='dashboard.html';
}
$('#btn-kiosk-exit').onclick=()=>openAuth(exitKiosk,2,true);
function showBlocked(name){
  closeModal('m-tag');$('#tag-modal-input').value='';$('#blk-name').textContent=name;
  openModal('m-blocked');clearTimeout(blockedTimer);blockedTimer=setTimeout(()=>closeModal('m-blocked'),4000);
}
function notifyBlocked(epc){
  const now=Date.now();if(now-(blockedShownAt.get(epc)||0)<8000)return;
  blockedShownAt.set(epc,now);
  const tag=state.tags.find(t=>String(t.epc).toUpperCase()===epc);
  const product=state.products.find(p=>p.id===Number(tag?.product_id));
  showBlocked(product?.name||'RFID '+epc);
}
// Reader events may report 20 EPCs in rapid bursts. Coalesce snapshots and
// serialize PHP lookups so stale responses never flash partial carts on screen.
function queueTray(snapshot){
  latestSnapshot=[...new Set([...snapshot,...manuallyEnteredEpcs]
    .map(epc=>String(epc).trim().toUpperCase()).filter(Boolean))];
  const revision=++trayRevision;
  clearTimeout(detectDebounce);detectDebounce=null;
  clearTimeout(emptyTimer);emptyTimer=null;
  if(!latestSnapshot.length){
    emptyTimer=setTimeout(()=>{
      if(revision!==trayRevision||!state.kioskOn||!RFIDScanner.isEnabled()||
        RFIDScanner.getPresentEpcs().length||manuallyEnteredEpcs.size)return;
      state.cart=[];state.current=null;renderCart();screen('k-idle');
    },1200);
    return;
  }
  // This short internal debounce is NOT an expiry timer or visible countdown.
  detectDebounce=setTimeout(()=>{detectDebounce=null;
    void refreshTray(latestSnapshot,revision);
  },180);
}
async function refreshTray(epcs,revision){
  if(detectInFlight||!state.kioskOn||!RFIDScanner.isEnabled())return;
  detectInFlight=true;
  try{
    const res=await Backend.detect(epcs);
    if(revision!==trayRevision||!state.kioskOn||$('#k-qr').classList.contains('on'))return;
    state.cart=(res.grouped_items||[]).map(item=>({
      id:Number(item.product_id),name:item.product_name,code:codeFor(item.product_id),
      price:Number(item.unit_price),qty:Number(item.quantity),scanned:item.epcs||[]
    }));
    for(const epc of res.purchased_epcs||[])notifyBlocked(epc);
    if(res.unknown_epcs?.length)toast(res.unknown_epcs.length+' unknown EPC(s) ignored','error');
    if(res.inactive_epcs?.length)toast(res.inactive_epcs.length+' inactive EPC(s) ignored','error');
    if(!state.cart.length){state.current=null;renderCart();screen('k-idle');return}
    if(!state.current)state.current=Backend.newSessionId();
    renderCart();screen('k-cart');
  }catch(e){
    if(revision===trayRevision)toast('RFID detection delayed: '+e.message,'error');
    // A database/network failure must NOT clear a verified cart.
  }finally{
    detectInFlight=false;
    // Never discard a newer tray state just because an older lookup was busy.
    if(revision!==trayRevision&&latestSnapshot.length&&state.kioskOn&&RFIDScanner.isEnabled()){
      clearTimeout(detectDebounce);
      const latestRevision=trayRevision;
      detectDebounce=setTimeout(()=>{detectDebounce=null;
        void refreshTray(latestSnapshot,latestRevision);
      },100);
    }
  }
}
window.addEventListener('rfid:tray',e=>{
  if(!state.kioskOn||(!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on'))||!RFIDScanner.isEnabled())return;
  queueTray(e.detail||[]);
});
function openTagModal(){
  $('#tag-modal-input').value='';openModal('m-tag');setTimeout(()=>$('#tag-modal-input').focus(),60);
}
async function submitTagModal(){
  const field=$('#tag-modal-input'),epc=field.value.trim().replace(/\s+/g,'').toUpperCase();
  if(!epc)return toast('Enter a tag first','error');
  if(!/^[A-Z0-9:_-]{1,100}$/.test(epc))return toast('Invalid EPC','error');
  if(manuallyEnteredEpcs.has(epc)||state.cart.some(i=>i.scanned.includes(epc)))return toast('Tag already in cart','error');
  try{
    const r=await Backend.detect([epc]);
    if(r.purchased_epcs?.includes(epc)){notifyBlocked(epc);return}
    if(!r.grouped_items?.length){toast('EPC not registered or product unavailable','error');return}
    manuallyEnteredEpcs.add(epc);field.value='';closeModal('m-tag');
    queueTray(RFIDScanner.getPresentEpcs());
  }catch(e){toast(e.message,'error')}
}
$('#btn-idle-tag').onclick=openTagModal;$('#btn-input-tag-toggle').onclick=openTagModal;
$('#tag-modal-confirm').onclick=submitTagModal;
$('#tag-modal-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void submitTagModal()}});
$('#m-tag').addEventListener('click',e=>{if(e.target.id==='m-tag')closeModal('m-tag')});
$('#m-blocked').addEventListener('click',()=>{clearTimeout(blockedTimer);closeModal('m-blocked')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('m-tag');closeModal('m-blocked')}});
$('#btn-checkout').onclick=()=>{if(!state.cart.length)return toast('Scan a product first','error');
  renderCart();screen('k-qr');startTimer();void startCameraScanner()};
$('#btn-retry').onclick=()=>{state.current=Backend.newSessionId();screen('k-qr');startTimer();void startCameraScanner()};
$('#btn-qr-back').onclick=()=>{screen('k-cart');queueTray(RFIDScanner.getPresentEpcs());};
$('#btn-cancel-scan').onclick=async()=>{stopTimer();await stopCameraScanner();await finalize('cancelled','Customer cancelled');resetKiosk()};
async function completePayment(receipt){
  stopTimer();await stopCameraScanner();
  const cart=[...state.cart],items=Number(receipt.total_items),amount=Number(receipt.total_amount);
  $('#ok-sid').textContent=receipt.session_id;
  $('#ok-receipt').innerHTML=cart.map(i=>`<div class="row"><span>${i.qty} × ${esc(i.name)}</span><span>${peso(i.price*i.qty)}</span></div>`).join('')+
    `<div class="row tot" style="font-size:18px"><span>Total (${items} items)</span><span>${peso(amount)}</span></div>`;
  loggedSessions.add(receipt.session_id);
  state.cart=[];state.current=null;manuallyEnteredEpcs.clear();screen('k-success');
}
async function cancelOrder(){if(state.current&&!loggedSessions.has(state.current))await finalize('cancelled','Customer cancelled checkout');resetKiosk()}
$('#btn-cancel').onclick=cancelOrder;$('#btn-cancel2').onclick=cancelOrder;$('#btn-new').onclick=resetKiosk;
// Activated only after manager authorization in the Product Recognition page.
state.kioskOn=false;resetKiosk();
