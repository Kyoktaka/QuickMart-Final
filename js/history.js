/* ===== TRANSACTION HISTORY (Completed / Cancelled) ===== */
const TX_PAGE=5, txState={page:1};
const txLabel=st=>st==='success'?'Completed':'Cancelled';   // failed payments are listed as Cancelled
const fmtDay=v=>new Date(v+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function updateDateLabel(){const f=$('#history-from').value,t=$('#history-to').value;
  $('#date-label').textContent=(!f&&!t)?'All dates':(f?fmtDay(f):'Start')+' - '+(t?fmtDay(t):'End')}
function renderHistory(){
  const q=$('#history-search').value.trim().toLowerCase(),f=$('#history-from').value,t=$('#history-to').value,st=$('#history-status').value;
  $('#filter-btn').classList.toggle('has-filter',!!st);
  const list=[...state.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(s=>{
    if(st&&txLabel(s.status).toLowerCase()!==st)return false;
    if(f&&new Date(s.date)<new Date(f+'T00:00:00'))return false;
    if(t&&new Date(s.date)>new Date(t+'T23:59:59'))return false;
    return !q||String(s.id).toLowerCase().includes(q)});
  const total=list.length,pages=Math.max(1,Math.ceil(total/TX_PAGE));
  txState.page=Math.min(txState.page,pages);
  const start=(txState.page-1)*TX_PAGE,slice=list.slice(start,start+TX_PAGE);
  $('#history-body').innerHTML=slice.length?slice.map((s,i)=>{const l=txLabel(s.status);
    const d=s.itemsDetail||[],n=s.status==='success'?(d.length||s.items||0):0;
    const detail=s.status==='success'
      ?`<div class="detail-content"><h4>Receipt — Items Purchased</h4><table class="detail-table"><thead><tr><th>EPC Code</th><th>Product Detail</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>${d.length?d.map(x=>`<tr><td><code>${esc(x.epc)}</code></td><td>${esc(x.name)}</td><td>${x.qty}</td><td>${peso(x.price*x.qty)}</td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--mute)">No item details available.</td></tr>'}</tbody></table><div class="detail-total"><span>Total (${n} items)</span><span>${peso(s.amount)}</span></div></div>`
      :`<div class="failed-detail"><strong>✕ Transaction Cancelled</strong><p>Session ID: <b>${esc(s.id)}</b></p><p>Date &amp; Time: <b>${fmt(s.date)}</b></p><p>${s.failReason?'Reason: <b>'+esc(s.failReason)+'</b>':'No receipt available for this transaction.'}</p></div>`;
    return `<tr class="history-row" tabindex="0" aria-expanded="false"><td class="hnum"><span class="toggle-icon">▶</span>${start+i+1}</td><td><b>${esc(s.id)}</b></td><td>${fmt(s.date)}</td><td>${n} items</td><td>${peso(s.amount)}</td><td><span class="badge ${l.toLowerCase()}">${l}</span></td></tr><tr class="history-details"><td colspan="6">${detail}</td></tr>`}).join('')
    :'<tr class="empty"><td colspan="6" class="msg">No transactions found.</td></tr>';
  const pg=$('#history-pg');pg.innerHTML='';
  const add=(label,page,o={})=>{const b=document.createElement('button');b.textContent=label;b.disabled=!!o.disabled;
    if(o.cur){b.className='cur';b.setAttribute('aria-current','page')}
    b.onclick=()=>{txState.page=page;renderHistory()};pg.appendChild(b)};
  add('<',txState.page-1,{disabled:txState.page<=1});
  const pS=Math.max(1,Math.min(txState.page-2,pages-4)),pE=Math.min(pages,pS+4);
  for(let p=pS;p<=pE;p++)add(p,p,{cur:p===txState.page});
  add('>',txState.page+1,{disabled:txState.page>=pages});
  $('#history-count').textContent=`Showing ${total?start+1:0}-${Math.min(start+TX_PAGE,total)} of ${total}`;
}
const toggleHistoryRow=r=>{const o=r.nextElementSibling.classList.toggle('open');r.querySelector('.toggle-icon').classList.toggle('open',o);r.setAttribute('aria-expanded',o)};
$('#history-body').addEventListener('click',e=>{const r=e.target.closest('.history-row');if(r)toggleHistoryRow(r)});
$('#history-body').addEventListener('keydown',e=>{const r=e.target.closest('.history-row');if(r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleHistoryRow(r)}});
const togglePop=(pop,e)=>{e.stopPropagation();const open=pop.classList.contains('show');$$('.pop').forEach(p=>p.classList.remove('show'));if(!open)pop.classList.add('show')};
$('#date-btn').addEventListener('click',e=>togglePop($('#date-pop'),e));
$('#date-btn').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();togglePop($('#date-pop'),e)}});
$('#filter-btn').addEventListener('click',e=>togglePop($('#filter-pop'),e));
$$('.pop').forEach(p=>p.addEventListener('click',e=>e.stopPropagation()));
document.addEventListener('click',()=>$$('.pop').forEach(p=>p.classList.remove('show')));
let txTimer;
$('#history-search').addEventListener('input',()=>{clearTimeout(txTimer);txTimer=setTimeout(()=>{txState.page=1;renderHistory()},300)});
['history-from','history-to'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateDateLabel();txState.page=1;renderHistory()}));
$('#history-status').addEventListener('change',()=>{txState.page=1;renderHistory()});
$('#history-reset').onclick=()=>{$('#history-search').value=$('#history-from').value=$('#history-to').value='';$('#history-status').value='';updateDateLabel();txState.page=1;renderHistory()};
updateDateLabel();
