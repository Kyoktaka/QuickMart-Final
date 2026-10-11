/* ===== HELPERS ===== */
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2600)}
function pushActivity(text,date=new Date()){state.activity.unshift({text,date});state.activity=state.activity.slice(0,30);renderActivity()}
function openModal(id){$('#'+id).classList.add('on')}function closeModal(id){$('#'+id).classList.remove('on')}
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
const sameDay=(a,b)=>new Date(a).toDateString()===new Date(b).toDateString();
const todays=()=>state.sessions.filter(s=>sameDay(s.date,new Date()));
setInterval(()=>$$('[data-clock]').forEach(e=>e.textContent=fmt(new Date())),1000);
$$('[data-clock]').forEach(e=>e.textContent=fmt(new Date()));
