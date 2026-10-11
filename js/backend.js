/* ===== BACKEND ADAPTER – replace each body with an API call (all async) ===== */
const Backend={
  async login(username,password){/* POST /auth/login */return DEMO_MODE&&username===DEMO.username&&password===DEMO.password},
  async signup(username,password){/* POST /auth/signup – backend should restrict who may create manager accounts */saveUsername(username);savePassword(password);return true},
  async requestPasswordReset(email){/* POST /auth/forgot – send reset email */return true},
  async changePassword(newPassword){/* POST /auth/reset – backend must verify the emailed reset token first */if(DEMO_MODE){DEMO.password=newPassword;return true}return false},
  async verifyCard(card){/* POST /auth/rfid */return DEMO_MODE&&card===DEMO.rfid},
  async verifyPassword(v){/* POST /auth/password */return DEMO_MODE&&v===DEMO.password},
  async verifyMasterKey(v){/* POST /auth/master-key */return DEMO_MODE&&v===DEMO.masterKey},
  async saveProduct(p){saveProducts();return p},
  async deleteProduct(id){saveProducts();return true},
  async assignEpc(productId,epc){saveProducts();return true},
  async saveSession(s){saveSessions();return s},
  async notifyStaff(sessionId){return true},
  async processPayment(qrText,total){/* POST /payments – backend validates the QR, wallet and balance, then returns {result:'success'|'failed',reason} */
    const r=checkScannedPayment(qrText,total);
    if(r.result==='success'){const w=WALLET_DB[String(qrText).split('|')[1]];w.balance=Math.round((w.balance-total)*100)/100;saveWallets()}
    return r},
  newSessionId(){return 'SESS-'+new Date().getFullYear()+'-'+String(++state.seq).padStart(4,'0')}
};
/* Hardware events – dispatch from your WebSocket handler:
   window.dispatchEvent(new CustomEvent('rfid:card',{detail:'<card id>'}))
   window.dispatchEvent(new CustomEvent('rfid:epc',{detail:'<epc>'}))          // inventory "Add quantity" scan
   window.dispatchEvent(new CustomEvent('rfid:tray',{detail:['<epc>',...]}))   // every EPC currently on the tray
   window.dispatchEvent(new CustomEvent('qr:decoded',{detail:'<qr text>'}))     // a QR scanner device / backend read a payment QR (the camera does this itself) */
