/* ===== AUTH MODAL (password check for kiosk, plus password reset) ===== */
function authStep(n){$$('.astep').forEach(e=>e.classList.toggle('on',e.id==='as'+n));$$('.err').forEach(e=>e.textContent='');
  const f={2:'#auth-pw',3:'#auth-mk',4:'#rs-gmail',5:'#rs-new'}[n];if(f)setTimeout(()=>$(f).focus(),50)}

function openAuth(cb,step=1,passwordOnly=false){
  state.authCb=cb;
  authPasswordOnly=passwordOnly;
  ['#auth-pw','#auth-mk','#rs-gmail','#rs-new','#rs-conf'].forEach(s=>$(s).value='');
  authStep(passwordOnly ? 2 : step);
  openModal('m-auth');
}
function closeAuth(){closeModal('m-auth');state.authCb=null;resetFromLogin=false;authPasswordOnly=false}

window.addEventListener('rfid:card',async e=>{if(!$('#m-auth').classList.contains('on')||!$('#as1').classList.contains('on'))return;
  if(await Backend.verifyCard(e.detail))authStep(2);else $('#e1').textContent='Card not recognized. Tap a manager card.'});

$('#btn-pw').onclick=async()=>{
  const v=$('#auth-pw').value;
  if(!v)return $('#e2').textContent='Enter your password.';
  if(await Backend.verifyPassword(v)){
    if(authPasswordOnly){const cb=state.authCb;closeAuth();cb&&cb()}
    else authStep(3);
  }else $('#e2').textContent='Your password is incorrect. Try again.';
};
$('#btn-mk').onclick=async()=>{const v=$('#auth-mk').value;if(!v)return $('#e3').textContent='Enter the master key.';
  if(!(await Backend.verifyMasterKey(v)))return $('#e3').textContent='Invalid master key. Try again.';
  const cb=state.authCb;closeAuth();cb&&cb()};
$('#btn-forgot').onclick=()=>authStep(4);

$('#btn-gmail-received').onclick=async()=>{
  const gmail=$('#rs-gmail').value.trim();
  if(!gmail||!gmail.includes('@'))return $('#e4').textContent='Please enter a valid Gmail address.';
  if(!(await Backend.requestPasswordReset(gmail)))return $('#e4').textContent='Could not send reset instructions. Try again.';
  authStep(5);
};
$('#btn-update-password').onclick=async()=>{
  const n=$('#rs-new').value;
  if(n.length<6)return $('#e5').textContent='Use at least 6 characters.';
  if(n!==$('#rs-conf').value)return $('#e5').textContent='Passwords do not match.';
  if(await Backend.changePassword(n)){
    if(resetFromLogin){closeAuth();toast('Password updated. Sign in with your new password.')}
    else{toast('Password updated successfully');authStep(2)}
  }else $('#e5').textContent='Failed to update password. Try again.';
};
$('#btn-auth-cancel').onclick=closeAuth;
['auth-pw','auth-mk'].forEach(id=>$('#'+id).addEventListener('keydown',e=>{if(e.key==='Enter')$(id==='auth-pw'?'#btn-pw':'#btn-mk').click()}));
