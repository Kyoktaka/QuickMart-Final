/* pagination (history + inventory): [<] 1 2 3 4 5 [>] */
function renderPager(el,page,pages,onPage){
  if(!el)return;
  const s=Math.max(1,Math.min(page-2,pages-4)),e=Math.min(pages,s+4);
  let h=`<button type="button" data-pg="${page-1}" aria-label="Previous page" ${page<=1?'disabled':''}>&lsaquo;</button>`;
  for(let n=s;n<=e;n++)h+=`<button type="button" data-pg="${n}" class="${n===page?'cur':''}" ${n===page?'aria-current="page"':''} aria-label="Page ${n}">${n}</button>`;
  h+=`<button type="button" data-pg="${page+1}" aria-label="Next page" ${page>=pages?'disabled':''}>&rsaquo;</button>`;
  el.innerHTML=h;
  el.onclick=ev=>{const b=ev.target.closest('button[data-pg]');if(!b||b.disabled)return;onPage(Number(b.dataset.pg))};
}
