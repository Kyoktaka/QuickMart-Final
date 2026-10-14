/* qr-payment.js */
const QR_WALLET_BALANCE=100000;
const QR_NOT_ACCEPTED='QR code not acceptable. Please scan a registered QuickMart payment QR.';

function parsePaymentQr(text){
  const raw=String(text).trim();
  let obj=null;try{obj=JSON.parse(raw)}catch(e){}
  if(obj&&typeof obj==='object'){
    if(obj.code==='NO_BALANCE')return{type:'no-balance'};
    if(obj.code==='NO_INTERNET')return{type:'no-internet'};
    if(obj.status==='success'&&Number(obj.amount)===QR_WALLET_BALANCE)return{type:'wallet',balance:QR_WALLET_BALANCE};
    return{type:'unknown'};
  }
  const t=raw.toLowerCase().replace(/\s+/g,' ');
  if(t==='100000 pesos')return{type:'wallet',balance:QR_WALLET_BALANCE};
  if(t==='no balance')return{type:'no-balance'};
  if(t==='no internet')return{type:'no-internet'};
  return{type:'unknown'};
}

function checkScannedPayment(text,total){
  const q=parsePaymentQr(text);
  if(q.type==='unknown')return{result:'invalid',reason:QR_NOT_ACCEPTED};
  if(q.type==='no-internet')return{result:'failed',reason:'No internet connection. Payment could not be processed. Please try again.'};
  if(q.type==='no-balance')return{result:'failed',reason:`Insufficient balance. This wallet has ${peso(0)} but the total is ${peso(total)}.`};
  if(q.balance<total)return{result:'failed',reason:`Insufficient balance. This wallet has ${peso(q.balance)} but the total is ${peso(total)}.`};
  return{result:'success',reason:`Payment of ${peso(total)} approved.`};
}

function beep(){try{const c=new (window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close()},100)}catch(e){}}

async function onQrDecoded(text){
  if(state.processing||!onScreen('k-qr'))return;
  state.processing=true;
  const status=$('#qr-status');status.textContent='QR detected — verifying…';status.className='qr-status';
  try{navigator.vibrate&&navigator.vibrate(80)}catch(e){}
  beep();
  const r=await Backend.processPayment(String(text),cartTotal());
  if(r.result==='invalid'){
    const box=$('#qr-box');status.textContent='❌ '+r.reason;status.className='qr-status bad';
    box.classList.remove('rejected');void box.offsetWidth;box.classList.add('rejected');
    setTimeout(()=>{box.classList.remove('rejected');if(onScreen('k-qr')){status.textContent='Point the QR code at the camera…';status.className='qr-status'}state.processing=false},2600);
    return;
  }
  try{
    await stopCameraScanner();
    if(r.result==='success'){status.textContent='✅ '+r.reason;status.className='qr-status ok';await completePayment()}
    else{
      status.textContent='❌ '+r.reason;status.className='qr-status bad';
      stopTimer();await finalize('failed',r.reason);
      setTimeout(()=>{if(onScreen('k-qr')){$('#fail-reason').textContent=r.reason;screen('k-fail')}},900);
    }
  }finally{state.processing=false}
}
window.addEventListener('qr:decoded',e=>onQrDecoded(e.detail));
