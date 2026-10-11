/* ===== LOGIN / SIGN UP ===== */
function switchLoginForm(formId){
  $$('.lg-form').forEach(f=>f.classList.remove('active'));
  $('#'+formId).classList.add('active');
  $('#login-err').textContent='';$('#signup-err').textContent='';
}
$('#link-to-signup').onclick=e=>{e.preventDefault();switchLoginForm('signup-form')};
$('#link-to-login').onclick=e=>{e.preventDefault();switchLoginForm('login-form')};

$('#signup-form').onsubmit=async e=>{
  e.preventDefault();
  const user=$('#signup-user').value.trim(),pass=$('#signup-pass').value,conf=$('#signup-conf').value,err=$('#signup-err');
  err.style.color='var(--bad)';
  if(!user||!pass||!conf)return err.textContent='Please fill in all fields.';
  if(pass.length<6)return err.textContent='Password must be at least 6 characters.';
  if(pass!==conf)return err.textContent='Passwords do not match.';
  if(!(await Backend.signup(user,pass)))return err.textContent='Could not create the account. Try again.';
  err.style.color='var(--ok)';err.textContent='Account created! You can now sign in.';
  setTimeout(()=>{err.textContent='';err.style.color='var(--bad)';switchLoginForm('login-form');$('#login-user').value=user;$('#login-pass').focus()},1500);
};
$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  const u=$('#login-user').value.trim(),pw=$('#login-pass').value,er=$('#login-err');
  if(!u||!pw)return er.textContent='Enter your username and password.';
  if(!(await Backend.login(u,pw)))return er.textContent='Incorrect username or password.';
  document.body.classList.remove('locked');goTab('dashboard');
};
const eye=(btn,input)=>$(btn).onclick=()=>{const i=$(input),show=i.type==='password';i.type=show?'text':'password';$(btn).setAttribute('aria-label',show?'Hide password':'Show password')};
eye('#login-eye','#login-pass');eye('#signup-eye','#signup-pass');
$('#btn-forgot-login').onclick=()=>{resetFromLogin=true;openAuth(null,4)};

function lock(){
  state.kioskOn=false;$('#kiosk').classList.remove('on');resetKiosk();
  $$('.modal').forEach(m=>m.classList.remove('on'));
  document.body.classList.add('locked');
  ['#login-user','#login-pass','#signup-user','#signup-pass','#signup-conf'].forEach(i=>$(i).value='');
  $('#login-pass').type='password';$('#signup-pass').type='password';
  switchLoginForm('login-form');
  setTimeout(()=>$('#login-user').focus(),50);
}
$('#btn-logout').onclick=lock;
