/* ===== SELF-CHECKOUT: SERVER-VALIDATED EPCs AND DEMO QR ===== */
let timerId=null,left=TIMEOUT,trayRevision=0,emptyTrayTimer=null;
const loggedSessions=new Set();
const cartTotal=()=>state.cart.reduce((n,i)=>n+i.price*i.qty,0);
const cartQty=()=>state.cart.reduce((n,i)=>n+i.qty,0);
function stopTimer(){clearInterval(timerId);timerId=null}
function screen(id){
  $$('.screen').forEach(s=>s.classList.toggle('on',s.id===id));
  $('#kiosk').classList.toggle('idle',id==='k-idle');
  if(id!=='k-qr'){stopTimer();stopCameraScanner()}
  if(window.RFIDScanner){
    RFIDScanner.setEnabled(state.kioskOn&&(id==='k-idle'||id==='k-cart'));
  }
}
function drawTimer(){
  $('#qr-timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');
}
function startTimer(){
  stopTimer();left=TIMEOUT;drawTimer();
  timerId=setInterval(()=>{
    left--;drawTimer();
    if(left<=0){
      stopTimer();stopCameraScanner();
      const reason='Demo payment timed out after 5 minutes.';
      $('#fail-reason').textContent=reason;
      void finalize('failed',reason);
      screen('k-fail');
    }
  },1000);
}
function renderCart(){
  $('#cart-body').innerHTML=state.cart.map(i=>
    '<tr data-product-id="'+i.id+'"><td>'+esc(i.name)+'</td><td>'+peso(i.price)+
    '</td><td>'+i.qty+'</td><td><b>'+peso(i.price*i.qty)+'</b></td></tr>'
  ).join('')||'<tr><td colspan="4">No RFID products detected.</td></tr>';
  $('#sum-items').textContent=cartQty();$('#sum-tax').textContent=peso(0);
  $('#sum-total').textContent=peso(cartTotal());$('#qr-total').textContent=peso(cartTotal());
}
async function finalize(status,reason){
  if(!state.current||loggedSessions.has(state.current))return;
  const s={id:state.current,date:new Date(),items:cartQty(),amount:cartTotal(),status};
  try{
    await Backend.logSession(s);loggedSessions.add(s.id);
    state.sessions.unshift({...s,failReason:reason||null});
    pushActivity('Session '+s.id.slice(-8)+' '+(status==='failed'?'Failed':'Cancelled')+
      ' - '+peso(s.amount));
    try{await refreshAll()}catch(e){console.warn('Transaction refresh failed:',e.message)}
  }catch(e){toast('Could not record checkout attempt: '+e.message)}
}
function resetKiosk(){
  clearTimeout(emptyTrayTimer);emptyTrayTimer=null;
  stopTimer();stopCameraScanner();trayRevision++;
  state.cart=[];state.current=null;state.processing=false;
  $('#assist-banner').classList.remove('on');$('#btn-assist').disabled=false;
  screen('k-idle');
}
async function enterKiosk(){
  state.kioskOn=true;$('#kiosk').classList.add('on');resetKiosk();
  pushActivity('Customer scanning terminal started.');
}
async function exitKiosk(){
  if(state.processing){toast('Checkout is being verified. Please wait.');return}
  if(state.current&&state.cart.length&&!loggedSessions.has(state.current)){
    await finalize('cancelled','Scanning session exited.');
  }
  try{await Backend.revokeScan()}catch(e){toast(e.message)}
  state.kioskOn=false;$('#kiosk').classList.remove('on');resetKiosk();
  goTab('dashboard');
}
$('#btn-start-scan').onclick=()=>openAuth(enterKiosk,2,true);
$('#btn-kiosk-exit').onclick=()=>openAuth(exitKiosk,2,true);
window.addEventListener('rfid:tray',async e=>{
  if(!state.kioskOn||(!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on')))return;
  // Disabling the scanner for password entry clears its cache. That is not tag removal.
  if(window.RFIDScanner&&!RFIDScanner.isEnabled())return;
  const epcs=[...new Set((e.detail||[]).map(v=>String(v).trim().toUpperCase()))];
  const revision=++trayRevision;
  clearTimeout(emptyTrayTimer);emptyTrayTimer=null;
  if(!epcs.length){
    // Confirm absence before clearing the cart. RFID missed reads are common
    // when several tags are close together. A new read cancels this removal.
    emptyTrayTimer=setTimeout(()=>{
      if(revision!==trayRevision||!state.kioskOn||
         !window.RFIDScanner?.isEnabled()||
         window.RFIDScanner.getPresentEpcs().length)return;
      state.cart=[];state.current=null;renderCart();screen('k-idle');
    },1200);
    return;
  }
  try{
    const result=await Backend.detect(epcs);
    if(revision!==trayRevision||!state.kioskOn)return;
    state.cart=(result.grouped_items||[]).map(item=>({
      id:Number(item.product_id),name:item.product_name,
      price:Number(item.unit_price),qty:Number(item.quantity),scanned:item.epcs||[]
    }));
    if(result.unknown_epcs?.length)toast(result.unknown_epcs.length+' unregistered RFID tag(s) ignored.');
    if(result.purchased_epcs?.length)toast(result.purchased_epcs.length+' previously purchased tag(s) ignored.');
    if(result.inactive_epcs?.length)toast(result.inactive_epcs.length+' unavailable tag(s) ignored.');
    if(!state.cart.length){state.current=null;renderCart();screen('k-idle');return}
    if(!state.current)state.current=Backend.newSessionId();
    renderCart();screen('k-cart');
  }catch(error){
    if(revision!==trayRevision)return;
    // Database/connection failures are NOT evidence that a product was removed.
    // Preserve the last verified tray to prevent flashing/disappearing items.
    toast('RFID detection delayed: '+error.message);
  }
});
$('#btn-checkout').onclick=()=>{
  if(!state.cart.length)return toast('Scan a product first.');
  renderCart();screen('k-qr');startTimer();startCameraScanner();
};
$('#btn-retry').onclick=()=>{
  state.current=Backend.newSessionId();
  screen('k-qr');startTimer();startCameraScanner();
};
$('#btn-qr-back').onclick=()=>screen('k-cart');
$('#btn-cancel-scan').onclick=async()=>{
  await stopCameraScanner();stopTimer();
  await finalize('cancelled','Customer cancelled payment.');
  resetKiosk();toast('Payment cancelled');
};
async function completePayment(receipt){
  stopTimer();await stopCameraScanner();
  const session={
    id:receipt.session_id,date:new Date(),items:Number(receipt.total_items),
    amount:Number(receipt.total_amount),status:'success'
  };
  const cart=[...state.cart];
  $('#ok-sid').textContent=session.id;
  $('#ok-receipt').innerHTML=cart.map(i=>
    '<div class="row"><span>'+i.qty+' × '+esc(i.name)+'</span><span>'+
    peso(i.price*i.qty)+'</span></div>'
  ).join('')+'<div class="row tot" style="font-size:18px"><span>Total ('+
    session.items+' items)</span><span>'+peso(session.amount)+'</span></div>';
  pushActivity('Demo checkout '+session.id.slice(-8)+' - '+peso(session.amount));
  loggedSessions.add(session.id);
  state.cart=[];state.current=null;screen('k-success');
  try{await refreshAll()}catch(e){toast('Checkout saved; dashboard refresh failed: '+e.message)}
}
async function cancelOrder(){
  if(state.current&&!loggedSessions.has(state.current))await finalize('cancelled','Customer cancelled checkout.');
  resetKiosk();toast('Order cancelled');
}
$('#btn-cancel').onclick=cancelOrder;
$('#btn-cancel2').onclick=cancelOrder;
$('#btn-new').onclick=resetKiosk;
async function assist(){
  // No staff-notification endpoint exists. Do not falsely claim a message was delivered.
  toast('Please contact a staff member for assistance.');
}
$('#btn-assist').onclick=assist;$('#btn-assist2').onclick=assist;
$('#btn-assist-dismiss').onclick=()=>{
  $('#assist-banner').classList.remove('on');$('#btn-assist').disabled=false;
};
