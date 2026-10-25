// Exercise the actual capture order: password guard, then RFID scanner, then
// browser input insertion. Device-origin ambiguity is covered by the raw bridge
// tests; this regression specifically prevents enabled-scanner form leakage.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const handlers=new Map(),timers=new Map(),events=[];
let clock=5000,nextTimer=0;
const doc={activeElement:null,addEventListener(type,fn){
  if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);
}};
const sandbox={document:doc,Date:{now:()=>clock},performance:{now:()=>clock},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
  Event:class{constructor(type){this.type=type}},
  dispatchEvent:e=>events.push(e),setInterval:()=>++nextTimer,
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:clock+ms});return id},
  clearTimeout:id=>timers.delete(id)
};
sandbox.window=sandbox;vm.createContext(sandbox);
for(const path of ['js/password-guard.js','assets/js/rfid-scanner.js'])
  vm.runInContext(fs.readFileSync(path,'utf8'),sandbox);
const scanner=sandbox.RFIDScanner;
function advance(ms){
  clock+=ms;
  for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn()}
}
function input(value=''){
  return {tagName:'INPUT',id:'inv-search',type:'search',value,selectionStart:value.length,selectionEnd:value.length,
    setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b},dispatchEvent(){}};
}
function press(target,key,gap){
  advance(gap);doc.activeElement=target;
  const e={key,target,defaultPrevented:false,immediate:false,
    preventDefault(){this.defaultPrevented=true},stopPropagation(){},stopImmediatePropagation(){this.immediate=true}};
  for(const handler of handlers.get('keydown')||[]){handler(e);if(e.immediate)break}
  if(!e.immediate&&target.keydown)target.keydown(e);
  if(!e.defaultPrevented&&key.length===1&&target.tagName==='INPUT'){
    const at=target.selectionStart;
    target.value=target.value.slice(0,at)+key+target.value.slice(target.selectionEnd);
    target.selectionStart=target.selectionEnd=at+1;
  }
  return e;
}
function scan(target,epc){
  advance(600);for(const char of epc)press(target,char,7);return press(target,'Enter',7);
}
scanner.enable();
const search=input('milk ');
for(const char of 'James2026')assert.equal(press(search,char,7).defaultPrevented,false);
assert.equal(search.value,'milk James2026','Ordinary fast input passes immediately without buffering');
const before=search.value;
assert.equal(scan(search,'E28011700000021905AC150B').defaultPrevented,true,
  'Reader closing Enter cannot submit the focused form during active scanning');
assert.equal(search.value,before,'Enabled scanner must not leave an EPC inside a search field');
assert.equal(scanner.getPresentEpcs().length,0,'Editing a field cannot add RFID inventory');
scanner.setBlocked(true);
const password=input('secret');password.id='auth-pw';password.type='password';
scan(password,'E28011700000021905AC150B');
assert.equal(password.value,'secret');assert.equal(scanner.getPresentEpcs().length,0);
scanner.setBlocked(false);
scan({tagName:'BODY'},'E28011700000021905AC150B');
assert.deepEqual([...scanner.getPresentEpcs()],['E28011700000021905AC150B'],
  'Actual scan surface resumes after the popup without swallowing ordinary forms');
assert.equal(events.filter(e=>e.type==='rfid:epc').length,1);
console.log('Combined scanner/guard capture order, focused-field protection and normal typing regressions passed');

// Use the real scanner lease-stop pause path, both real guards, and the exact
// Input Tag listener. A connected-only mock would miss the popup's paused state.
(async()=>{
  sandbox.crypto=require('node:crypto').webcrypto;
  let connected=true,submissions=0;
  sandbox.fetch=async url=>({ok:true,status:200,json:async()=>url.endsWith('/scans')?{connected,epcs:[]}:{status:'ok'}});
  scanner.configureBridge({token:'a'.repeat(43)});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scanner.getBridgeHealth().connected,true);
  scanner.setBlocked(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(scanner.getBridgeHealth().connected,false);
  assert.equal(scanner.getBridgeHealth().paused,true);
  assert.equal(scanner.getBridgeHealth().lastVerifiedConnected,true);
  const manual=input();manual.id='tag-modal-input';
  manual.addEventListener=(type,fn)=>{if(type==='keydown')manual.keydown=fn};
  sandbox.$=()=>manual;sandbox.submitTagModal=()=>{submissions++};sandbox.armBurstEnd=()=>{};
  const localSource=fs.readFileSync('js/kiosk.js','utf8');
  const localDefinitions=[
    localSource.match(/const SCANNER_KEY_GAP_MS=[^\n]+/)[0],
    localSource.match(/const SCANNER_HEX_KEY=[^\n]+/)[0],
    localSource.match(/let tkLast=[^\n]+/)[0],
    localSource.match(/function resetTagTypingGuard\(\)\{[^\n]+/)[0],
    localSource.match(/\$\('#tag-modal-input'\)\.addEventListener\('keydown',e=>\{[\s\S]*?\n\}\);/)[0]
  ].join('\n');
  vm.runInContext(localDefinitions,sandbox);
  const epc='E28011700000021905AC150B';
  for(const char of epc)assert.equal(press(manual,char,7).defaultPrevented,false);
  assert.equal(manual.value,epc,'Paused raw USB must preserve fast hex input through both guards');
  assert.equal(press(manual,'Enter',7).defaultPrevented,true);assert.equal(submissions,1);

  // Observing a real connection failure invalidates the remembered verification.
  connected=false;scanner.setBlocked(false);await new Promise(resolve=>setImmediate(resolve));
  scanner.setBlocked(true);assert.equal(scanner.getBridgeHealth().lastVerifiedConnected,false);
  manual.value='';manual.selectionStart=manual.selectionEnd=0;
  scan(manual,epc);
  assert.equal(manual.value,'','A failed bridge observation restores the conservative fallback');
  assert.equal(submissions,1,'Reader Enter must not become a second manual submission');
  scanner.disconnectBridge();
  assert.equal(scanner.getBridgeHealth().lastVerifiedConnected,false);
  console.log('Actual bridge pause, last-verified health and both Input Tag keyboard guards passed');
})().catch(error=>{console.error(error);process.exitCode=1});
