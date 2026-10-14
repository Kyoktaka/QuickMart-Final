/* helpers.js */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const peso=n=>'₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(m,type){const t=$('#toast');if(!t)return;t.textContent=m;t.classList.toggle('error',type==='error');t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2600)}
function pushActivity(text,date=new Date()){state.activity.unshift({text,date});state.activity=state.activity.slice(0,30);if(typeof renderActivity==='function')renderActivity()}
function openModal(id){const m=$('#'+id);if(m)m.classList.add('on')}
function closeModal(id){const m=$('#'+id);if(m)m.classList.remove('on')}
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
const sameDay=(a,b)=>new Date(a).toDateString()===new Date(b).toDateString();
const todays=()=>state.sessions.filter(s=>sameDay(s.date,new Date()));
setInterval(()=>$$('[data-clock]').forEach(e=>e.textContent=fmt(new Date())),1000);
$$('[data-clock]').forEach(e=>e.textContent=fmt(new Date()));

function animateNumber(el,to,format=v=>String(Math.round(v))){
  const from=el._v||0;el._v=to;
  if(from===to||window.matchMedia('(prefers-reduced-motion:reduce)').matches){el.textContent=format(to);return}
  const t0=performance.now(),dur=600;
  (function step(now){const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=format(from+(to-from)*e);if(k<1)requestAnimationFrame(step)})(t0);
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){['m-product','m-epc'].forEach(closeModal)}});

const codeFor=id=>'PRD-'+String(id).padStart(4,'0');

/* filter popovers (.pop) – used by history.js and inventory.js */
const togglePop=(pop,e)=>{e.stopPropagation();const open=pop.classList.contains('show');$$('.pop').forEach(p=>p.classList.remove('show'));if(!open)pop.classList.add('show')};
$$('.pop').forEach(p=>p.addEventListener('click',e=>e.stopPropagation()));
document.addEventListener('click',()=>$$('.pop').forEach(p=>p.classList.remove('show')));

/* password show/hide eye */
const EYE_OPEN='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',EYE_CLOSED='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10c2.8 3.9 5.9 5.5 9 5.5s6.2-1.6 9-5.5"/><path d="M6.4 13.6l-1.8 2.4M10.2 15.1l-.7 2.8M13.8 15.1l.7 2.8M17.6 13.6l1.8 2.4"/></svg>';

/* sign out (sidebar button) */
async function logout(){
  try{await Backend.revokeScan()}catch(e){}
  try{await Backend.logout()}catch(e){toast(e.message,'error');return}
  sessionStorage.removeItem(SS_AUTH);sessionStorage.removeItem(SS_KIOSK);location.replace('login.html');
}

function installPasswordEyes(){
  document.querySelectorAll('input[type="password"]').forEach(input=>{
    if(input.closest('.lg-field')||input.dataset.eyeReady)return;
    input.dataset.eyeReady='1';
    const wrap=document.createElement('div');wrap.className='password-control';
    input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const btn=document.createElement('button');btn.type='button';btn.className='password-eye is-closed';btn.setAttribute('aria-label','Show password');btn.setAttribute('title','Show password');
    btn.innerHTML=EYE_OPEN;
    btn.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';btn.classList.toggle('is-open',show);btn.classList.toggle('is-closed',!show);btn.setAttribute('aria-label',show?'Hide password':'Show password');btn.title=show?'Hide password':'Show password';btn.innerHTML=show?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.6A10.8 10.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.8M6.2 6.3C3.5 8.1 2 12 2 12s3.6 6.5 10 6.5a10 10 0 0 0 3-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>':EYE_OPEN;});
    wrap.appendChild(btn);
  });
}
