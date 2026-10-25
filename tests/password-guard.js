// Scanner guard (js/password-guard.js): the RFID reader is ignored everywhere except restock capture
// and the kiosk. Ordinary typing, paste, Space and human Enter remain available.
// Timing alone cannot distinguish long fast hexadecimal typing or a slow reader;
// the verified optional raw bridge is the independent-device isolation path.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/password-guard.js','utf8');
for(const page of ['login','scan','kiosk','inventory','dashboard','history'])
  assert(fs.readFileSync('manager/'+page+'.html','utf8').includes('js/password-guard.js'),page+'.html must load password-guard.js');
assert(!/toast/.test(source),'The guard is silent: no "scanner input is blocked" message');

let clock=5000;const handlers={};let endBurst=null;
const sandbox={
  document:{addEventListener:(t,fn,capture)=>{(handlers[t]=handlers[t]||[]).push(fn);assert.equal(capture,true,'must run in the capture phase')}},
  Date:{now:()=>clock},setTimeout:fn=>{endBurst=()=>{clock+=500;fn()};return 1},clearTimeout:()=>{},
  Event:class{constructor(type){this.type=type}},
  RFIDScanner:undefined   // pages without the reader script (dashboard, history, login, scan)
};
vm.runInNewContext(source,sandbox);
const field=(type='password',value='')=>({tagName:'INPUT',type,value,events:[],dispatchEvent(e){this.events.push(e.type)}});
const button=()=>({tagName:'BUTTON',type:'button'});
const select=()=>({tagName:'SELECT',value:'a'});

// One physical key press; returns true when the guard swallowed it.
function press(el,key,gapMs,mods={}){
  clock+=gapMs;
  const ev={key,target:el,ctrlKey:false,metaKey:false,altKey:false,repeat:false,...mods,
    defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true},
    stopPropagation(){this.stopped=true},stopImmediatePropagation(){this.stopped=true}};
  for(const fn of handlers.keydown)fn(ev);
  if(!ev.defaultPrevented&&key.length===1&&'value' in el)el.value+=key;   // what the browser would insert
  return ev.defaultPrevented;
}
const human=(el,text,gap=140)=>[...text].map(c=>press(el,c,gap));
// A tag read starts after a pause, then characters arrive ~8 ms apart and Enter closes it.
const reader=(el,text,gap=8)=>{const out=[...text].map((c,i)=>press(el,c,i?gap:300));out.push(press(el,'Enter',gap));return out};
const EPC='E2827802000000000DFFD26D';
const SAMPLE_EPC='30142B8A004C2000000463';

// 1) A person typing a password at normal speed is never touched, Enter included.
const pw=field();
assert(human(pw,'Correct#Pass1').every(x=>x===false));
assert.equal(pw.value,'Correct#Pass1');
assert.equal(press(pw,'Enter',200),false,"A person's Enter must still submit");

// 2) A tag read while a field is focused is discarded, rolled back, and its Enter is swallowed. No message.
pw.value='';human(pw,'Secret');
const swallowed=reader(pw,EPC);
assert.equal(swallowed[0],true,'The FIRST character of an EPC must never appear in a field');
assert.equal(swallowed[1],true,'The SECOND character of an EPC must never appear in a field');
assert.equal(pw.value,'Secret',"Only the manager's own typing remains; the EPC is rolled back");
assert.equal(swallowed.at(-1),true,"The reader's closing Enter must NOT submit the form");
assert.equal(swallowed.slice(11).every(Boolean),true,'Everything after a complete fast hex prefix is detected is blocked');
assert.deepEqual(pw.events,[],'The reader EPC is discarded before it alters the input or fires a misleading input event');


const originalEpcCount=pw.value;
const otherPrefix=reader(pw,SAMPLE_EPC);
assert.equal(otherPrefix[0],true,'First 3 of 30-prefixed EPC is buffered before input insertion');
assert.equal(pw.value,originalEpcCount,'A 30-prefixed sample EPC also cannot leak into a textbox');

// 3) After the burst ends, typing works again; the next scan is blocked again.
assert.equal(typeof endBurst,'function');endBurst();
assert(human(pw,'12').every(x=>x===false));
assert.equal(press(pw,'3',140),true,'A possible start of a 30-prefixed EPC is briefly buffered');
endBurst();
assert.equal(pw.value,'Secret123','Ordinary standalone 3 is replayed without data loss');
reader(pw,EPC);assert.equal(pw.value,'Secret123');
endBurst();

// 4) Search box (inventory/history): a tag never lands in it.
const search=field('search','egg');
reader(search,EPC);assert.equal(search.value,'egg');endBurst();
const empty=field('search');reader(empty,EPC);assert.equal(empty.value,'');endBurst();

