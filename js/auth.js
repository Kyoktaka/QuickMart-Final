/* ===== MANAGER VERIFICATION AND RESET EMAIL ===== */
function authStep(n){
  $$('.astep').forEach(e=>e.classList.toggle('on',e.id==='as'+n));
  $$('.err').forEach(e=>e.textContent='');
  const field={2:'#auth-pw',4:'#rs-gmail'}[n];if(field)setTimeout(()=>$(field).focus(),50);
}
let pendingPasswordResetToken=null;
function openPasswordResetLink(){
  const u=new URL(location.href),token=window.__quickmartPendingResetToken||u.searchParams.get('reset_token');
  delete window.__quickmartPendingResetToken;
  if(!token)return false;
  u.searchParams.delete('reset_token');
  history.replaceState(null,'',u.pathname+u.search+u.hash);
  if(!/^[a-f0-9]{64}$/.test(token)){
    document.body.classList.add('locked');
    $('#login-err').textContent='This reset link is invalid. Request a new one.';
    return true;
  }
  pendingPasswordResetToken=token;
  document.body.classList.add('locked');
  openAuth(null,5);
  return true;
}
function openAuth(cb,step=2,passwordOnly=true){
  state.authCb=cb;authPasswordOnly=true;
  ['#auth-pw','#auth-mk','#rs-gmail','#rs-new','#rs-conf'].forEach(s=>$(s).value='');
  if(window.RFIDScanner)RFIDScanner.disable();
  authStep([4,5].includes(step)?step:2);openModal('m-auth');
}
function closeAuth(){
  pendingPasswordResetToken=null;
  closeModal('m-auth');state.authCb=null;resetFromLogin=false;authPasswordOnly=false;
  if(window.RFIDScanner&&state.kioskOn&&
     ($('#k-idle').classList.contains('on')||$('#k-cart').classList.contains('on'))){
    RFIDScanner.enable();
  }
}
$('#btn-pw').onclick=async()=>{
  const v=$('#auth-pw').value;
  if(!v)return $('#e2').textContent='Enter your password.';
  try{
    await Backend.verifyPassword(v);
    const cb=state.authCb;closeAuth();if(cb)await cb();
  }catch(e){$('#e2').textContent=e.message}
};
// RFID manager-card and master-key shortcuts are deliberately not used:
// the backend only supports secure password-based scan authorization.
$('#btn-mk').onclick=()=>{$('#e3').textContent='Use the manager password verification step.'};
$('#btn-forgot').onclick=()=>authStep(4);
$('#btn-gmail-received').onclick=async()=>{
  const email=$('#rs-gmail').value.trim();
  if(!email||!email.includes('@'))return $('#e4').textContent='Enter a valid email address.';
  const button=$('#btn-gmail-received');button.disabled=true;
  try{
    await Backend.requestPasswordReset(email);
    $('#e4').textContent='If registered, a reset link was sent. Open the link from your email to change your password.';
  }catch(e){$('#e4').textContent=e.message}
  finally{button.disabled=false}
};
$('#btn-update-password').onclick=async()=>{
  const pass=$('#rs-new').value,confirm=$('#rs-conf').value;
  if(!pendingPasswordResetToken){
    $('#e5').textContent='Request a new password reset link.';return;
  }
  if(new TextEncoder().encode(pass).length<8||new TextEncoder().encode(pass).length>72){
    $('#e5').textContent='Password must contain 8–72 bytes.';return;
  }
  if(pass!==confirm){$('#e5').textContent='Passwords do not match.';return}
  const button=$('#btn-update-password');button.disabled=true;
  try{
    await Backend.resetPassword(pendingPasswordResetToken,pass);
    closeAuth();lock();
    $('#login-err').style.color='var(--ok)';
    $('#login-err').textContent='Password updated. Sign in using your new password.';
  }catch(error){$('#e5').textContent=error.message}
  finally{button.disabled=false}
};
$('#btn-auth-cancel').onclick=closeAuth;
$('#auth-pw').addEventListener('keydown',e=>{if(e.key==='Enter'){$('#btn-pw').click()}});
