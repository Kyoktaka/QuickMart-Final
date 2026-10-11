/* ===== STATE ===== */
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const peso=n=>'₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TIMEOUT=300, LOW=10;
let resetFromLogin=false;
let authPasswordOnly=false;

/* DEMO_MODE: set to false once the backend handles auth – disables the demo account and hides the demo-only button. */
const DEMO_MODE=true, DEMO={
  get username(){return loadUsername()}, set username(v){saveUsername(v)},
  rfid:'RFID-MGR-001',
  get password(){return loadPassword()}, set password(v){savePassword(v)},
  masterKey:'MASTER-2026'
};
if(!DEMO_MODE)document.querySelectorAll('.demo-only').forEach(e=>e.remove());

const state={
  products: loadList(STORAGE_KEY_PRODUCTS),   // {id,code,name,description,category,stock,price,epcs:[]}
  sessions: loadList(STORAGE_KEY_SESSIONS),   // {id,date,items,amount,status:'success|failed|cancelled',itemsDetail:[{epc,name,qty,price}]}
  cart:[], current:null, seq:0, activity:[], authCb:null, kioskOn:false, scanner:null, scanning:false, processing:false
};
state.seq=Math.max(0,...state.sessions.map(s=>parseInt(String(s.id).split('-').pop(),10)||0));
