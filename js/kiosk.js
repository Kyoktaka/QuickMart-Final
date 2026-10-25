/* Original QuickMart kiosk design, server-authoritative RFID and transactions.
   CART RULES
   - A scanned item is LATCHED: once the server has verified it, it stays in the cart
     even if the (unstable) reader stops seeing the tag.
   - An item leaves the cart only when the customer removes it, cancels the order,
     or the payment completes.
   - While a popup is open (Input Tag, Check your cart, Remove item) the reader is
     blocked, so scanner output can never be typed into a field or added to the cart. */
let timerId=null,left=TIMEOUT,trayRevision=0,blockedTimer=null,retryTimer=null,retryCount=0;
let detectDebounce=null,detectInFlight=false,latestSnapshot=[],removeTarget=null,removeCount=1;
const loggedSessions=new Set(),blockedShownAt=new Map();
const latchedEpcs=new Set();      // every EPC in (or waiting to join) the cart
const removedEpcs=new Map();      // EPC -> time it was last seen missing (null = still being read)
const rejectedEpcs=new Set();     // unknown / inactive EPCs, ignored until the session resets
const absentEpcs=new Set();       // explicit reader expiry, distinct from a cleared or paused snapshot
// A removed tag is re-armed on an actual reader absence event, without a second fixed waiting period.
const CHECKOUT_STORAGE='qm_checkout';
let checkoutSession=null,reviewedRevision=null,saveChain=Promise.resolve(),navigationProtected=false;
const MAX_LOOKUP_RETRIES=3,LOOKUP_RETRY_MS=2500;
// Scanner-typing filter for the Input Tag field: a reader "types" many characters
// within a few milliseconds. Timing cannot identify the USB device: long fast
// hexadecimal human input remains ambiguous, and slow/non-hex reader output can
// escape this fallback. Verified raw bridge mode leaves physical typing alone.
const SCANNER_KEY_GAP_MS=85,SCANNER_BURST_KEYS=12,SCANNER_BURST_END_MS=400,SCANNER_HOLD_GAP_MS=340;
const SCANNER_HEX_KEY=/^[A-Fa-f0-9]$/;
const HOLD_MODALS=['m-tag','m-confirm','m-remove'];
const TRASH_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const normEpc=v=>String(v??'').trim().replace(/\s+/g,'').toUpperCase();
const cartTotal=()=>state.cart.reduce((n,i)=>n+i.price*i.qty,0);
const cartQty=()=>state.cart.reduce((n,i)=>n+i.qty,0);
function stopTimer(){clearInterval(timerId);timerId=null}

