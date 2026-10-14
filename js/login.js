/* Final frontend login animations, backed by PHP auth (no demo passwords). */
function switchLoginForm(formId){
  const cur=$('.lg-form.active'),next=$('#'+formId);
  $('#login-err').textContent='';$('#signup-err').textContent='';
  if(cur===next)return;
  const swap=()=>{$$('.lg-form').forEach(f=>f.classList.remove('active','out'));next.classList.add('active')};
  if(!cur)return swap();cur.classList.add('out');setTimeout(swap,230);
}
function shakeForm(id){const f=$('#'+id);f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');setTimeout(()=>f.classList.remove('shake'),500)}
function transitionIn(){sessionStorage.setItem(SS_AUTH,'1');sessionStorage.setItem(SS_FRESH,'1');
  $('#login').classList.add('leaving');setTimeout(()=>location.replace('dashboard.html'),520)}
$('#link-to-signup').onclick=e=>{e.preventDefault();switchLoginForm('signup-form')};
$('#link-to-login').onclick=e=>{e.preventDefault();switchLoginForm('login-form')};
$('#signup-form').onsubmit=async e=>{
  e.preventDefault();const user=$('#signup-user').value.trim(),email=$('#signup-gmail').value.trim();
  const pass=$('#signup-pass').value,conf=$('#signup-conf').value,err=$('#signup-err'),btn=$('#btn-signup');
  err.style.color='var(--bad)';err.textContent='';
  if(!user||!email||!pass||!conf)return shakeForm('signup-form'),err.textContent='Complete all fields.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return err.textContent='Enter a valid email address.';
  if(new TextEncoder().encode(pass).length<8||new TextEncoder().encode(pass).length>72)return err.textContent='Password must contain 8–72 bytes.';
  if(pass!==conf)return err.textContent='Passwords do not match.';
  btn.disabled=true;
  try{await Backend.signup(user,email,pass);err.style.color='var(--ok)';err.textContent='Manager created. Sign in with your email.';
    setTimeout(()=>{switchLoginForm('login-form');$('#login-user').value=email},1300)}
  catch(e){err.textContent=e.message;shakeForm('signup-form')}
  finally{btn.disabled=false}
};
$('#login-form').onsubmit=async e=>{
  e.preventDefault();const email=$('#login-user').value.trim(),pass=$('#login-pass').value,err=$('#login-err'),btn=$('#btn-login');
  if(!email||!pass)return err.textContent='Enter manager email and password.';
  btn.disabled=true;btn.classList.add('loading');err.textContent='';
  try{await Backend.login(email,pass);transitionIn()}
  catch(e){err.style.color='var(--bad)';err.textContent=e.message;shakeForm('login-form')}
  finally{btn.disabled=false;btn.classList.remove('loading')}
};
const eye=(btn,input)=>$(btn).onclick=()=>{
  const i=$(input),b=$(btn),show=i.type==='password';i.type=show?'text':'password';
  b.classList.toggle('is-open',show);b.classList.toggle('is-closed',!show);
  b.setAttribute('aria-label',show?'Hide password':'Show password');b.innerHTML=show?EYE_OPEN:EYE_CLOSED;
};
eye('#login-eye','#login-pass');eye('#signup-eye','#signup-pass');eye('#signup-conf-eye','#signup-conf');
$('#btn-forgot-login').onclick=()=>{resetFromLogin=true;openAuth(null,4)};
// Token is stripped as early as possible to avoid exposing it to third-party scripts.
openPasswordResetLink();
