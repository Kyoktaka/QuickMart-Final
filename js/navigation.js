/* ===== NAVIGATION ===== */
function goTab(t){$$('#nav button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));$$('.tab').forEach(s=>s.classList.toggle('active',s.id==='tab-'+t));
  if(t==='dashboard')renderDashboard();if(t==='history')renderHistory();if(t==='inventory')renderInventory()}
$$('#nav button').forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