function rememberCart(){
  try{sessionStorage.setItem(CHECKOUT_STORAGE,JSON.stringify({
    id:state.current,epcs:[...latchedEpcs],removed:[...removedEpcs.keys()]
  }))}catch(e){toast('Browser recovery storage is unavailable. Keep this checkout open.','error')}
}
function protectNavigation(){
  if(navigationProtected||!state.current)return;
  navigationProtected=true;
  if(typeof history!=='undefined'&&history.pushState)history.pushState({quickmartCheckout:state.current},'',location.href);
}
function applyCheckout(session){
  checkoutSession=session;state.checkout=session;state.current=session.session_id;
  state.cart=(session.cart||[]).map(item=>({...item,code:codeFor(item.id),scanned:(item.scanned||[]).map(normEpc)}));
  latchedEpcs.clear();state.cart.forEach(item=>item.scanned.forEach(epc=>latchedEpcs.add(epc)));
  rememberCart();protectNavigation();
}
function applyCheckoutSession(session){if(session)applyCheckout(session)}
async function handleCheckoutTerminal(result){
  const session=result?.session;
  if(!session||!['SUCCESSFUL','VOIDED'].includes(session.status))return false;
  reviewedRevision=null;applyCheckout(session);
  closeHold('m-confirm');
  if(session.status==='SUCCESSFUL'){await completePayment(result.purchase);return true}
  $('#fail-reason').textContent=session.reason||'This checkout is closed. Confirm the cart before starting another order.';
  screen('k-fail');return true;
}
function saveCart(){
  rememberCart();protectNavigation();
  if(!state.current)return Promise.resolve();
  const id=state.current,epcs=state.cart.flatMap(item=>item.scanned);
  const task=saveChain.catch(()=>{}).then(async()=>{
    let result;
    try{result=await Backend.saveCheckout(id,epcs)}
    catch(e){
      if(e.data?.code!=='ACTIVE_CHECKOUT'||!e.data.session||state.current!==id)throw e;
      result={session:e.data.session};applyCheckout(result.session);renderCart();
      toast('Recovered the existing checkout. Continue or cancel it before starting another order.');
      if(result.session.status==='PAYMENT'){screen('k-qr');startTimer(result.session.deadline_at);void startCameraScanner()}
      else screen(state.cart.length?'k-cart':'k-idle');
      return result;
    }
    if(state.current===id){
      checkoutSession=result.session;state.checkout=result.session;
      await handleCheckoutTerminal(result);
    }
    return result;
  });
  saveChain=task;
  void task.catch(e=>{if(state.current===id)toast('Cart recovery sync delayed: '+e.message,'error')});
  return task;
}
async function recoverCheckout(){
  let saved=null;
  try{saved=JSON.parse(sessionStorage.getItem(CHECKOUT_STORAGE)||'null')}catch(e){}
  for(const epc of saved?.removed||[])removedEpcs.set(normEpc(epc),null);
  let result;
  try{result=await Backend.checkoutStatus(saved?.id||null)}
  catch(e){
    if(e.data?.code!=='CHECKOUT_NOT_FOUND'||!saved?.id||!Array.isArray(saved.epcs))throw e;
    // A refresh can interrupt the first save. Recover EPC identities through fresh server validation.
    const pending=saved.epcs.map(normEpc).filter(epc=>!removedEpcs.has(epc));
    try{result=await Backend.saveCheckout(saved.id,pending)}
    catch(saveError){
      if(saveError.data?.code!=='ACTIVE_CHECKOUT'||!saveError.data.session)throw saveError;
      result={session:saveError.data.session};
    }
  }
  if(!result.session){resetKiosk(true);return}
  const session=result.session;applyCheckout(session);renderCart();
  if(await handleCheckoutTerminal(result))return;
  if(session.status==='PAYMENT'){
    screen('k-qr');startTimer(session.deadline_at);void startCameraScanner();return;
  }
  // Only EPC identities are recovered from the browser; PHP validates every pending change again.
  if(saved?.id===session.session_id&&Array.isArray(saved.epcs)){
    const pending=saved.epcs.map(normEpc).filter(epc=>!removedEpcs.has(epc));
    if(pending.join('\n')!==[...latchedEpcs].join('\n')){
      const synced=await Backend.saveCheckout(session.session_id,pending);applyCheckout(synced.session);
      if(await handleCheckoutTerminal(synced))return;
    }
  }
  renderCart();screen(state.cart.length?'k-cart':'k-idle');
}
window.addEventListener('beforeunload',event=>{
  if(!state.current||loggedSessions.has(state.current))return;
  rememberCart();event.preventDefault();event.returnValue='';
});
window.addEventListener('pagehide',()=>{if(state.current||removedEpcs.size)rememberCart()});
window.addEventListener('popstate',()=>{
  if(!state.kioskOn||!state.current||loggedSessions.has(state.current))return;
  if(typeof history!=='undefined'&&history.pushState)history.pushState({quickmartCheckout:state.current},'',location.href);
  toast('Checkout remains active. Use the checkout controls or Manager exit.');
});

/* ---------- inactivity: the shopping cart returns to the scanning screen after 2 minutes ----------
   Any tap, click, key press, scroll, mouse movement or newly scanned/typed tag restarts the countdown.
   When it runs out the order is cancelled (logged as a cancelled transaction) and the Welcome screen
   is shown. Items still lying on the reader stay blocked until they are taken away. */
const CART_IDLE_MS=120000;
let idleTimer=null,lastActivity=0;
function disarmIdle(){clearTimeout(idleTimer);idleTimer=null}
function armIdle(){clearTimeout(idleTimer);lastActivity=Date.now();idleTimer=setTimeout(onIdleExpired,CART_IDLE_MS)}
// Activity only stamps the time (no timer churn on every mouse move / reader keystroke).
function bumpIdle(){if(idleTimer!==null)lastActivity=Date.now()}
async function onIdleExpired(){
  idleTimer=null;
  const remaining=CART_IDLE_MS-(Date.now()-lastActivity);
  if(remaining>50){idleTimer=setTimeout(onIdleExpired,remaining);return}
  if(!$('#k-cart').classList.contains('on'))return;
  // Never reset underneath a payment check or the manager password popup: wait another full period.
  if(state.processing||$('#m-auth').classList.contains('on')){armIdle();return}
  holdCurrentTags();
  // Preserve recovery information until the server acknowledges the cancellation.
  if(state.current&&!loggedSessions.has(state.current)&&!await finalize('cancelled','Cart timed out after 2 minutes of inactivity')){armIdle();return}
  resetKiosk(true);toast('Session timed out due to inactivity.');
}
['pointerdown','mousemove','keydown','touchstart','wheel'].forEach(t=>document.addEventListener(t,bumpIdle,{passive:true,capture:true}));
document.addEventListener('scroll',bumpIdle,true);

