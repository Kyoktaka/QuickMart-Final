// Original fixtures; the offline fixtures are also verified by the same server.
/* Fixed two classroom QR outcomes verified SERVER-SIDE. No simulated wallets in JS. */
let qrFailureAttempts=0;
const MAX_QR_FAILURE_ATTEMPTS=3;
function resetQrFailureAttempts(){qrFailureAttempts=Number(state.checkout?.failed_attempts||0)}

function beep(){try{const C=window.AudioContext||window.webkitAudioContext,c=new C(),o=c.createOscillator(),g=c.createGain();
  o.frequency.value=880;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close()},100)}catch(e){}}

async function onQrDecoded(text){
  if(state.processing||!onScreen('k-qr'))return;
  state.processing=true;
  const status=$('#qr-status');status.textContent='QR detected — verifying…';status.className='qr-status';
  try{navigator.vibrate?.(80)}catch(e){}beep();
  try{
    const r=await Backend.processPayment(String(text));
    if(r.session){
      state.checkout=r.session;
      qrFailureAttempts=Number(r.session.failed_attempts||0);
      if(typeof applyCheckoutSession==='function')applyCheckoutSession(r.session);
    }
    if(r.result==='success'){
      stopTimer();await stopCameraScanner();status.textContent='✅ '+r.reason;status.className='qr-status ok';
      await completePayment(r.purchase);return;
    }
    if(r.result==='voided'||r.session?.status==='VOIDED'){
      stopTimer();await stopCameraScanner();
      const reason=r.session?.reason==='three_failed_attempts'?'Payment failed after 3 attempts. '+r.reason:r.reason;
      status.textContent='❌ '+reason;status.className='qr-status bad';$('#fail-reason').textContent=reason;
      // The server already finalized this order; never create a second failure log.
      screen('k-fail');return;
    }
    if(r.result==='invalid'||r.result==='failed'){
      await stopCameraScanner();
      const next=qrFailureAttempts+1;
      status.textContent=`❌ Attempt ${qrFailureAttempts} of ${MAX_QR_FAILURE_ATTEMPTS}: ${r.reason}`;
      status.className='qr-status bad';
      const box=$('#qr-box');box.classList.remove('rejected');void box.offsetWidth;box.classList.add('rejected');
      const retry=$('#btn-cam-retry');retry.textContent=`Scan again (${next} of ${MAX_QR_FAILURE_ATTEMPTS})`;retry.style.display='';
      return;
    }
    // No-internet fixture is verified by PHP. Unexpected server/connection errors consume no attempt.
    status.textContent='Checkout unavailable: '+r.reason;status.className='qr-status bad';
    await stopCameraScanner();$('#btn-cam-retry').textContent='Try camera again';$('#btn-cam-retry').style.display='';
  }finally{state.processing=false}
}
window.addEventListener('qr:decoded',e=>void onQrDecoded(e.detail));