// 5) A button has focus (Logout, Cancel, Yes Log out...): a recognized fast EPC
// burst must not click it. Slow output is explicitly outside this timing fallback.
const logout=button();
const onButton=reader(logout,EPC);
assert.equal(onButton.slice(11).every(Boolean),true,'A recognized EPC burst and its closing Enter are swallowed on a button');
endBurst();
const slow=reader(logout,EPC,120);   // even a slow reader
assert.equal(slow.some(Boolean),false,'Slow reader output cannot be distinguished from physical typing by timing alone');
endBurst();
// ...but a person using the keyboard on a button still can.
assert.equal(press(logout,'Enter',2000),false,'A person pressing Enter on a focused button still works');
assert.equal(press(logout,' ',300),false,'Space still works');
assert.equal(press(logout,'Tab',300),false);
assert.equal(press(logout,'Escape',300),false);

// 6) Nothing focused / a dropdown focused: recognized fast hex reader noise is
// dropped, while ordinary human type-ahead remains available on the select.
const body={tagName:'BODY'};
assert.equal(reader(body,EPC).slice(11).every(Boolean),true);endBurst();
const dd=select();
assert.equal(reader(dd,EPC).slice(11).every(Boolean),true);endBurst();
assert.equal(press(dd,'a',300),false,'Ordinary select type-ahead remains usable');

// 7) Modifier shortcuts (Ctrl+V, Ctrl+A...) and held keys are never touched.
assert.equal(press(pw,'v',300,{ctrlKey:true}),false);
assert.equal(press(pw,'a',10,{metaKey:true}),false);

// 8) The guard stands aside while the reader is allowed to scan (restock capture / kiosk).
sandbox.RFIDScanner={isEnabled:()=>true,isBlocked:()=>false};
assert.equal(reader(body,EPC).some(Boolean),false,'Enabled reader: rfid-scanner.js owns the keys');
// A popup that blocks the reader (kiosk Input Tag / Check cart) hands control back to the guard.
sandbox.RFIDScanner={isEnabled:()=>true,isBlocked:()=>true};
assert.equal(reader(logout,EPC).slice(11).every(Boolean),true);endBurst();
// Reader off (everywhere else): guarded.
sandbox.RFIDScanner={isEnabled:()=>false,isBlocked:()=>false};
assert.equal(reader(logout,EPC).slice(11).every(Boolean),true);endBurst();

// 9) Reader keeps reading (tag on antenna): a person typing at normal speed is NEVER eaten, caret stays put.
{
  const f=field('text','');f.selectionStart=f.selectionEnd=0;f.setSelectionRange=(a,b)=>{f.selectionStart=a;f.selectionEnd=b};
  human(f,'ab');
  reader(f,EPC);                                   // burst running, not ended
  assert.equal(f.value,'ab','EPC rolled back');
  assert.equal(f.selectionStart,0,'caret restored where it was, not thrown to the end');
  const typed=human(f,'cd');                       // person types again right away, no click needed
  assert(typed.every(x=>x===false),'person typing during/after a burst is not swallowed');
  assert.equal(f.value,'abcd');
  endBurst&&endBurst();
}

// 11) Enabled scanning must not disable protection for focused editable fields.
{
  sandbox.RFIDScanner={isEnabled:()=>true,isBlocked:()=>false};
  const f=field('search','milk');reader(f,EPC);
  assert.equal(f.value,'milk','Focused search is protected even while scanning is enabled');endBurst();
  assert(human(f,'James2026',7).every(x=>x===false),'Fast ordinary typing must not be mistaken for four scanner keys');
  assert.equal(f.value,'milkJames2026');
}

// 12) A verified connected raw bridge is the device isolation path. Its physical
// keyboard remains usable even for long hexadecimal values typed very quickly.
{
  sandbox.RFIDScanner={isEnabled:()=>true,isBlocked:()=>false,getBridgeHealth:()=>({connected:true})};
  const f=field('password','');
  assert(human(f,'ABCDEF1234567890',7).every(x=>x===false));
  assert.equal(f.value,'ABCDEF1234567890');
}
// 10) Focus is never stolen back from where the person clicked after a burst ends.
{
  let focused=0;const f=field('text','x');f.isConnected=true;f.focus=()=>{focused++};
  sandbox.document.activeElement={tagName:'INPUT'};   // person clicked another box
  human(f,'y');reader(f,EPC);endBurst&&endBurst();
  assert.equal(focused,0,'no focus steal');
  sandbox.document.activeElement=undefined;
}

// 13) Changing fields, using Tab/Backspace, or invoking a shortcut must end a
// previous scanner burst before another person's input reaches the new target.
{
  sandbox.RFIDScanner=undefined;
  const previous=field('text','first'),next=field('text','second');
  reader(previous,EPC);
  assert.equal(press(next,'a',10),false,'A click into another field must end the old burst');
  assert.equal(next.value,'seconda');
  reader(next,EPC);assert.equal(press(next,'Tab',10),false);
  assert.equal(press(next,'b',10),false,'Tab cannot leave an old burst swallowing keys');
  reader(next,EPC);assert.equal(press(next,'v',10,{ctrlKey:true}),false);
  assert.equal(press(next,'c',10),false,'Paste shortcut ends the old burst');
  endBurst();
}

console.log('Scanner fallback rejects recognized fast hex EPC bursts; ordinary typing, focused forms and paired raw mode verified');
