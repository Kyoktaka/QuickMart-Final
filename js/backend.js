/* ===== PHP/MySQL API ADAPTER ===== */
async function apiRequest(path,options={}){
  const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
  let response;
  try{response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers})}
  catch(e){throw new Error('Cannot reach QuickMart PHP server. Start Apache and MySQL in XAMPP.')}
  const raw=await response.text();
  let result;
  try{result=raw?JSON.parse(raw):{}}
  catch(e){throw new Error('Invalid response from PHP server ('+response.status+').')}
  if(!response.ok||result.success===false){
    const error=new Error(result.message||'Request failed ('+response.status+').');
    error.status=response.status;error.data=result;throw error;
  }
  return result;
}
function post(path,data){return apiRequest(path,{method:'POST',body:JSON.stringify(data)})}
const Backend={
  async login(email,password){
    const res=await post('api/auth/login.php',{email,password});
    state.manager=res.manager;return res.manager;
  },
  async me(){return apiRequest('api/auth/me.php')},
  async logout(){return post('api/auth/logout.php',{})},
  async signup(username,email,password){
    return post('api/auth/signup.php',{admin_name:username,email,password});
  },
  async requestPasswordReset(email){return post('api/auth/forgot-password.php',{email})},
  async verifyPassword(password){return post('api/auth/verify-password.php',{password})},
  async revokeScan(){return post('api/auth/revoke-scan.php',{})},
  async loadProducts(){const r=await apiRequest('api/products/list.php?include_inactive=1');
    return (r.products||[]).map(p=>({
      id:Number(p.product_id),code:p.formatted_product_id,
      name:p.product_name,description:p.description||'',category:p.category||'General',
      stock:Number(p.stock_available||0),price:Number(p.unit_price||0),size:p.size||'',
      active:Number(p.status)===1
    }));
  },
  async saveProduct(p){
    const path=p.id?'api/products/update.php':'api/products/create.php';
    const r=await post(path,{product_id:p.id||undefined,product_name:p.name,
      description:p.description||'',category:p.category,unit_price:p.price,size:p.size||''});
    return r.product||r;
  },
  async deleteProduct(id){return post('api/products/delete.php',{product_id:id})},
  async setProductStatus(id,enabled){
    return post('api/products/set-status.php',{product_id:id,status:enabled?1:0});
  },
  async registerEpcs(productId,epcs){return post('api/rfid/register.php',{product_id:productId,epcs})},
  async detect(epcs){return post('api/rfid/detect.php',{epcs})},
  async loadSessions(){const r=await apiRequest('api/transactions/list.php');return r.transactions||[]},
  async loadDashboard(){return apiRequest('api/dashboard/summary.php')},
  async logSession(s){
    return post('api/checkout/log.php',{session_id:s.id,status:s.status,
      total_amount:s.amount,total_items:s.items});
  },
  async processPayment(qrText){
    try{
      const epcs=state.cart.flatMap(item=>item.scanned||[]);
      const result=await post('api/checkout/process.php',{
        session_id:state.current,epcs,payment_qr:String(qrText).trim()
      });
      return {result:'success',reason:'Demo checkout recorded.',purchase:result};
    }catch(e){
      if(['INVALID_DEMO_QR','DEMO_WALLET_NOT_FOUND','DEMO_INSUFFICIENT_BALANCE']
        .includes(e.data?.code))return{result:'failed',reason:e.message};
      return {result:'error',reason:e.message};
    }
  },
  newSessionId(){
    const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
    const bytes=new Uint8Array(5);crypto.getRandomValues(bytes);
    return 'SESS-'+stamp+'-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  }
};
/* The USB-HID reader dispatches rfid:tray and rfid:epcs from assets/js/rfid-scanner.js.
   A QR camera dispatches qr:decoded through js/camera-scanner.js. */
