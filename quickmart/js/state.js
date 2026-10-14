/* state.js */
const TIMEOUT=300, LOW=10;
let resetFromLogin=false;
let authPasswordOnly=false;

/* DEMO_MODE: set to false once the backend handles auth – disables the demo account. */
const DEMO_MODE=true, DEMO={
  get username(){return loadUsername()}, set username(v){saveUsername(v)},
  rfid:'RFID-MGR-001',
  get password(){return loadPassword()}, set password(v){savePassword(v)},
  masterKey:'MASTER-2026'
};

const state={
  products: loadList(STORAGE_KEY_PRODUCTS),   // {id,code,name,description,category,stock,price,epcs:[]}
  sessions: loadList(STORAGE_KEY_SESSIONS),   // {id,date,items,amount,status:'success|failed|cancelled',itemsDetail:[{epc,name,qty,price}]}
  cart:[], current:null, seq:0, activity: loadList(STORAGE_KEY_ACTIVITY), authCb:null, kioskOn:false, scanner:null, scanning:false, processing:false
};
state.seq=Math.max(0,...state.sessions.map(s=>parseInt(String(s.id).split('-').pop(),10)||0));
