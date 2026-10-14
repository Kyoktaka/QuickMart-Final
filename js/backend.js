/* Real same-origin QuickMart PHP/MySQL adapter (not the frontend demo). */
async function apiRequest(path,options={}){
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  let response;
  try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers})}
  catch(e){throw new Error('Cannot reach QuickMart PHP server. Start Apache and MySQL in XAMPP.')}
  const raw=await response.text();let data;
  try{data=raw?JSON.parse(raw):{}}catch(e){throw new Error('Unexpected response from PHP ('+response.status+').')}
  if(!response.ok||data.success===false){const e=new Error(data.message||'Request failed ('+response.status+').');e.status=response.status;e.data=data;throw e}
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
  verifyPassword:password=>apiPost('api/auth/verify-password.php',{password}),
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
  registerEpcs:(product_id,epcs)=>apiPost('api/rfid/register.php',{product_id,epcs}),
  detect:epcs=>apiPost('api/rfid/detect.php',{epcs}),
  logSession:s=>apiPost('api/checkout/log.php',{session_id:s.id,status:s.status,total_amount:s.amount,total_items:s.items}),
  async processPayment(qrText){
    const epcs=[...new Set(state.cart.flatMap(i=>i.scanned||[]))];
    try{const purchase=await apiPost('api/checkout/process.php',{
      session_id:state.current,epcs,payment_qr:String(qrText).trim()
    });return {result:'success',purchase,reason:'Classroom QR checkout confirmed.'}}
    catch(e){if(e.status===422&&['DEMO_INSUFFICIENT_BALANCE','INVALID_DEMO_QR'].includes(e.data?.code))
      return {result:e.data.code==='INVALID_DEMO_QR'?'invalid':'failed',reason:e.message};
      return {result:'error',reason:e.message}}
  },
  newSessionId(){const date=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
    const b=new Uint8Array(5);crypto.getRandomValues(b);
    return 'SESS-'+date+'-'+[...b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}
};
