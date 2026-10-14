/* login.js */
function switchLoginForm(formId){
  const cur=$('.lg-form.active'),next=$('#'+formId);
  $('#login-err').textContent='';$('#signup-err').textContent='';
  if(cur===next)return;
  const swap=()=>{$$('.lg-form').forEach(f=>f.classList.remove('active','out'));next.classList.add('active');
    const t=[...next.querySelectorAll('input')].find(i=>!i.value);if(t)t.focus()};
  if(!cur)return swap();
  cur.classList.add('out');setTimeout(swap,230);
}
function shakeForm(id){const f=$('#'+id);f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');setTimeout(()=>f.classList.remove('shake'),500)}
function transitionIn(){
  sessionStorage.setItem(SS_AUTH,'1');sessionStorage.setItem(SS_FRESH,'1');
  $('#login').classList.add('leaving');
  setTimeout(()=>{location.href='dashboard.html'},520);
}
$('#link-to-signup').onclick=e=>{e.preventDefault();switchLoginForm('signup-form')};
$('#link-to-login').onclick=e=>{e.preventDefault();switchLoginForm('login-form')};

$('#signup-form').onsubmit=async e=>{
  e.preventDefault();
  const user=$('#signup-user').value.trim(),gmail=$('#signup-gmail').value.trim(),pass=$('#signup-pass').value,conf=$('#signup-conf').value,err=$('#signup-err');
  err.style.color='var(--bad)';
  if(!user||!gmail||!pass||!conf)return shakeForm('signup-form'),err.textContent='Please fill in all fields.';
  if(!/^[^\s@]+@gmail\.com$/i.test(gmail))return shakeForm('signup-form'),err.textContent='Enter a valid Gmail address ending in @gmail.com.';
  if(pass.length<6)return shakeForm('signup-form'),err.textContent='Password must be at least 6 characters.';
  if(pass!==conf)return shakeForm('signup-form'),err.textContent='Passwords do not match.';
  if(!(await Backend.signup(user,gmail,pass)))return shakeForm('signup-form'),err.textContent='Could not create the account. Try again.';
  err.style.color='var(--ok)';err.textContent='Account created! You can now sign in.';
  setTimeout(()=>{err.textContent='';err.style.color='var(--bad)';switchLoginForm('login-form');$('#login-user').value=gmail;$('#login-pass').focus()},1500);
};
$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  const u=$('#login-user').value.trim(),pw=$('#login-pass').value,er=$('#login-err'),btn=$('#btn-login');
  const fail=m=>{er.textContent=m;shakeForm('login-form')};
  if(!u||!pw)return fail('Enter your Gmail address and password.');
  if(!/^[^\s@]+@gmail\.com$/i.test(u))return fail('Enter a valid Gmail address ending in @gmail.com.');
  btn.classList.add('loading');
  const ok=await Backend.login(u,pw);
  await new Promise(r=>setTimeout(r,450));
  btn.classList.remove('loading');
  if(!ok)return fail('Incorrect Gmail address or password.');
  er.textContent='';
  transitionIn();
};
const eye=(btn,input)=>$(btn).onclick=()=>{
  const i=$(input),b=$(btn),show=i.type==='password';
  i.type=show?'text':'password';
  b.classList.toggle('is-open',show);b.classList.toggle('is-closed',!show);
  b.setAttribute('aria-label',show?'Hide password':'Show password');
  b.innerHTML=show?EYE_OPEN:EYE_CLOSED;
};
eye('#login-eye','#login-pass');eye('#signup-eye','#signup-pass');eye('#signup-conf-eye','#signup-conf');

$('#btn-forgot-login').onclick=()=>{resetFromLogin=true;openAuth(null,4)};

/* page init */
switchLoginForm('login-form');
setTimeout(()=>$('#login-user').focus(),50);
