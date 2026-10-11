/* ===== MANAGER VERIFICATION AND RESET EMAIL ===== */
function authStep(n){
  $$('.astep').forEach(e=>e.classList.toggle('on',e.id==='as'+n));
  $$('.err').forEach(e=>e.textContent='');
  const field={2:'#auth-pw',4:'#rs-gmail'}[n];if(field)setTimeout(()=>$(field).focus(),50);
}
function openAuth(cb,step=2,passwordOnly=true){
  state.authCb=cb;authPasswordOnly=true;
  ['#auth-pw','#auth-mk','#rs-gmail','#rs-new','#rs-conf'].forEach(s=>$(s).value='');
  if(window.RFIDScanner)RFIDScanner.disable();
  authStep(step===4?4:2);openModal('m-auth');
}
function closeAuth(){
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
$('#btn-update-password').onclick=()=>{
  $('#e5').textContent='Use the secure reset link sent to your email.';
};
$('#btn-auth-cancel').onclick=closeAuth;
$('#auth-pw').addEventListener('keydown',e=>{if(e.key==='Enter'){$('#btn-pw').click()}});
