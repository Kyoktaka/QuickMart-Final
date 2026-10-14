/* Fixed two classroom QR outcomes verified SERVER-SIDE. No simulated wallets in JS. */
function beep(){try{const C=window.AudioContext||window.webkitAudioContext,c=new C(),o=c.createOscillator(),g=c.createGain();
  o.frequency.value=880;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close()},100)}catch(e){}}
async function onQrDecoded(text){
  if(state.processing||!onScreen('k-qr'))return;
  state.processing=true;
  const status=$('#qr-status');status.textContent='QR detected — verifying…';status.className='qr-status';
  try{navigator.vibrate?.(80)}catch(e){}beep();
  const r=await Backend.processPayment(String(text));
  if(r.result==='invalid'){
    status.textContent='❌ '+r.reason;status.className='qr-status bad';
    const box=$('#qr-box');box.classList.remove('rejected');void box.offsetWidth;box.classList.add('rejected');
    setTimeout(()=>{box.classList.remove('rejected');if(onScreen('k-qr')){status.textContent='Point the QR code at the camera…';status.className='qr-status'}state.processing=false},2500);
    return;
  }
  try{
    if(r.result==='error'){
      status.textContent='Checkout unavailable: '+r.reason;status.className='qr-status bad';
      stopTimer();await stopCameraScanner();$('#btn-cam-retry').style.display='';return;
    }
    stopTimer();await stopCameraScanner();
    if(r.result==='success'){
      status.textContent='✅ '+r.reason;status.className='qr-status ok';await completePayment(r.purchase);
    }else{
      status.textContent='❌ '+r.reason;status.className='qr-status bad';
      await finalize('failed',r.reason);$('#fail-reason').textContent=r.reason;screen('k-fail');
    }
  }finally{state.processing=false}
}
window.addEventListener('qr:decoded',e=>void onQrDecoded(e.detail));
