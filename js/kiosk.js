/* ===== KIOSK ===== */
function screen(id){$$('.screen').forEach(s=>s.classList.toggle('on',s.id===id));$('#kiosk').classList.toggle('idle',id==='k-idle');if(id!=='k-qr'){stopTimer();stopCameraScanner()}}
let timerId=null,left=TIMEOUT;
const cartTotal=()=>state.cart.reduce((a,i)=>a+i.price*i.qty,0),cartQty=()=>state.cart.reduce((a,i)=>a+i.qty,0);
function stopTimer(){clearInterval(timerId);timerId=null}
function startTimer(){stopTimer();left=TIMEOUT;drawTimer();timerId=setInterval(()=>{left--;drawTimer();if(left<=0){stopTimer();stopCameraScanner();
  const reason='Payment timed out after 5 minutes.';$('#fail-reason').textContent=reason;finalize('failed',reason);screen('k-fail')}},1000)}
function drawTimer(){$('#qr-timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')}
function renderCart(){$('#cart-body').innerHTML=state.cart.map(i=>`<tr data-product-id="${i.id}"><td>${esc(i.name)}</td><td>${peso(i.price)}</td><td>${i.qty}</td><td><b>${peso(i.price*i.qty)}</b></td></tr>`).join('');
  $('#sum-items').textContent=cartQty();$('#sum-tax').textContent=peso(0);$('#sum-total').textContent=peso(cartTotal());$('#qr-total').textContent=peso(cartTotal())}

async function finalize(status,failReason){
  const itemsDetail=state.cart.flatMap(i=>(i.scanned||[]).map(epc=>({epc,name:i.name,qty:1,price:i.price})));   // one history line per scanned EPC
  const ex=state.sessions.findIndex(x=>x.id===state.current),prev=ex>=0?state.sessions[ex].failReason:null;   // a retried session keeps its last failure reason
  const s={id:state.current,date:new Date(),items:cartQty(),amount:cartTotal(),status,itemsDetail,failReason:status==='success'?null:(failReason||prev||null)};
  ex>=0?state.sessions[ex]=s:state.sessions.unshift(s);
  if(status==='success')state.cart.forEach(i=>{
    const p=state.products.find(x=>x.id===i.id);
    if(p){p.stock=Math.max(0,p.stock-i.qty);p.epcs=p.epcs.filter(x=>!(i.scanned||[]).includes(x))}   // sold tags leave the product
  });
  saveProducts();
  await Backend.saveSession(s);
  pushActivity(`Session ${s.id.slice(-4)} ${status==='success'?'Completed':status==='failed'?'Failed':'Cancelled'} - ${peso(s.amount)}`);
  return s;
}
function resetKiosk(){stopTimer();stopCameraScanner();state.cart=[];state.current=null;state.processing=false;$('#assist-banner').classList.remove('on');$('#btn-assist').disabled=false;screen('k-idle')}
function enterKiosk(){state.kioskOn=true;$('#kiosk').classList.add('on');resetKiosk()}
async function exitKiosk(){if(state.cart.length&&state.current){const ex=state.sessions.find(x=>x.id===state.current);if(!ex||ex.status!=='failed')await finalize('cancelled')}   // don't overwrite a failed session
  state.kioskOn=false;$('#kiosk').classList.remove('on');resetKiosk();goTab('dashboard')}
$('#btn-start-scan').onclick=()=>openAuth(enterKiosk,2,true);
$('#btn-kiosk-exit').onclick=()=>openAuth(exitKiosk,2,true);

window.addEventListener('rfid:tray',e=>{if(!state.kioskOn||!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on'))return;
  const m={};[...new Set(e.detail)].forEach(epc=>{const p=state.products.find(p=>p.active!==false&&p.epcs.includes(epc));if(p)(m[p.id]=m[p.id]||[]).push(epc)});
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
async function assist(){await Backend.notifyStaff(state.current);$('#assist-banner').classList.add('on');$('#btn-assist').disabled=true;toast('Staff notified');
  if($('#k-fail').classList.contains('on'))screen('k-cart')}
$('#btn-assist').onclick=assist;$('#btn-assist2').onclick=assist;
$('#btn-assist-dismiss').onclick=()=>{$('#assist-banner').classList.remove('on');$('#btn-assist').disabled=false};
