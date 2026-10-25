/* history.js */
const TX_PAGE=5, txState={page:1};
const txLabel=st=>st==='success'?'Completed':st==='failed'?'Failed':'Cancelled';
const fmtDay=v=>new Date(v+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function updateDateLabel(){const f=$('#history-from').value,t=$('#history-to').value;
  $('#date-label').textContent=(!f&&!t)?'All dates':(f?fmtDay(f):'Start')+' - '+(t?fmtDay(t):'End')}
function renderHistory(){
  const q=$('#history-search').value.trim().toLowerCase(),f=$('#history-from').value,t=$('#history-to').value,st=$('#history-status').value;
  $('#filter-btn').classList.toggle('has-filter',!!st);
  const list=[...state.sessions].sort((a,b)=>(new Date(b.date)-new Date(a.date))||((b.seq||0)-(a.seq||0))).filter(s=>{
    if(st&&txLabel(s.status).toLowerCase()!==st)return false;
    if(f&&new Date(s.date)<new Date(f+'T00:00:00'))return false;
    if(t&&new Date(s.date)>new Date(t+'T23:59:59'))return false;
    return !q||String(s.id).toLowerCase().includes(q)});
  const total=list.length,pages=Math.max(1,Math.ceil(total/TX_PAGE));
  txState.page=Math.min(Math.max(1,txState.page),pages);
  const start=(txState.page-1)*TX_PAGE,slice=list.slice(start,start+TX_PAGE);
  $('#history-body').innerHTML=slice.length?slice.map((s,i)=>{const l=txLabel(s.status);
    const d=s.itemsDetail||[],n=Number(s.items||0);
    const detail=s.status==='success'
      ?`<div class="detail-content"><h4>Receipt — Items Purchased</h4><table class="detail-table"><thead><tr><th>EPC Code</th><th>Product Detail</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>${d.length?d.map(x=>`<tr><td><code>${esc(x.epc||'—')}</code></td><td>${esc(x.name)}</td><td>${x.qty}</td><td>${peso(x.price*x.qty)}</td></tr>`).join(''):'<tr><td colspan="4" style="text-align:center;color:var(--mute)">No item details available.</td></tr>'}</tbody></table><div class="detail-total"><span>Total (${n} items)</span><span>${peso(s.amount)}</span></div></div>`
      :`<div class="failed-detail"><strong>✕ ${l==='Failed'?'Transaction Failed':'Transaction Cancelled'}</strong><p>Session ID: <b>${esc(s.id)}</b></p><p>Date &amp; Time: <b>${fmt(s.date)}</b></p><p>${s.failReason?'Reason: <b>'+esc(s.failReason)+'</b>':'No receipt available for this transaction.'}</p></div>`;
    return `<tr class="history-row" tabindex="0" aria-expanded="false"><td class="hnum"><span class="toggle-icon">▶</span>${start+i+1}</td><td><b>${esc(s.id)}</b></td><td>${fmt(s.date)}</td><td>${n} items</td><td>${peso(s.amount)}</td><td><span class="badge ${l.toLowerCase()}">${l}</span></td></tr><tr class="history-details"><td colspan="6">${detail}</td></tr>`}).join('')
    :'<tr class="empty"><td colspan="6" class="msg">No transactions found.</td></tr>';
  $('#history-count').textContent=total?`Showing ${start+1}–${start+slice.length} of ${total} transaction${total===1?'':'s'}`:'No transactions to show';
  renderPager($('#history-pg'),txState.page,pages,n=>{txState.page=n;renderHistory()});
}
const toggleHistoryRow=r=>{const o=r.nextElementSibling.classList.toggle('open');r.querySelector('.toggle-icon').classList.toggle('open',o);r.setAttribute('aria-expanded',o)};
$('#history-body').addEventListener('click',e=>{const r=e.target.closest('.history-row');if(r)toggleHistoryRow(r)});
$('#history-body').addEventListener('keydown',e=>{const r=e.target.closest('.history-row');if(r&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleHistoryRow(r)}});
$('#date-btn').addEventListener('click',e=>togglePop($('#date-pop'),e));
$('#date-btn').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();togglePop($('#date-pop'),e)}});
$('#filter-btn').addEventListener('click',e=>togglePop($('#filter-pop'),e));
let txTimer;
$('#history-search').addEventListener('input',()=>{clearTimeout(txTimer);txTimer=setTimeout(()=>{txState.page=1;renderHistory()},300)});
['history-from','history-to'].forEach(id=>$('#'+id).addEventListener('change',()=>{updateDateLabel();txState.page=1;renderHistory()}));
$('#history-status').addEventListener('change',()=>{txState.page=1;renderHistory()});
$('#history-reset').onclick=()=>{$('#history-search').value=$('#history-from').value=$('#history-to').value='';$('#history-status').value='';updateDateLabel();txState.page=1;renderHistory()};
updateDateLabel();
/* The browser may auto-fill a saved email into the first text box on the page. Search must start empty,
   so anything that appears before the manager types is wiped. */
(function keepSearchEmpty(input,rerender){
  if(!input)return;let typed=false;
  ['keydown','paste','drop'].forEach(ev=>input.addEventListener(ev,()=>{typed=true}));
  const wipe=()=>{if(!typed&&input.value!==''){input.value='';rerender()}};
  [0,150,500,1200,2500].forEach(ms=>setTimeout(wipe,ms));
  window.addEventListener('pageshow',()=>{if(!typed)wipe()});
})($('#history-search'),()=>{txState.page=1;renderHistory()});
window.PAGE_RENDER=renderHistory;
