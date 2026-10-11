/* ===== DEMO STORAGE (stand-in for the database; backend team replaces with API calls) ===== */
const STORAGE_KEY_PRODUCTS = 'qm_products_v1';
const STORAGE_KEY_SESSIONS = 'qm_sessions_v1';
const STORAGE_KEY_PASSWORD = 'qm_password_v1';
const STORAGE_KEY_USERNAME = 'qm_username_v1';

function loadList(key){
  try{const v=JSON.parse(localStorage.getItem(key));return Array.isArray(v)?v:[]}catch(e){return []}
}
const saveProducts=()=>localStorage.setItem(STORAGE_KEY_PRODUCTS,JSON.stringify(state.products));
const saveSessions=()=>localStorage.setItem(STORAGE_KEY_SESSIONS,JSON.stringify(state.sessions));
const loadPassword=()=>localStorage.getItem(STORAGE_KEY_PASSWORD)||'manager123';
const savePassword=pw=>localStorage.setItem(STORAGE_KEY_PASSWORD,pw);
const loadUsername=()=>localStorage.getItem(STORAGE_KEY_USERNAME)||'M-20411';
const saveUsername=u=>localStorage.setItem(STORAGE_KEY_USERNAME,u);

/* Demo wallets (stand-in for the payment/wallet service – the backend replaces this) */
const STORAGE_KEY_WALLETS='qm_wallets_v1';
const DEFAULT_WALLETS={};
const WALLET_DB=(()=>{try{const v=JSON.parse(localStorage.getItem(STORAGE_KEY_WALLETS));if(v&&typeof v==='object'&&!Array.isArray(v))return v}catch(e){}return JSON.parse(JSON.stringify(DEFAULT_WALLETS))})();
const saveWallets=()=>localStorage.setItem(STORAGE_KEY_WALLETS,JSON.stringify(WALLET_DB));
