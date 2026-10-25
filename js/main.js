/* Page-specific live DB bootstrap. No localStorage authentication or product data. */
async function refreshAll(){
  const result=await Promise.all([Backend.loadProducts(),Backend.loadSessions(),Backend.loadDashboard()]);
  [state.products,state.sessions,state.dashboard]=result;
  if($('#tab-inventory'))state.tags=await Backend.loadTags();
  window.PAGE_RENDER&&window.PAGE_RENDER();
}
window.QuickMart={state,refreshAll,addActivity:pushActivity};
async function initializePage(){
  if($('#login')){
    // Keep login background and modals as designed even if already authenticated.
    if(sessionStorage.getItem(SS_KIOSK)==='1'){
      try{const auth=await Backend.me();if(auth.kiosk_active){location.replace('kiosk.html');return}}catch(e){}
    }
    return;
  }
  try{
    const auth=await Backend.me();
    if(!auth.authenticated){sessionStorage.removeItem(SS_AUTH);sessionStorage.removeItem(SS_KIOSK);location.replace('login.html');return}
    state.manager=auth.manager;
    // Browser storage is only a recovery hint. PHP decides whether the kiosk is authorized.
    if(auth.kiosk_active&&!$('#kiosk')&&!($('#tab-scan')&&!auth.scan_authorized)){
      sessionStorage.setItem(SS_KIOSK,'1');location.replace('kiosk.html');return;
    }
    sessionStorage.setItem(SS_AUTH,'1');
    if($('#user-name'))$('#user-name').textContent=auth.manager.manager_name||'Manager';
    const logoutButton=$('#btn-logout');if(logoutButton)logoutButton.onclick=confirmLogout;
    if($('#kiosk')){
      // Product Recognition must be explicitly started from manager/scan.html.
      // Opening kiosk.html directly must never activate the RFID keyboard reader.
      if(!auth.scan_authorized||!auth.kiosk_active){
        state.kioskOn=false;
        if(window.RFIDScanner)RFIDScanner.disable();
        location.replace('scan.html');return;
      }
      sessionStorage.setItem(SS_KIOSK,'1');
      [state.products,state.tags]=await Promise.all([Backend.loadProducts(),Backend.loadTags()]);
      state.kioskOn=true;await recoverCheckout();return
    }
    if($('#tab-scan')&&auth.kiosk_active&&!auth.scan_authorized){state.kioskOn=false;return}
    await refreshAll();
    if(sessionStorage.getItem(SS_FRESH)){sessionStorage.removeItem(SS_FRESH);document.body.classList.add('app-in');setTimeout(()=>document.body.classList.remove('app-in'),950)}
  }catch(e){toast('Could not load QuickMart: '+e.message,'error');
    if(e.status===401)location.replace('login.html');
    else if($('#kiosk')&&e.status===403){state.kioskOn=false;RFIDScanner.disable();location.replace('scan.html')}}
}
void initializePage();
window.addEventListener('quickmart:scan-authorization-expired',()=>{
  state.kioskOn=false;if(window.RFIDScanner)RFIDScanner.disable();
  location.replace('scan.html');
});
window.addEventListener('pageshow',event=>{
  // A browser history cache must recheck the server instead of reviving stale manager privileges.
  if(event.persisted){state.kioskOn=false;if(window.RFIDScanner)RFIDScanner.disable();void initializePage()}
});
