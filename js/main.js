/* ===== APP STARTUP AND SERVER-SIDE REFRESH ===== */
function renderAll(){renderInventory();renderHistory();renderDashboard()}
async function refreshAll(){
  const [products,sessions,dashboard]=await Promise.all([
    Backend.loadProducts(),Backend.loadSessions(),Backend.loadDashboard()
  ]);
  state.products=products;state.sessions=sessions;state.dashboard=dashboard;
  renderAll();
}
window.QuickMart={state,renderAll,refreshAll,addActivity:pushActivity,
  setSalesChart(r,labels,data){chartData[r]={labels,data};renderChart()}};
async function initQuickMart(){
  document.body.classList.add('locked');
  if(openPasswordResetLink())return;
  try{
    const res=await Backend.me();
    if(!res.authenticated)return;
    state.manager=res.manager;
    await refreshAll();
    document.body.classList.remove('locked');goTab('dashboard');
  }catch(e){console.warn('Could not restore session:',e.message)}
}
initQuickMart();
