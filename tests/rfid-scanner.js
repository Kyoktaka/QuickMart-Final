// Node-only scanner regression tests; no reader hardware needed.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const code=fs.readFileSync('assets/js/rfid-scanner.js','utf8');
let now=0,intervalFn=null,flushTimer=null,keyHandler=null;
const events=[];
const win={dispatchEvent:event=>events.push(event)};
const doc={activeElement:{tagName:'BODY'},addEventListener:(event,fn)=>{
  if(event==='keydown')keyHandler=fn;
}};
class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}}
const ctx={window:win,document:doc,CustomEvent,
  performance:{now:()=>now},
  setInterval:fn=>{intervalFn=fn;return 1},
  setTimeout:fn=>{flushTimer=fn;return 2},
  clearTimeout:()=>{flushTimer=null}};
vm.runInNewContext(code,ctx);
const reader=win.RFIDScanner;
const key=(value)=>{
  keyHandler({key:value,ctrlKey:false,metaKey:false,altKey:false,
    preventDefault(){},stopPropagation(){}});
};
function scan(value){
  for(const char of value){key(char);now+=10}
  key('Enter');
}
reader.enable();
const a='E28011700000021905AC150B',b='E28011700000021905AC150C';
scan(a);
assert.deepEqual([...reader.getPresentEpcs()],[a]);
assert.equal(events.filter(e=>e.type==='rfid:epc').length,1);
scan(a);
assert.equal(events.filter(e=>e.type==='rfid:epc').length,1,
  'Repeated reads must not register a second inventory EPC event');
scan(b);
assert.deepEqual([...reader.getPresentEpcs()],[a,b]);
assert.equal(events.filter(e=>e.type==='rfid:epc').length,2);
// Both EPCs continue to be emitted while the items sit on the tray.
// No item may disappear if every EPC keeps receiving repeated reads.
for(let i=0;i<6;i++){
  now+=600;
  scan(a);
  now+=200;
  scan(b);
  intervalFn();
  assert.deepEqual([...reader.getPresentEpcs()],[a,b],
    'Continuous repeated reads must keep BOTH physical tags on screen');
}
assert.equal(events.filter(e=>e.type==='rfid:epc').length,2,
  'Continuously reread tags should not generate new registration events');

// After the tags are physically removed, no further EPC reads arrive.
// Expiry is inferred rapidly; we deliberately do NOT wait 12 seconds.
now+=10000;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[],
  'Both tags must disappear promptly after the stream stops');
reader.disable();
assert.equal(reader.isEnabled(),false);
assert.equal(events.at(-1).type,'rfid:tray');
assert.equal(events.filter(e=>e.type==='rfid:epcs').length,0,
  'Tray snapshots must never bulk-register EPCs in Restock mode');

// One-shot USB HID output is not proof of physical presence. It will eventually time out.
reader.enable();
scan(a);
now+=4000;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[a],
  'Allow short read gaps without instant flicker');
now+=2300;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[],
  'A one-off read should expire after the short first-miss tolerance');

// The same EPC can reappear as a *new* presence only after it expired.
scan(a);
assert.deepEqual([...reader.getPresentEpcs()],[a]);
const diagnostics=reader.getDiagnostics();
assert.equal(diagnostics.length,1);
assert.equal(diagnostics[0].expiryToleranceMs,6000);
console.log('Continuous reader EPC presence/removal and restock tests passed');
