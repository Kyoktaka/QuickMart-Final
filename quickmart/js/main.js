/* main.js – runs last on every protected page */
state.products.forEach(p=>{p.epcs=p.epcs||[];if(!p.code)p.code=codeFor(p.id)});

const _out=$('#btn-logout');if(_out)_out.onclick=logout;

/* entrance animation right after signing in */
if(sessionStorage.getItem(SS_FRESH)){sessionStorage.removeItem(SS_FRESH);document.body.classList.add('app-in');setTimeout(()=>document.body.classList.remove('app-in'),950)}

/* hooks for the backend team */
window.QuickMart={state,addActivity:pushActivity,
  refresh(){window.PAGE_RENDER&&window.PAGE_RENDER()},
  setSalesChart(r,labels,data){if(typeof chartData!=='undefined'){chartData[r]={labels,data};renderChart()}}};

window.PAGE_RENDER&&window.PAGE_RENDER();
