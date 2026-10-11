/* ===== DASHBOARD: LIVE BACKEND METRICS ===== */
function renderActivity(){
  const items=state.activity.slice(0,6);
  $('#activity-feed').innerHTML=items.map(a=>{
    const i=a.text.indexOf(' - '),ti=i>-1?a.text.slice(0,i):a.text;
    const sub=i>-1?a.text.slice(i+3):'';
    return '<li><div><div class="activity-title">'+esc(ti)+'</div>'+
      (sub?'<div class="activity-sub">'+esc(sub)+'</div>':'')+
      '</div><span class="activity-time">'+new Date(a.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+'</span></li>';
  }).join('')||'<li class="none">No activity yet</li>';
}
let chart,range='daily';
const chartData={daily:{labels:[],data:[]},weekly:{labels:[],data:[]}};
function renderChart(){
  if(typeof Chart==='undefined')return;
  const data=state.dashboard?.[range]||chartData[range]||{labels:[],data:[]};
  if(chart)chart.destroy();
  chart=new Chart($('#salesChart'),{
    type:'line',
    data:{labels:data.labels||[],datasets:[{label:'Sales (₱)',data:data.data||[],
      borderColor:'#146c43',backgroundColor:'rgba(20,108,67,.2)',
      fill:true,tension:.35,pointBackgroundColor:'#ff6b00',pointRadius:5,pointHoverRadius:7}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,ticks:{callback:v=>'₱'+v}},x:{grid:{display:false}}},
      animation:{duration:500,easing:'easeOutQuart'}}
  });
}
function renderDashboard(){
  const metrics=state.dashboard?.summary||{};
  const active=state.products.filter(p=>p.active!==false);
  $('#stat-products').textContent=active.length;
  $('#stat-low').textContent=active.filter(p=>p.stock<=LOW).length;
  $('#stat-trx').textContent=Number(metrics.successful_today||0);
  $('#stat-sales').textContent=peso(metrics.sales_today||0);
  const name=state.manager?.manager_name||'Manager';
  $('#user-name').textContent=name;
  $('#welcome-msg').textContent='Welcome back, '+name+'!';
  renderActivity();renderChart();
}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-goto]');if(t)goTab(t.dataset.goto);
});
$$('.view-all').forEach(v=>v.addEventListener('keydown',e=>{if(e.key==='Enter')v.click()}));
$$('#range button').forEach(b=>b.onclick=()=>{
  range=b.dataset.r;
  $$('#range button').forEach(x=>x.classList.toggle('on',x===b));renderChart();
});
