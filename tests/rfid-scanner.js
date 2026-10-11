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
now+=3000;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[a,b],
  'Do not remove items immediately after transient read gap');
reader.disable();
assert.deepEqual([...reader.getPresentEpcs()],[]);
assert.equal(reader.isEnabled(),false);
assert.equal(events.at(-1).type,'rfid:tray');
assert.equal(events.filter(e=>e.type==='rfid:epcs').length,0,
  'Never forward tray snapshots to the registration handler');
reader.enable();scan(a);
now+=4000;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[a],
  'A single-read tag should be held during initial grace window');
now+=9000;intervalFn();
assert.deepEqual([...reader.getPresentEpcs()],[],
  'After the grace interval expires, removal is inferred');
console.log('RFID scanner presence/registration regression tests passed');
