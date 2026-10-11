/* ===== CAMERA QR SCANNER (html5-qrcode) ===== */
const onScreen=id=>$('#'+id).classList.contains('on');
let scanTok=0, CAM_TIMEOUT=10000;
async function stopCameraScanner(){
  scanTok++;                                   // cancels a start that is still in flight
  const sc=state.scanner;state.scanner=null;state.scanning=false;
  $('#btn-cancel-scan').style.display='none';$('#btn-cam-retry').style.display='none';
  if(sc){try{await sc.stop()}catch(e){}try{sc.clear()}catch(e){}}
}
/* Turn a camera error into something the customer or manager can act on */
function camText(err){
  const t=String(err&&(err.name||err.message)||err);
  const framed=window.self!==window.top;
  if(!window.isSecureContext)return 'Camera access needs https or localhost. Open the page from a local server (for example http://localhost:8000), not from a plain file path.';
  if(/NotAllowed|Permission|denied/i.test(t))return 'Camera access is blocked. Click the camera icon in the address bar and choose Allow'+(framed?'. This page is inside a preview frame, which blocks the camera, so open the file in its own browser tab':'')+'.';
  if(/NotFound|DevicesNotFound/i.test(t))return 'No camera was found on this device.';
  if(/NotReadable|TrackStart|in use/i.test(t))return 'The camera is being used by another app or browser tab. Close it, then press “Try camera again”.';
  if(/Timeout/i.test(t))return 'The camera did not respond. Check that no other app is using it, then press “Try camera again”.';
  return 'Camera could not start ('+t+').';
}
function loadScript(src){return new Promise(r=>{const el=document.createElement('script');el.src=src;el.onload=()=>r(true);el.onerror=()=>r(false);document.head.appendChild(el)})}
async function ensureQrLib(){   // the <script> in <head> normally loads it; try other hosts if that was blocked
  if(typeof Html5Qrcode!=='undefined')return true;
  for(const src of ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js','https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'])
    if(await loadScript(src)&&typeof Html5Qrcode!=='undefined')return true;
  return false;
}
async function startCameraScanner(){
  await stopCameraScanner();
  const tok=++scanTok,status=$('#qr-status');
  status.textContent='Starting camera…';status.className='qr-status';
  const giveUp=msg=>{if(tok!==scanTok)return;status.textContent=msg;status.className='qr-status bad';$('#btn-cam-retry').style.display=''};
  if(!(await ensureQrLib()))return giveUp('The camera library could not load. Check the internet connection or an ad blocker, then press “Try camera again”.');
  let lastErr;
  for(const attempt of [{facingMode:'environment'},{facingMode:'user'},'first-camera']){   // back camera, then front/webcam, then whatever is listed first
    if(tok!==scanTok)return;
    let sc,timedOut=false;
    try{
      let cam=attempt;
      if(attempt==='first-camera'){const cams=await Html5Qrcode.getCameras();if(!cams.length)throw{name:'NotFoundError'};cam=cams[0].id}
      sc=new Html5Qrcode('qr-reader',{formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE],experimentalFeatures:{useBarCodeDetectorIfSupported:true}});
      const started=sc.start(cam,{fps:10,qrbox:{width:220,height:220}},txt=>onQrDecoded(txt),()=>{});
      started.then(async()=>{if(timedOut||tok!==scanTok){try{await sc.stop()}catch(e){}try{sc.clear()}catch(e){}}}).catch(()=>{});   // never leave a late-starting camera running
      await Promise.race([started,new Promise((_,rej)=>setTimeout(()=>{timedOut=true;rej({name:'Timeout'})},CAM_TIMEOUT))]);
      if(tok!==scanTok||!onScreen('k-qr'))return;
      state.scanner=sc;state.scanning=true;
      $('#btn-cancel-scan').style.display='';status.textContent='Point the QR code at the camera…';
      return;
    }catch(err){
      lastErr=err;if(sc){try{await sc.stop()}catch(e){}try{sc.clear()}catch(e){}}
      if(/NotAllowed|Permission|denied|NotFound|NotReadable|Timeout/i.test(String(err&&(err.name||err.message)||err)))break;   // other cameras won't fix these
    }
  }
  console.error('Camera start failed:',lastErr);
  giveUp(camText(lastErr));
}
$('#btn-cam-retry').onclick=()=>{startTimer();startCameraScanner()};
function beep(){try{const c=new (window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=.08;o.connect(g);g.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close()},100)}catch(e){}}
async function onQrDecoded(text){
  if(state.processing||!onScreen('k-qr'))return;
  state.processing=true;
  stopTimer(); // Wait for the server before classifying timeout/failure.
  $('#btn-cancel-scan').disabled=true;
  const status=$('#qr-status');status.textContent='QR detected — verifying…';status.className='qr-status';
  try{navigator.vibrate&&navigator.vibrate(80)}catch(e){}
  beep();
  try{
    const r=await Backend.processPayment(String(text));
    await stopCameraScanner();
    if(r.result==='success'){status.textContent='✅ '+r.reason;status.className='qr-status ok';await completePayment(r.purchase)}
    else if(r.result==='failed'){
      status.textContent='❌ '+r.reason;status.className='qr-status bad';
      stopTimer();await finalize('failed',r.reason);
      setTimeout(()=>{if(onScreen('k-qr')){$('#fail-reason').textContent=r.reason;screen('k-fail')}},900);
    }else{
      status.textContent='Checkout unavailable: '+r.reason;status.className='qr-status bad';
      stopTimer();$('#btn-cam-retry').style.display='';
    }
  }finally{state.processing=false;$('#btn-cancel-scan').disabled=false}
}
window.addEventListener('qr:decoded',e=>onQrDecoded(e.detail));
