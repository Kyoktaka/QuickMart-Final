/* ===== STATE (API-backed; no local demo accounts) ===== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TIMEOUT=300,LOW=10,DEMO_MODE=false;
let resetFromLogin=false,authPasswordOnly=false;
$$('.demo-only').forEach(e=>e.remove());
const state={
  manager:null,products:[],sessions:[],dashboard:null,cart:[],current:null,
  activity:[],authCb:null,kioskOn:false,scanner:null,scanning:false,processing:false
};
