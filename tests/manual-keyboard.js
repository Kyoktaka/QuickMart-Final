// Regression: real physical keyboard input is never buffered by a global
// RFID keyboard-wedge guard. Scan capture is limited to designated RFID pages.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
for(const page of ['login','dashboard','inventory','history','scan','kiosk']){
 const html=fs.readFileSync('manager/'+page+'.html','utf8');
 assert(!html.includes('src="../js/rfid-input-guard.js"'),
   page+' must not install keyboard timing interception');
}
const source=fs.readFileSync('assets/js/rfid-scanner.js','utf8');
let handler,clock=0,tick;
const events=[];
const active={id:'auth-pw',tagName:'INPUT',type:'password',readOnly:false};
const doc={activeElement:active,addEventListener(type,fn){if(type==='keydown')handler=fn}};
const win={dispatchEvent:event=>events.push(event)};
class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail}}
vm.runInNewContext(source,{
 document:doc,window:win,CustomEvent,performance:{now:()=>clock},
 setTimeout(){return 1},clearTimeout(){},setInterval(fn){tick=fn}
});
win.RFIDScanner.enable();
function key(value){
 const ev={key:value,ctrlKey:false,altKey:false,metaKey:false,defaultPrevented:false,
   preventDefault(){this.defaultPrevented=true},stopPropagation(){}};
 handler(ev);clock+=7;return ev;
}
// Whether the scanner is enabled or not, a focused credential or search
// field must receive ordinary keystrokes with zero JavaScript delay.
for(const target of [
 {id:'auth-pw',tagName:'INPUT',type:'password'},
 {id:'inv-search',tagName:'INPUT',type:'search'},
 {id:'login-user',tagName:'INPUT',type:'email'},
 {id:'p-name',tagName:'INPUT',type:'text'},
 {id:'tag-modal-input',tagName:'INPUT',type:'text'}
]){
 Object.assign(active,target);
 for(const c of 'James2026'){
  const ev=key(c);assert.equal(ev.defaultPrevented,false,
    target.id+' must receive physical keyboard chars immediately');
 }
 assert.equal(key('Enter').defaultPrevented,false);
}
assert.equal(win.RFIDScanner.getPresentEpcs().length,0,
 'Editing fields must not register physical-keyboard typing as EPC');
// The EPC list is always read-only; other input fields still accept the real
// physical keyboard without delay. Scanner capture remains possible while the
// readonly EPC field has focus (the browser cannot distinguish USB keyboards).
assert(/<textarea\b[^>]*id="epc-code"[^>]*\breadonly\b/.test(
 fs.readFileSync('manager/inventory.html','utf8')),
 'EPC display must never be an editable textarea');
Object.assign(active,{id:'epc-code',tagName:'TEXTAREA',readOnly:true});
for(const c of 'E2827802000000000DFFD2EE')key(c);
key('Enter');tick();
assert.deepEqual([...win.RFIDScanner.getPresentEpcs()],['E2827802000000000DFFD2EE']);
console.log('Physical keyboard passes through all forms; focused readonly RFID list still captures tags');
