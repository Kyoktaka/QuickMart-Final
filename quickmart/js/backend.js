/* backend.js */
const Backend={
  async login(email,password){/* POST /auth/login */return DEMO_MODE&&email.toLowerCase()===loadEmail().toLowerCase()&&password===DEMO.password},
  async signup(username,email,password){/* POST /auth/signup */saveUsername(username);saveEmail(email);savePassword(password);return true},
  async requestPasswordReset(email){/* POST /auth/forgot */return true},
  async changePassword(newPassword){/* POST /auth/reset */if(DEMO_MODE){DEMO.password=newPassword;return true}return false},
  async verifyCard(card){/* POST /auth/rfid */return DEMO_MODE&&card===DEMO.rfid},
  async verifyPassword(v){/* POST /auth/password */return DEMO_MODE&&v===DEMO.password},
  async verifyMasterKey(v){/* POST /auth/master-key */return DEMO_MODE&&v===DEMO.masterKey},
  async saveProduct(p){saveProducts();return p},
  async deleteProduct(id){saveProducts();return true},
  async assignEpc(productId,epc){saveProducts();return true},
  async saveSession(s){saveSessions();return s},
  async notifyStaff(sessionId){return true},
  async processPayment(qrText,total){return checkScannedPayment(qrText,total)},
  newSessionId(){return 'SESS-'+new Date().getFullYear()+'-'+String(++state.seq).padStart(4,'0')}
};
/* Hardware events – dispatch from your WebSocket handler:
   window.dispatchEvent(new CustomEvent('rfid:card',{detail:'<card id>'}))
   window.dispatchEvent(new CustomEvent('rfid:epc',{detail:'<epc>'}))
   window.dispatchEvent(new CustomEvent('rfid:tray',{detail:['<epc>',...]}))
   window.dispatchEvent(new CustomEvent('qr:decoded',{detail:'<qr text>'})) */
