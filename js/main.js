/* ===== INIT ===== */
function renderAll(){
  state.products.forEach(p=>{p.epcs=p.epcs||[];if(!p.code)p.code=codeFor(p.id)});
  renderDashboard();renderHistory();renderInventory();
}
window.QuickMart={state,renderAll,addActivity:pushActivity,setSalesChart(r,labels,data){chartData[r]={labels,data};renderChart()}};
renderAll();
lock();   // manager must sign in before seeing the system (Log out calls lock() too)