/* ---------- reader on/off + popup hold ---------- */
function syncScannerHold(){
  const held=HOLD_MODALS.some(id=>$('#'+id)?.classList.contains('on'));
  // Hard-stop HID capture while any kiosk dialog is open. This prevents EPC
  // bursts from being swallowed as keyboard input or disrupting dialog controls.
  if(typeof RFIDScanner.setBlocked==='function')RFIDScanner.setBlocked(held);
  const activeScreen=$('#k-idle')?.classList.contains('on')||$('#k-cart')?.classList.contains('on');
  RFIDScanner.setEnabled(Boolean(state.kioskOn&&activeScreen&&!$('#m-auth')?.classList.contains('on')));
}
function openHold(id){openModal(id);syncScannerHold()}
function closeHold(id){closeModal(id);syncScannerHold()}
function screen(id){
  $$('.screen').forEach(el=>el.classList.toggle('on',el.id===id));
  $('#kiosk').classList.toggle('idle',id==='k-idle');
  $('#kiosk').classList.toggle('cartview',id==='k-cart');
  if(id!=='k-qr'){stopTimer();stopCameraScanner()}
  if(id==='k-cart'){if(idleTimer===null)armIdle()}else disarmIdle();
  syncScannerHold();
}

/* ---------- cart table ---------- */
function drawConfirm(){
  $('#confirm-body').innerHTML=state.cart.map((i,n)=>`<tr>
    <td>${n+1}</td><td>${esc(i.name)}</td><td class="pid">${esc(i.code||codeFor(i.id))}</td>
    <td>${peso(i.price)}</td><td>${i.qty}</td><td><b>${peso(i.price*i.qty)}</b></td></tr>`).join('');
  $('#confirm-items').textContent=cartQty();$('#confirm-total').textContent=peso(cartTotal());
}
function renderCart(){
  const detected=new Set(RFIDScanner.getPresentEpcs().map(normEpc));
  const html=state.cart.map((i,n)=>`<tr data-product-id="${i.id}">
    <td>${n+1}</td><td>${esc(i.name)}${i.scanned.map((epc,index)=>`<br><small class="sub" data-detection="${detected.has(epc)?'present':'absent'}" data-epc="${esc(epc)}" title="${esc(epc)}">${i.qty>1?'Item '+(index+1)+': ':''}${detected.has(epc)?'Currently Detected':'Currently Not Detected'}</small>`).join('')}</td><td class="pid">${esc(i.code||codeFor(i.id))}</td>
    <td>${peso(i.price)}</td><td>${i.qty}</td><td><b>${peso(i.price*i.qty)}</b></td>
    <td><button class="rm-btn" type="button" data-remove="${i.id}" aria-label="Remove ${esc(i.name)} from cart">${TRASH_SVG}Remove</button></td></tr>`).join('')||
    '<tr><td colspan="7">No RFID products detected.</td></tr>';
  // Only touch the DOM when something changed, so a tap is never lost to a redraw.
  if(renderCart.last!==html){renderCart.last=html;$('#cart-body').innerHTML=html}
  $('#sum-items').textContent=cartQty();$('#sum-tax').textContent=peso(0);
  $('#sum-total').textContent=peso(cartTotal());$('#qr-total').textContent=peso(cartTotal());
  if($('#m-confirm').classList.contains('on'))drawConfirm();
}
function drawTimer(){$('#qr-timer').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')}
function startTimer(deadlineAt=checkoutSession?.deadline_at){stopTimer();
  const deadline=Number(deadlineAt)||Date.now()+TIMEOUT*1000;
  const tick=()=>{
  left=Math.max(0,Math.ceil((deadline-Date.now())/1000));drawTimer();if(left<=0){stopTimer();stopCameraScanner();
    const reason='Payment timed out after 5 minutes.';
    $('#fail-reason').textContent=reason;void finalize('failed',reason);screen('k-fail');
  }
  };tick();if(left>0)timerId=setInterval(tick,1000)}
async function finalize(status,reason){
  if(!state.current||loggedSessions.has(state.current))return true;
  const session={id:state.current,items:cartQty(),amount:cartTotal(),status};
  try{await saveChain.catch(()=>{});
    let result;
    try{result=await Backend.closeCheckout(session.id,status==='failed'?'timeout':'cancelled')}
    catch(e){
      if(e.data?.code!=='CHECKOUT_NOT_FOUND'||status==='failed')throw e;
      await Backend.saveCheckout(session.id,state.cart.flatMap(item=>item.scanned));
      result=await Backend.closeCheckout(session.id,'cancelled');
    }
    checkoutSession=result.session;state.checkout=result.session;
    if(result.session.status==='SUCCESSFUL'){await handleCheckoutTerminal(result);return false}
    if(result.session.status!=='VOIDED'){
      applyCheckout(result.session);screen('k-qr');startTimer(result.session.deadline_at);
      toast('Payment remains active on the server.');return false;
    }
    loggedSessions.add(session.id);pushActivity('Session '+session.id.slice(-8)+' '+status+' - '+peso(session.amount));return true}
  catch(e){toast('Could not save checkout attempt: '+e.message,'error');return false}
}

/* ---------- reset helpers ---------- */
function clearCartMemory(){
  latchedEpcs.clear();removedEpcs.clear();rejectedEpcs.clear();blockedShownAt.clear();
  clearTimeout(retryTimer);retryTimer=null;retryCount=0;
}
// Cancelled items may still be lying on the reader; keep them out until they are really gone.
function holdCurrentTags(){for(const epc of latchedEpcs)removedEpcs.set(epc,null)}
function resetKiosk(keepHeld=false,forgetSaved=true){
  const held=keepHeld?new Map(removedEpcs):null;
  clearTimeout(detectDebounce);detectDebounce=null;
  latestSnapshot=[];clearTimeout(blockedTimer);stopTimer();stopCameraScanner();trayRevision++;
  clearCartMemory();if(held)for(const [epc,seen] of held)removedEpcs.set(epc,seen);
  state.cart=[];state.current=null;state.processing=false;removeTarget=null;
  checkoutSession=null;state.checkout=null;reviewedRevision=null;navigationProtected=false;
  if(forgetSaved){if(keepHeld&&removedEpcs.size)rememberCart();else sessionStorage.removeItem(CHECKOUT_STORAGE)}
  closeModal('m-tag');closeModal('m-blocked');closeModal('m-confirm');closeModal('m-remove');
  renderCart();screen('k-idle');
}
async function exitKiosk(){
  if(state.processing){toast('Payment is being verified. Please wait.');return}
  if(state.current&&!loggedSessions.has(state.current)&&!await finalize('cancelled','Manager exited'))return;
  try{await Backend.revokeScan()}catch(e){toast(e.message,'error');return}
  state.kioskOn=false;RFIDScanner.disable();sessionStorage.removeItem(SS_KIOSK);sessionStorage.removeItem(CHECKOUT_STORAGE);location.replace('dashboard.html');
}
$('#btn-kiosk-exit').onclick=()=>openAuth(exitKiosk,2,true);

/* ---------- blocked ("already purchased") popup ---------- */
function showBlocked(name){
  closeTagModal();$('#tag-modal-input').value='';$('#blk-name').textContent=name;
  openModal('m-blocked');clearTimeout(blockedTimer);blockedTimer=setTimeout(()=>closeModal('m-blocked'),4000);
}
function notifyBlocked(epc){
  const now=Date.now();if(now-(blockedShownAt.get(epc)||0)<8000)return;
  blockedShownAt.set(epc,now);
  const tag=state.tags.find(t=>String(t.epc).toUpperCase()===epc);
  const product=state.products.find(p=>p.id===Number(tag?.product_id));
  showBlocked(product?.name||'RFID '+epc);
}

/* ---------- RFID tray -> latched cart ---------- */
// Add newly seen EPCs to the latched set. Returns true when something new was added.
function absorbEpcs(list){
  let grew=false;
  for(const raw of list){
    const epc=normEpc(raw);
    if(!epc||latchedEpcs.has(epc)||removedEpcs.has(epc)||rejectedEpcs.has(epc))continue;
    latchedEpcs.add(epc);grew=true;
  }
  return grew;
}
// A removed tag is accepted again only after the reader has NOT seen it for a while,
// i.e. the customer really took it away. Paused while the reader is blocked or off.
function releaseRemoved(epc){
  if(typeof epc!=='string'||!removedEpcs.size||!RFIDScanner.isEnabled())return;
  if(typeof RFIDScanner.isBlocked==='function'&&RFIDScanner.isBlocked())return;
  removedEpcs.delete(normEpc(epc));rememberCart();
}
window.addEventListener('rfid:absent',event=>{
  const epc=normEpc(event.detail?.epc);if(epc)absentEpcs.add(epc);
  releaseRemoved(epc);if(state.kioskOn)renderCart();
});
// Verify the whole latched set with the server. Rapid scans are coalesced into one call.
function scheduleLookup(){
  clearTimeout(detectDebounce);detectDebounce=null;clearTimeout(retryTimer);retryTimer=null;
  latestSnapshot=[...latchedEpcs];
  const revision=++trayRevision,snapshot=latestSnapshot;
  if(!snapshot.length)return;
  // This short internal debounce is NOT an expiry timer or visible countdown.
  detectDebounce=setTimeout(()=>{detectDebounce=null;void refreshTray(snapshot,revision)},180);
}
function queueTray(snapshot){
  for(const epc of snapshot||[])absentEpcs.delete(normEpc(epc));
  renderCart();
  if(absorbEpcs(snapshot||[])){retryCount=0;bumpIdle();scheduleLookup()}
}
// If a lookup result had to be discarded (e.g. while paying), verify again later.
function reverifyCart(){
  const inCart=new Set(state.cart.flatMap(i=>i.scanned||[]));
  if([...latchedEpcs].some(epc=>!inCart.has(epc))){retryCount=0;scheduleLookup()}
}
async function refreshTray(epcs,revision){
  if(detectInFlight||!state.kioskOn)return;
  detectInFlight=true;
  try{
    const res=await Backend.detect(epcs);
    // Apply the result only on the idle/cart screens (never over the payment or result screens).
    if(revision!==trayRevision||!state.kioskOn||(!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on')))return;
    const valid=new Set();
    state.cart=(res.grouped_items||[]).map(item=>{
      const scanned=(item.epcs||[]).map(normEpc);scanned.forEach(epc=>valid.add(epc));
      return{id:Number(item.product_id),name:item.product_name,code:codeFor(item.product_id),
        price:Number(item.unit_price),qty:Number(item.quantity),scanned};
    });
    // Keep only server-verified tags latched; refused tags are ignored from now on.
    for(const epc of [...latchedEpcs])if(!valid.has(epc))latchedEpcs.delete(epc);
    const unknown=(res.unknown_epcs||[]).map(normEpc),inactive=(res.inactive_epcs||[]).map(normEpc);
    for(const epc of [...unknown,...inactive])rejectedEpcs.add(epc);
    for(const epc of res.purchased_epcs||[])notifyBlocked(normEpc(epc));
    if(unknown.length)toast(unknown.length+' unknown EPC(s) ignored','error');
    if(inactive.length)toast(inactive.length+' inactive EPC(s) ignored','error');
    retryCount=0;
    if(!state.cart.length){if(state.current)void saveCart();renderCart();screen('k-idle');return}
    if(!state.current)state.current=Backend.newSessionId();
    void saveCart();
    renderCart();screen('k-cart');
  }catch(e){
    // A database/network failure must NOT clear the cart. Scanned tags stay latched and are retried.
    if(revision===trayRevision){
      toast('RFID detection delayed: '+e.message,'error');
      if(latchedEpcs.size&&retryCount<MAX_LOOKUP_RETRIES){
        retryCount++;clearTimeout(retryTimer);
        retryTimer=setTimeout(()=>{retryTimer=null;scheduleLookup()},LOOKUP_RETRY_MS);
      }
    }
  }finally{
    detectInFlight=false;
    // Never discard a newer scan just because an older lookup was busy.
    if(revision!==trayRevision&&latchedEpcs.size&&state.kioskOn){
      clearTimeout(detectDebounce);
      const snapshot=[...latchedEpcs],latestRevision=trayRevision;
      detectDebounce=setTimeout(()=>{detectDebounce=null;void refreshTray(snapshot,latestRevision)},100);
    }
  }
}
window.addEventListener('rfid:tray',e=>{
  if(!state.kioskOn||(!$('#k-idle').classList.contains('on')&&!$('#k-cart').classList.contains('on'))||!RFIDScanner.isEnabled())return;
  queueTray(e.detail||[]);
});

/* ---------- remove an item from the cart ---------- */
const removeItem=()=>state.cart.find(i=>i.id===removeTarget);
function drawRemoveCount(){
  const item=removeItem();if(!item)return;
  $('#rm-count').textContent=removeCount;$('#rm-stepper').hidden=item.qty<2;
  $('#rm-sub').textContent=item.qty<2?'Quantity in cart: 1':'Quantity in cart: '+item.qty+' · removing '+removeCount;
  $('#rm-minus').disabled=removeCount<=1;$('#rm-plus').disabled=removeCount>=item.qty;
}
function openRemoveModal(productId){
  const item=state.cart.find(i=>i.id===productId);if(!item)return;
  removeTarget=productId;removeCount=item.qty;$('#rm-name').textContent=item.name;
  drawRemoveCount();document.activeElement?.blur?.();openHold('m-remove');
}
function closeRemoveModal(){removeTarget=null;closeHold('m-remove')}
// Removes `count` units of a product. The tag is un-latched immediately so it
// can be re-scanned right away if the customer changed their mind. Physically
// lifting the tag off the reader is only necessary if they don't want it.
function removeFromCart(productId,count){
  const item=state.cart.find(i=>i.id===productId);if(!item)return false;
  const n=Math.max(1,Math.min(Math.floor(Number(count))||1,item.scanned.length));
  const gone=item.scanned.slice(item.scanned.length-n);
  // Un-latch only — do NOT add to removedEpcs. The next tray event re-absorbs
  // any tag still on the reader, so the customer can immediately re-scan.
  // A truly unwanted item must be lifted off the reader to stay out of the cart.
  for(const epc of gone){latchedEpcs.delete(epc);removedEpcs.delete(epc)}
  item.scanned=item.scanned.slice(0,item.scanned.length-n);item.qty=item.scanned.length;
  if(!item.qty)state.cart=state.cart.filter(i=>i!==item);
  renderCart();
  if(!state.cart.length)screen('k-idle');
  void saveCart();
  scheduleLookup();   // re-verify what is left (and anything still waiting to join)
  // Tag still on reader? Next tray sweep re-adds it automatically.
  const stillPresent=gone.some(epc=>!absentEpcs.has(normEpc(epc)));
  toast('Removed '+(n>1?n+' × ':'')+item.name+'.'+(stillPresent?' Scan again to re-add, or lift it off to keep it removed.':''));
  return true;
}
$('#cart-body').addEventListener('click',e=>{
  const btn=e.target?.closest?.('[data-remove]');if(!btn)return;
  openRemoveModal(Number(btn.dataset.remove));
});
$('#rm-minus').onclick=()=>{if(removeCount>1){removeCount--;drawRemoveCount()}};
$('#rm-plus').onclick=()=>{const item=removeItem();if(item&&removeCount<item.qty){removeCount++;drawRemoveCount()}};
$('#rm-keep').onclick=closeRemoveModal;
$('#rm-confirm').onclick=()=>{const id=removeTarget,n=removeCount;closeRemoveModal();if(id!==null)removeFromCart(id,n)};
$('#m-remove').addEventListener('click',e=>{if(e.target.id==='m-remove')closeRemoveModal()});

/* ---------- Input Tag popup ---------- */
let tkLast=0,tkFastRun=0,tkBefore='',tkBurst=false,tkBurstTimer=null,tagSubmission=null;
function resetTagTypingGuard(){tkLast=0;tkFastRun=0;tkBefore='';tkBurst=false;clearTimeout(tkBurstTimer);tkBurstTimer=null}
function openTagModal(){
  tagSubmission=null;
  $('#tag-modal-input').value='';resetTagTypingGuard();openHold('m-tag');   // reader blocked while typing
  setTimeout(()=>$('#tag-modal-input').focus(),60);
}
function closeTagModal(){tagSubmission=null;resetTagTypingGuard();closeHold('m-tag')}
async function submitTagModal(){
  if(tagSubmission)return;
  const field=$('#tag-modal-input'),epc=normEpc(field.value);
  if(!epc)return toast('Enter a tag first','error');
  if(!/^[A-Z0-9:_-]{1,100}$/.test(epc))return toast('Invalid EPC','error');
  if(latchedEpcs.has(epc)||state.cart.some(i=>i.scanned.includes(epc)))return toast('Tag already in cart','error');
  const submission={revision:trayRevision,id:state.current,value:field.value};
  tagSubmission=submission;
  const current=()=>tagSubmission===submission&&submission.revision===trayRevision&&submission.id===state.current
    &&state.kioskOn&&$('#m-tag').classList.contains('on')&&field.value===submission.value;
  try{
    const r=await Backend.detect([epc]);
    if(!current())return;
    if(r.purchased_epcs?.map(normEpc).includes(epc)){notifyBlocked(epc);return}
    if(!r.grouped_items?.length){toast('EPC not registered or product unavailable','error');return}
    removedEpcs.delete(epc);rejectedEpcs.delete(epc);   // typing a tag is an explicit request to add it
    field.value='';closeTagModal();
    if(absorbEpcs([epc])){retryCount=0;scheduleLookup()}
  }catch(e){if(current())toast(e.message,'error')}
  finally{if(tagSubmission===submission)tagSubmission=null}
}
// Keyboard-wedge readers type into whichever field has focus. Characters arriving at
// a recognized fast hexadecimal EPC speed are discarded (the fragment already typed
// is rolled back); ordinary typing, paste and Backspace pass through immediately.
// Fast hexadecimal typing is ambiguous without the verified independent raw bridge.
function armBurstEnd(){
  clearTimeout(tkBurstTimer);
  tkBurstTimer=setTimeout(()=>{
    tkBurst=false;tkFastRun=0;
    // Keep touchscreen/manual typing ready after rejected USB-HID reader burst,
    // but never steal focus from another field or a button the person selected.
    const field=$('#tag-modal-input');
    if((!document.activeElement||document.activeElement===document.body)&&$('#m-tag')?.classList.contains('on'))field.focus({preventScroll:true});
  },SCANNER_BURST_END_MS);
}
$('#tag-modal-input').addEventListener('keydown',e=>{
  if(e.key==='Shift'||e.key==='CapsLock')return;
  // The application-wide capture guard owns scanner filtering on real pages;
  // do not run a second independent detector with a different rollback baseline.
  if(globalThis.QuickMartInputGuard){
    if(e.key==='Enter'){
      const accept=!e.defaultPrevented&&!QuickMartInputGuard.isDiscarding($('#tag-modal-input'));
      e.preventDefault();
      if(accept)void submitTagModal();
    }
    return;
  }
  if(e.ctrlKey||e.metaKey||e.altKey||e.repeat){resetTagTypingGuard();return}
  const enter=e.key==='Enter',printable=typeof e.key==='string'&&e.key.length===1;
  const hex=printable&&(SCANNER_HEX_KEY.test(e.key)||/^(?:Digit[0-9]|Key[A-F])$/.test(e.code||''));
  const raw=RFIDScanner.getBridgeHealth?.();
  if(raw?.connected||(raw?.paused&&raw.lastVerifiedConnected)){
    resetTagTypingGuard();if(enter){e.preventDefault();void submitTagModal()}return;
  }
  if(!enter&&!printable){resetTagTypingGuard();return}
  const field=$('#tag-modal-input'),t=Date.now(),gap=t-tkLast;tkLast=t;
  if(tkBurst){
    // Reader still typing (and its closing Enter): discard the recognized frame.
    // A slower or non-hex key ends the burst so ordinary input can resume.
    if((hex&&gap<=SCANNER_HOLD_GAP_MS)||enter){e.preventDefault();armBurstEnd();return}
    resetTagTypingGuard();
  }
  if(enter){e.preventDefault();void submitTagModal();return}
  if(!hex){tkFastRun=0;return}
  if(gap>=SCANNER_KEY_GAP_MS||!tkFastRun){tkFastRun=1;tkBefore=field.value;return}
  if(++tkFastRun>=SCANNER_BURST_KEYS){
    tkBurst=true;e.preventDefault();field.value=tkBefore;
    try{field.dispatchEvent(new Event('input',{bubbles:true}));field.focus({preventScroll:true});field.setSelectionRange(field.value.length,field.value.length)}catch(_){}
    armBurstEnd();
  }
});
$('#btn-idle-tag').onclick=openTagModal;$('#btn-input-tag-toggle').onclick=openTagModal;
$('#tag-modal-confirm').onclick=submitTagModal;
$('#m-tag').addEventListener('click',e=>{if(e.target.id==='m-tag')closeTagModal()});
$('#m-blocked').addEventListener('click',()=>{clearTimeout(blockedTimer);closeModal('m-blocked')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeTagModal();closeHold('m-confirm');closeRemoveModal();closeModal('m-blocked')}});

/* ---------- Checkout: "Check your cart" first, then the QR payment screen ---------- */
async function openConfirmModal(){
  if(!state.cart.length)return toast('Scan a product first','error');
  if(detectInFlight||detectDebounce||latchedEpcs.size!==cartQty())return toast('Product validation is still running. Please wait.');
  const id=state.current;reviewedRevision=null;$('#confirm-ok').disabled=true;
  drawConfirm();document.activeElement?.blur?.();openHold('m-confirm');
  try{
    await saveChain.catch(()=>{});
    const result=await Backend.reviewCheckout(id,state.cart.flatMap(item=>item.scanned));
    if(state.current!==id||!$('#m-confirm').classList.contains('on'))return;
    if(await handleCheckoutTerminal(result))return;
    applyCheckout(result.session);reviewedRevision=result.session.revision;renderCart();drawConfirm();
    $('#confirm-ok').disabled=false;
  }catch(e){closeHold('m-confirm');toast('Could not review the cart: '+e.message,'error')}
}
async function startPayment(){
  if(state.processing||reviewedRevision===null)return;
  if(!state.cart.length)return toast('Scan a product first','error');
  state.processing=true;$('#confirm-ok').disabled=true;
  try{
    const result=await Backend.confirmCheckout(state.current,reviewedRevision);
    if(await handleCheckoutTerminal(result))return;
    applyCheckout(result.session);
    closeHold('m-confirm');resetQrFailureAttempts();$('#btn-cam-retry').textContent='Try camera again';renderCart();screen('k-qr');startTimer(result.session.deadline_at);void startCameraScanner();
  }catch(e){toast('Could not start payment: '+e.message,'error')}
  finally{state.processing=false;$('#confirm-ok').disabled=false}
}
$('#btn-checkout').onclick=openConfirmModal;
$('#confirm-back').onclick=()=>closeHold('m-confirm');
$('#confirm-ok').onclick=startPayment;
$('#m-confirm').addEventListener('click',e=>{if(e.target.id==='m-confirm')closeHold('m-confirm')});
$('#btn-retry').onclick=async()=>{
  if(state.processing)return;
  state.processing=true;
  try{
    await saveChain.catch(()=>{});
    if(state.current){
      const previous=await Backend.checkoutStatus(state.current);
      if(previous.session?.status==='SUCCESSFUL'){await handleCheckoutTerminal(previous);return}
      if(previous.session?.status!=='VOIDED'){
        applyCheckout(previous.session);renderCart();
        if(previous.session.status==='PAYMENT'){screen('k-qr');startTimer(previous.session.deadline_at);void startCameraScanner()}
        else screen(state.cart.length?'k-cart':'k-idle');
        toast('Previous checkout remains active. Continue or cancel it before starting another order.');return;
      }
      applyCheckout(previous.session);
    }
    state.current=Backend.newSessionId();checkoutSession=null;state.checkout=null;reviewedRevision=null;
    resetQrFailureAttempts();await saveCart();renderCart();screen(state.cart.length?'k-cart':'k-idle');
  }catch(e){toast('Could not restart checkout: '+e.message,'error')}
  finally{state.processing=false}
  if(state.cart.length)void openConfirmModal();
};
$('#btn-qr-back').onclick=()=>{if(state.processing)return;screen('k-cart');renderCart();reverifyCart();queueTray(RFIDScanner.getPresentEpcs())};
$('#btn-cancel-scan').onclick=async()=>{if(state.processing)return;holdCurrentTags();if(!await finalize('cancelled','Customer cancelled'))return;stopTimer();await stopCameraScanner();resetKiosk(true)};
async function completePayment(receipt){
  stopTimer();await stopCameraScanner();
  const cart=[...state.cart],items=Number(receipt.total_items),amount=Number(receipt.total_amount);
  $('#ok-sid').textContent=receipt.session_id;
  $('#ok-receipt').innerHTML=cart.map(i=>`<div class="row"><span>${i.qty} × ${esc(i.name)}</span><span>${peso(i.price*i.qty)}</span></div>`).join('')+
    `<div class="row tot" style="font-size:18px"><span>Total (${items} items)</span><span>${peso(amount)}</span></div>`;
  loggedSessions.add(receipt.session_id);
  sessionStorage.removeItem(CHECKOUT_STORAGE);checkoutSession=null;state.checkout=null;reviewedRevision=null;
  state.cart=[];state.current=null;clearCartMemory();clearTimeout(detectDebounce);detectDebounce=null;trayRevision++;screen('k-success');
}
async function cancelOrder(){if(state.processing)return;holdCurrentTags();if(state.current&&!loggedSessions.has(state.current)&&!await finalize('cancelled','Customer cancelled checkout'))return;resetKiosk(true)}
$('#btn-cancel').onclick=cancelOrder;$('#btn-cancel2').onclick=cancelOrder;$('#btn-new').onclick=()=>resetKiosk();
// Activated only after manager authorization in the Product Recognition page.
state.kioskOn=false;resetKiosk(false,false);
