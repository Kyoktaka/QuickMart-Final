/* Page-specific live DB bootstrap. No localStorage authentication or product data. */
async function refreshAll(){
  const result=await Promise.all([Backend.loadProducts(),Backend.loadSessions(),Backend.loadDashboard()]);
  [state.products,state.sessions,state.dashboard]=result;
  if($('#tab-inventory'))state.tags=await Backend.loadTags();
  window.PAGE_RENDER&&window.PAGE_RENDER();
}
window.QuickMart={state,refreshAll,addActivity:pushActivity};
(async()=>{
  if($('#login')){
    // Keep login background and modals as designed even if already authenticated.
    return;
  }
  try{
    const auth=await Backend.me();
    if(!auth.authenticated){sessionStorage.removeItem(SS_AUTH);sessionStorage.removeItem(SS_KIOSK);location.replace('login.html');return}
    state.manager=auth.manager;
    sessionStorage.setItem(SS_AUTH,'1');
    if($('#user-name'))$('#user-name').textContent=auth.manager.manager_name||'Manager';
    const logoutButton=$('#btn-logout');if(logoutButton)logoutButton.onclick=logout;
    if($('#kiosk')){
      [state.products,state.tags]=await Promise.all([Backend.loadProducts(),Backend.loadTags()]);
      state.kioskOn=true;screen('k-idle');return
    }
    await refreshAll();
    if(sessionStorage.getItem(SS_FRESH)){sessionStorage.removeItem(SS_FRESH);document.body.classList.add('app-in');setTimeout(()=>document.body.classList.remove('app-in'),950)}
  }catch(e){toast('Could not load QuickMart: '+e.message,'error');
    if(e.status===401)location.replace('login.html')}
})();
