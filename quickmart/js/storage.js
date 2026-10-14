/* storage.js */
const STORAGE_KEY_PRODUCTS = 'qm_products_v1';
const STORAGE_KEY_SESSIONS = 'qm_sessions_v1';
const STORAGE_KEY_PASSWORD = 'qm_password_v1';
const STORAGE_KEY_USERNAME = 'qm_username_v1';
const STORAGE_KEY_EMAIL = 'qm_email_v1';
const STORAGE_KEY_ACTIVITY = 'qm_activity_v1';

/* per-tab flags (sessionStorage) used by the page guards */
const SS_AUTH='qm_auth';    // manager is signed in
const SS_KIOSK='qm_kiosk';  // manager unlocked the self-checkout kiosk
const SS_FRESH='qm_fresh';  // just signed in -> play the entrance animation

function loadList(key){
  try{const v=JSON.parse(localStorage.getItem(key));return Array.isArray(v)?v:[]}catch(e){return []}
}
const saveProducts=()=>localStorage.setItem(STORAGE_KEY_PRODUCTS,JSON.stringify(state.products));
const saveSessions=()=>localStorage.setItem(STORAGE_KEY_SESSIONS,JSON.stringify(state.sessions));
const loadPassword=()=>localStorage.getItem(STORAGE_KEY_PASSWORD)||'manager123';
const savePassword=pw=>localStorage.setItem(STORAGE_KEY_PASSWORD,pw);
const loadUsername=()=>localStorage.getItem(STORAGE_KEY_USERNAME)||'M-20411';
const saveUsername=u=>localStorage.setItem(STORAGE_KEY_USERNAME,u);
const loadEmail=()=>localStorage.getItem(STORAGE_KEY_EMAIL)||'manager@gmail.com';
const saveEmail=email=>localStorage.setItem(STORAGE_KEY_EMAIL,email);
const saveActivity=()=>localStorage.setItem(STORAGE_KEY_ACTIVITY,JSON.stringify(state.activity));
