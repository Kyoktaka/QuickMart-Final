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
$('#link-to-signup').onclick=e=>{e.preventDefault();hideCreatedBanner();switchLoginForm('signup-form')};
$('#link-to-login').onclick=e=>{e.preventDefault();switchLoginForm('login-form')};
/* Live "do the passwords match?" indicator under Confirm Password */
function updatePasswordMatch(){
  const p=$('#signup-pass').value,c=$('#signup-conf').value,m=$('#signup-match'),f=$('#signup-conf').closest('.lg-field');
  f.classList.remove('is-match','is-mismatch');m.className='lg-match';m.textContent='';
  if(!c)return;
  const ok=p===c;
  f.classList.add(ok?'is-match':'is-mismatch');m.classList.add(ok?'ok':'bad');
  m.textContent=ok?'Passwords match':'Passwords do not match';
}
['#signup-pass','#signup-conf'].forEach(s=>$(s).addEventListener('input',updatePasswordMatch));
/* Live password strength: Weak / Medium / Strong (advice only; the server still enforces 8-72 bytes) */
function passwordStrength(p){
  if(!p)return null;
  let pts=0;
  if(p.length>=8)pts++;if(p.length>=12)pts++;
  if(/[a-z]/.test(p)&&/[A-Z]/.test(p))pts++;
  if(/\d/.test(p))pts++;
  if(/[^A-Za-z0-9]/.test(p))pts++;
  if(p.length<8||pts<=2)return{level:1,label:'Weak',tip:p.length<8?'Use at least 8 characters.':'Add uppercase, numbers or symbols.'};
  if(pts===3)return{level:2,label:'Medium',tip:'Add a symbol or more length to make it stronger.'};
  return{level:3,label:'Strong',tip:''};
}
function updatePasswordStrength(){
  const box=$('#signup-strength'),txt=$('#signup-strength-txt'),s=passwordStrength($('#signup-pass').value);
  box.classList.remove('weak','medium','strong');
  if(!s){box.classList.remove('on');txt.textContent='';return}
  box.classList.add('on',['','weak','medium','strong'][s.level]);
  txt.textContent=s.label+(s.tip?' \u2013 '+s.tip:'');
  box.style.setProperty('--lvl',s.level);
}
$('#signup-pass').addEventListener('input',updatePasswordStrength);
/* "Account successfully created" banner shown on the Sign In screen */
let createdBannerTimer=null;
function hideCreatedBanner(){clearTimeout(createdBannerTimer);$('#signup-banner').classList.remove('on')}
function showCreatedBanner(){const b=$('#signup-banner');b.classList.add('on');clearTimeout(createdBannerTimer);createdBannerTimer=setTimeout(hideCreatedBanner,7000)}
$('#signup-banner-x').onclick=hideCreatedBanner;
function resetSignupForm(){
  $('#signup-form').reset();updatePasswordMatch();updatePasswordStrength();
  [['#signup-eye','#signup-pass'],['#signup-conf-eye','#signup-conf']].forEach(([b,i])=>{
    const btn=$(b),inp=$(i);inp.type='password';btn.classList.remove('is-open');btn.classList.add('is-closed');
    btn.setAttribute('aria-label',i==='#signup-pass'?'Show password':'Show confirm password');btn.innerHTML=EYE_CLOSED});
}
$('#signup-form').onsubmit=async e=>{
  e.preventDefault();const user=$('#signup-user').value.trim(),email=$('#signup-gmail').value.trim();
  const pass=$('#signup-pass').value,conf=$('#signup-conf').value,err=$('#signup-err'),btn=$('#btn-signup');
  err.style.color='var(--bad)';err.textContent='';
  if(!user||!email||!pass||!conf)return shakeForm('signup-form'),err.textContent='Complete all fields.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return err.textContent='Enter a valid email address.';
  if(new TextEncoder().encode(pass).length<8||new TextEncoder().encode(pass).length>72)return err.textContent='Password must contain 8–72 bytes.';
  if(pass!==conf)return err.textContent='Passwords do not match.';
  btn.disabled=true;
  try{await Backend.signup(user,email,pass);
    resetSignupForm();switchLoginForm('login-form');$('#login-user').value=email;$('#login-pass').value='';
    showCreatedBanner();setTimeout(()=>$('#login-pass').focus(),300)}
  catch(e){err.textContent=e.message;shakeForm('signup-form')}
  finally{btn.disabled=false}
};
/* 3 wrong sign-ins lock the form for a short time (the PHP server enforces it too). */
let loginLockTimer=null,loginLockUntil=0;
function startLoginLock(seconds){
  clearInterval(loginLockTimer);loginLockUntil=Date.now()+seconds*1000;
  const btn=$('#btn-login'),err=$('#login-err');
  const tick=()=>{
    const s=Math.ceil((loginLockUntil-Date.now())/1000);
    if(s<=0){clearInterval(loginLockTimer);loginLockTimer=null;loginLockUntil=0;btn.disabled=false;err.textContent='';return}
    btn.disabled=true;err.style.color='var(--bad)';
    err.textContent='Too many failed attempts. Try again in '+s+' second'+(s===1?'':'s')+'.';
  };
  tick();loginLockTimer=setInterval(tick,500);
}
$('#login-form').onsubmit=async e=>{
  e.preventDefault();if(Date.now()<loginLockUntil)return;
  const email=$('#login-user').value.trim(),pass=$('#login-pass').value,err=$('#login-err'),btn=$('#btn-login');
  if(!email||!pass)return err.textContent='Enter manager email and password.';
  btn.disabled=true;btn.classList.add('loading');err.textContent='';
  try{await Backend.login(email,pass);transitionIn()}
  catch(e){err.style.color='var(--bad)';err.textContent=e.message;shakeForm('login-form');if(e.data?.retry_after>0)startLoginLock(e.data.retry_after)}
  finally{btn.disabled=Date.now()<loginLockUntil;btn.classList.remove('loading')}
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
