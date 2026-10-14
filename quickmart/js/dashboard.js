/* dashboard.js */
function renderActivity(){
  const items=state.activity.slice(0,6);
  $('#activity-feed').innerHTML=items.map(a=>{const i=a.text.indexOf(' - '),ti=i>-1?a.text.slice(0,i):a.text,sub=i>-1?a.text.slice(i+3):'';
    return `<li><div><div class="activity-title">${esc(ti)}</div>${sub?`<div class="activity-sub">${esc(sub)}</div>`:''}</div><span class="activity-time">${new Date(a.date).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span></li>`}).join('')||'<li class="none">No activity yet</li>'}
let chart,range='daily';
const chartData={daily:{labels:[],data:[]},weekly:{labels:[],data:[]}};
function deriveChart(r){
  const ok=state.sessions.filter(x=>x.status==='success'),now=new Date();
  if(r==='daily'){const labels=[],data=[];for(let h=6;h<=22;h++){labels.push((h%12||12)+(h<12?' AM':' PM'));
    data.push(ok.filter(x=>sameDay(x.date,now)&&new Date(x.date).getHours()===h).reduce((a,x)=>a+x.amount,0))}return{labels,data}}
  const labels=[],data=[];for(let d=6;d>=0;d--){const day=new Date(now);day.setDate(now.getDate()-d);
    labels.push(day.toLocaleDateString('en-US',{weekday:'short'}));data.push(ok.filter(x=>sameDay(x.date,day)).reduce((a,x)=>a+x.amount,0))}
  return{labels,data}}
function renderChart(){if(typeof Chart==='undefined')return;const c=chartData[range].labels.length?chartData[range]:deriveChart(range);
  if(chart)chart.destroy();
  chart=new Chart($('#salesChart'),{type:'line',data:{labels:c.labels,datasets:[{label:'Sales (₱)',data:c.data,borderColor:'#146c43',backgroundColor:'rgba(20,108,67,.2)',fill:true,tension:.35,pointBackgroundColor:'#ff6b00',pointRadius:5,pointHoverRadius:7}]},
  options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' '+peso(ctx.parsed.y)}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'₱'+v}},x:{grid:{display:false}}},animation:{duration:1500,easing:'easeOutQuart'}}})}
function renderDashboard(){const ok=todays().filter(s=>s.status==='success');
  animateNumber($('#stat-products'),state.products.length);
  animateNumber($('#stat-low'),state.products.filter(p=>p.stock<=LOW).length);
  animateNumber($('#stat-trx'),ok.length);
  animateNumber($('#stat-sales'),ok.reduce((a,s)=>a+s.amount,0),peso);
  $('#user-name').textContent=DEMO.username;$('#welcome-msg').textContent='Welcome back, '+DEMO.username+'!';
  renderActivity();renderChart()}
$$('#range button').forEach(b=>b.onclick=()=>{range=b.dataset.r;$$('#range button').forEach(x=>x.classList.toggle('on',x===b));renderChart()});

window.PAGE_RENDER=renderDashboard;
