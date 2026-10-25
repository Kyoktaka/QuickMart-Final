/* Password verification and secure email reset, adapted to final frontend modal. */
let pendingPasswordResetToken=null;
/* 3 wrong passwords lock the popup for a short time (the PHP server enforces it too). */
let pwLockTimer=null,pwLockUntil=0;
function stopPwLock(){
  clearInterval(pwLockTimer);pwLockTimer=null;pwLockUntil=0;
  const b=$('#btn-pw'),i=$('#auth-pw');if(b)b.disabled=false;if(i)i.disabled=false;
}
function startPwLock(seconds){
  clearInterval(pwLockTimer);pwLockUntil=Date.now()+seconds*1000;
  const i=$('#auth-pw');if(i)i.value='';
  const tick=()=>{
    const s=Math.ceil((pwLockUntil-Date.now())/1000);
    if(s<=0){stopPwLock();$('#e2').textContent='';setTimeout(()=>$('#auth-pw')?.focus(),30);return}
    $('#btn-pw').disabled=true;$('#auth-pw').disabled=true;
    $('#e2').textContent='Too many failed attempts. Try again in '+s+' second'+(s===1?'':'s')+'.';
  };
  tick();pwLockTimer=setInterval(tick,500);
}
function authStep(n){
  document.querySelectorAll('.astep').forEach(e=>e.classList.toggle('on',e.id==='as'+n));
  document.querySelectorAll('.err').forEach(e=>e.textContent='');
  const focus={2:'#auth-pw',4:'#rs-gmail',5:'#rs-new'}[n];
  if(focus)setTimeout(()=>$(focus)?.focus(),50);
}
function openAuth(cb,step=2){
  state.authCb=cb;
  ['#auth-pw','#rs-gmail','#rs-new','#rs-conf'].forEach(s=>{const e=$(s);if(e)e.value=''});
  if(window.RFIDScanner)RFIDScanner.disable();
  authStep([4,5].includes(step)?step:2);openModal('m-auth');
  if(pwLockUntil>Date.now())startPwLock((pwLockUntil-Date.now())/1000);
}
function closeAuth(){
  // A focused hidden manager password field must not intercept resumed RFID reads.
  if(document.activeElement?.closest?.('#m-auth'))document.activeElement.blur();
  closeModal('m-auth');state.authCb=null;
  if(state.kioskOn&&typeof syncScannerHold==='function'){syncScannerHold();return}
  if(window.RFIDScanner&&state.kioskOn&&($('#k-idle')?.classList.contains('on')||$('#k-cart')?.classList.contains('on'))){RFIDScanner.enable()}
}
function openPasswordResetLink(){
  const u=new URL(location.href),token=window.__quickmartPendingResetToken||u.searchParams.get('reset_token');
  delete window.__quickmartPendingResetToken;
  if(!token)return false;
  u.searchParams.delete('reset_token');history.replaceState(null,'',u.pathname+u.search+u.hash);
  if(!/^[a-f0-9]{64}$/.test(token)){const err=$('#login-err');if(err)err.textContent='Invalid reset link. Request a new one.';return true}
  pendingPasswordResetToken=token;openAuth(null,5);return true;
}
$('#btn-pw').onclick=async()=>{
  if(Date.now()<pwLockUntil)return;
  const pw=$('#auth-pw').value,btn=$('#btn-pw');if(!pw)return $('#e2').textContent='Enter your password.';
  btn.disabled=true;
  try{await Backend.verifyPassword(pw);stopPwLock();const cb=state.authCb;closeAuth();if(cb)await cb()}
  catch(e){$('#e2').textContent=e.message;if(e.data?.retry_after>0)startPwLock(e.data.retry_after)}
  finally{btn.disabled=Date.now()<pwLockUntil}
};
// There is no master-key or RFID manager-card bypass on the secured backend.
$('#btn-mk').onclick=()=>{$('#e3').textContent='Use manager password verification.'};
$('#btn-forgot').onclick=()=>authStep(4);
$('#btn-gmail-received').onclick=async()=>{
  const email=$('#rs-gmail').value.trim(),btn=$('#btn-gmail-received');
  if(!email||!email.includes('@'))return $('#e4').textContent='Enter a valid email address.';
  btn.disabled=true;
  try{await Backend.requestPasswordReset(email);closeModal('m-auth');openModal('m-reset-confirm');$('#btn-reset-confirm-ok').focus()}
  catch(e){$('#e4').textContent=e.message}finally{btn.disabled=false}
};
$('#btn-reset-confirm-ok').onclick=()=>{closeModal('m-reset-confirm');closeAuth()};
$('#btn-update-password').onclick=async()=>{
  const pw=$('#rs-new').value,conf=$('#rs-conf').value,btn=$('#btn-update-password');
  if(!pendingPasswordResetToken)return $('#e5').textContent='Request a new reset link.';
  const bytes=new TextEncoder().encode(pw).length;
  if(bytes<8||bytes>72)return $('#e5').textContent='Password must contain 8–72 bytes.';
  if(pw!==conf)return $('#e5').textContent='Passwords do not match.';
  btn.disabled=true;
  try{await Backend.resetPassword(pendingPasswordResetToken,pw);pendingPasswordResetToken=null;closeAuth();
    if(location.pathname.endsWith('/login.html')){const err=$('#login-err');err.style.color='var(--ok)';err.textContent='Password updated. Sign in with your new password.'}
    else location.href='login.html';
  }catch(e){$('#e5').textContent=e.message}finally{btn.disabled=false}
};
$('#btn-auth-cancel').onclick=closeAuth;
$('#auth-pw').addEventListener('keydown',e=>{if(e.key==='Enter'){$('#btn-pw').click()}});
installPasswordEyes();
