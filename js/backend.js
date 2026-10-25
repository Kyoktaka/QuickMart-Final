/* Real same-origin QuickMart PHP/MySQL adapter (not the frontend demo). */
async function apiRequest(path,options={}){
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  let response;
  try{response=await fetch('../'+path,{credentials:'same-origin',cache:'no-store',...options,headers})}
  catch(e){throw new Error('Cannot reach QuickMart PHP server. Start Apache and MySQL in XAMPP.')}
  const raw=await response.text();let data;
  try{data=raw?JSON.parse(raw):{}}catch(e){throw new Error('Unexpected response from PHP ('+response.status+').')}
  if(!response.ok||data.success===false){
    if(response.status===403&&data.code==='SCAN_AUTH_REQUIRED'&&typeof window!=='undefined'&&typeof CustomEvent!=='undefined')
      window.dispatchEvent(new CustomEvent('quickmart:scan-authorization-expired'));
    const e=new Error(data.message||'Request failed ('+response.status+').');e.status=response.status;e.data=data;throw e}
  return data;
}
const apiPost=(url,body)=>apiRequest(url,{method:'POST',body:JSON.stringify(body)});
const Backend={
  async login(email,password){const r=await apiPost('api/auth/login.php',{email,password});state.manager=r.manager;return r.manager},
  me:()=>apiRequest('api/auth/me.php'),
  logout:()=>apiPost('api/auth/logout.php',{}),
  signup:(admin_name,email,password)=>apiPost('api/auth/signup.php',{admin_name,email,password}),
  requestPasswordReset:email=>apiPost('api/auth/forgot-password.php',{email}),
  resetPassword:(token,password)=>apiPost('api/auth/reset-password.php',{token,password}),
  verifyPassword:password=>apiPost('api/auth/verify-password.php',{password,purpose:state.kioskOn?'exit':'scan'}),
  revokeScan:()=>apiPost('api/auth/revoke-scan.php',{}),
  async loadProducts(){const r=await apiRequest('api/products/list.php?include_inactive=1');return(r.products||[]).map(p=>({
    id:Number(p.product_id),code:p.formatted_product_id||('PRD-'+String(p.product_id).padStart(4,'0')),
    name:p.product_name,description:p.description||'',category:p.category||'General',
    stock:Number(p.stock_available||0),price:Number(p.unit_price||0),active:Number(p.status)===1
  }))},
  async loadTags(){const r=await apiRequest('api/rfid/list.php');return r.tags||[]},
  async loadSessions(){const r=await apiRequest('api/transactions/list.php');return r.transactions||[]},
  loadDashboard:()=>apiRequest('api/dashboard/summary.php'),
  saveProduct:p=>apiPost(p.id?'api/products/update.php':'api/products/create.php',{
    product_id:p.id||undefined,product_name:p.name,description:p.description||'',category:p.category,unit_price:p.price}),
  deleteProduct:product_id=>apiPost('api/products/delete.php',{product_id}),
  setProductStatus:(product_id,enabled)=>apiPost('api/products/set-status.php',{product_id,status:enabled?1:0}),
  authorizeRestock:password=>apiPost('api/rfid/authorize-restock.php',{password}),
  registerEpcs:(product_id,epcs)=>apiPost('api/rfid/register.php',{product_id,epcs}),
  detect:epcs=>apiPost('api/rfid/detect.php',{epcs}),
  saveCheckout:(session_id,epcs)=>apiPost('api/checkout/session.php',{action:'save',session_id,epcs}),
  reviewCheckout:(session_id,epcs)=>apiPost('api/checkout/session.php',{action:'review',session_id,epcs}),
  confirmCheckout:(session_id,revision)=>apiPost('api/checkout/session.php',{action:'confirm',session_id,revision}),
  checkoutStatus:session_id=>apiRequest('api/checkout/session.php'+(session_id?'?session_id='+encodeURIComponent(session_id):'')),
  closeCheckout:(session_id,reason='cancelled')=>apiPost('api/checkout/session.php',{action:reason==='timeout'?'timeout':'cancel',session_id}),
  logSession:s=>Backend.closeCheckout(s.id,s.status==='failed'?'timeout':'cancelled'),
  async processPayment(qrText){
    // Keep one request identity through connection loss and refresh: a retry cannot consume another attempt.
    // Until its outcome is known, a newly scanned QR retries the pending request first.
    const storageKey='quickmart.payment.pending';
    let pending=null;
    try{pending=JSON.parse(sessionStorage.getItem(storageKey)||'null')}catch(_){}
    if(!pending||pending.session_id!==state.current){
      pending={session_id:state.current,attempt_id:Backend.newSessionId(),payment_qr:String(qrText).trim()};
      try{sessionStorage.setItem(storageKey,JSON.stringify(pending))}catch(_){}
    }
    try{
      const r=await apiPost('api/checkout/process.php',pending);
      try{sessionStorage.removeItem(storageKey)}catch(_){}
      return {result:'success',purchase:r.purchase,session:r.session,reason:'Classroom QR checkout confirmed.'};
    }catch(e){
      if(e.status&&e.status<500){try{sessionStorage.removeItem(storageKey)}catch(_){}}
      if(e.status===422&&['DEMO_INSUFFICIENT_BALANCE','INVALID_DEMO_QR','DEMO_NO_INTERNET'].includes(e.data?.code))
        return {result:e.data.code==='INVALID_DEMO_QR'?'invalid':'failed',session:e.data.session,reason:e.message};
      if(e.data?.session?.status==='VOIDED')return {result:'voided',session:e.data.session,reason:e.message};
      return {result:'error',session:e.data?.session,reason:e.message};
    }
  },
  newSessionId(){const date=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
    const b=new Uint8Array(5);crypto.getRandomValues(b);
    return 'SESS-'+date+'-'+[...b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}
};
