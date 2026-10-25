// While a kiosk popup is open the reader is BLOCKED: its output is swallowed and
// never registered; after unblocking, normal scanning resumes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('assets/js/rfid-scanner.js','utf8');
let now=0,handler=null,flush=null;
const events=[],win={dispatchEvent:e=>events.push(e)};
class CustomEvent{constructor(type,o){this.type=type;this.detail=o.detail}}
vm.runInNewContext(code,{window:win,CustomEvent,document:{activeElement:{tagName:'BODY'},
  addEventListener:(t,fn)=>{if(t==='keydown')handler=fn}},performance:{now:()=>now},
  setInterval(){return 1},setTimeout:fn=>{flush=fn;return 2},clearTimeout:()=>{flush=null}});
const reader=win.RFIDScanner;reader.enable();
function scan(epc){
  const prevented=[];
  for(const c of epc){const ev={key:c,preventDefault(){prevented.push(c)},stopPropagation(){}};handler(ev);now+=8}
  const enter={key:'Enter',preventDefault(){prevented.push('Enter')},stopPropagation(){}};handler(enter);
  return prevented;
}
const a='E28011700000021905AC150B',b='E28011700000021905AC150C';
reader.setBlocked(true);
assert.equal(reader.isBlocked(),true);
const swallowed=scan(a);
assert.deepEqual([...reader.getPresentEpcs()],[],'A blocked reader must not register tags');
assert.equal(events.some(e=>e.type==='rfid:epc'||e.type==='rfid:read'),false);
assert.equal(swallowed.at(-1),'Enter',"Reader's closing Enter must not reach a focused button");
reader.setBlocked(false);
scan(b);
assert.deepEqual([...reader.getPresentEpcs()],[b],'Scanning resumes after unblocking');
// a half-received burst is dropped when the reader is blocked
for(const c of a.slice(0,10)){handler({key:c,preventDefault(){},stopPropagation(){}});now+=8}
reader.setBlocked(true);reader.setBlocked(false);
for(const c of a.slice(10)){handler({key:c,preventDefault(){},stopPropagation(){}});now+=8}
handler({key:'Enter',preventDefault(){},stopPropagation(){}});
assert.equal(reader.getPresentEpcs().includes(a),false,'Partial burst must not be stitched across a block');
console.log('RFID reader block/unblock regression passed');
