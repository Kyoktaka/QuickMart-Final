/* ===== LOGIN AND FIRST MANAGER SIGNUP ===== */
function switchLoginForm(id){
  $$('.lg-form').forEach(f=>f.classList.remove('active'));
  $('#'+id).classList.add('active');
  $('#login-err').textContent='';$('#signup-err').textContent='';
}
$('#link-to-signup').onclick=e=>{e.preventDefault();switchLoginForm('signup-form')};
$('#link-to-login').onclick=e=>{e.preventDefault();switchLoginForm('login-form')};
$('#signup-form').onsubmit=async e=>{
  e.preventDefault();
  const name=$('#signup-user').value.trim(),email=$('#signup-email').value.trim();
  const pass=$('#signup-pass').value,conf=$('#signup-conf').value,err=$('#signup-err');
  err.style.color='var(--bad)';err.textContent='';
  if(!name||!email||!pass||!conf)return err.textContent='Complete all required fields.';
  if(pass.length<8)return err.textContent='Password must be at least 8 characters.';
  if(pass!==conf)return err.textContent='Passwords do not match.';
  const button=$('#btn-signup');button.disabled=true;
  try{
    await Backend.signup(name,email,pass);
    err.style.color='var(--ok)';err.textContent='Manager created! Sign in using your email.';
    $('#login-user').value=email;
    setTimeout(()=>{switchLoginForm('login-form');$('#login-user').value=email},1200);
  }catch(e){err.textContent=e.message}
  finally{button.disabled=false}
};
$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  const email=$('#login-user').value.trim(),pass=$('#login-pass').value,err=$('#login-err');
  if(!email||!pass)return err.textContent='Enter manager email and password.';
  const button=$('#btn-login');button.disabled=true;err.textContent='';
  try{
    await Backend.login(email,pass);
    await refreshAll();
    document.body.classList.remove('locked');goTab('dashboard');
  }catch(e){err.textContent=e.message}
  finally{button.disabled=false}
};
function eye(button,input){
  $(button).onclick=()=>{const el=$(input),show=el.type==='password';
    el.type=show?'text':'password';$(button).setAttribute('aria-label',show?'Hide password':'Show password')};
}
eye('#login-eye','#login-pass');eye('#signup-eye','#signup-pass');
$('#btn-forgot-login').onclick=()=>{resetFromLogin=true;openAuth(null,4)};
function lock(){
  state.kioskOn=false;state.manager=null;state.products=[];state.sessions=[];state.dashboard=null;
  $('#kiosk').classList.remove('on');resetKiosk();
  $$('.modal').forEach(m=>m.classList.remove('on'));
  document.body.classList.add('locked');
  ['#login-user','#login-pass','#signup-user','#signup-email','#signup-pass','#signup-conf']
    .forEach(s=>$(s).value='');
  $('#login-pass').type='password';$('#signup-pass').type='password';
  switchLoginForm('login-form');
}
$('#btn-logout').onclick=async()=>{
  try{await Backend.revokeScan()}catch(e){}
  try{await Backend.logout()}catch(e){toast('Logout request failed. Please retry.');return}
  lock();
};
