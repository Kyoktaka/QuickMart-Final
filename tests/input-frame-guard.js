// Regression coverage for reader text entering ordinary fields. These are
// browser-event simulations, not physical-device source authentication.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/password-guard.js','utf8');
const EPC='E28011700000021905AC0C04';
let checks=0;
function check(actual,expected,message){assert.deepEqual(actual,expected,message);checks++}
function setup(){
  let now=5000,nextTimer=0;
  const handlers=new Map(),timers=new Map();
  const document={body:{tagName:'BODY'},activeElement:null,addEventListener(type,fn){
    if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);
  }};
  function advance(ms){
    now+=ms;
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn()}
  }
  function fire(type,target,properties={}){
    const event={type,target,defaultPrevented:false,immediate:false,
      preventDefault(){if(this.cancelable!==false)this.defaultPrevented=true},
      stopPropagation(){},stopImmediatePropagation(){this.immediate=true},...properties};
    for(const handler of handlers.get(type)||[]){handler(event);if(event.immediate)break}
    return event;
  }
  const sandbox={document,Date:{now:()=>now},Event:class{constructor(type){this.type=type}},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id},
    clearTimeout:id=>timers.delete(id)};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  function field(type='text',value='manual '){
    const element={tagName:type==='textarea'?'TEXTAREA':'INPUT',type,value,
      selectionStart:value.length,selectionEnd:value.length,isConnected:true,
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},
      dispatchEvent(event){fire(event.type,this,event)},focus(){document.activeElement=this}};
    document.activeElement=element;fire('focusin',element);return element;
  }
  function insert(element,text,{inputType='insertText',cancelable=true,isComposing=false,before=true}={}){
    const properties={data:text,inputType,cancelable,isComposing};
    const event=before?fire('beforeinput',element,properties):{defaultPrevented:false};
    if(!event.defaultPrevented){
      const at=element.selectionStart;
      element.value=element.value.slice(0,at)+text+element.value.slice(element.selectionEnd);
      element.selectionStart=element.selectionEnd=at+text.length;
      fire('input',element,properties);
    }
    return event;
  }
  function press(element,key,gap=8,properties={}){
    advance(gap);
    const event=fire('keydown',element,{key,...properties});
    if(!event.defaultPrevented&&key.length===1&&!properties.ctrlKey&&!properties.metaKey&&!properties.altKey)
      insert(element,key,{isComposing:Boolean(properties.isComposing)});
    fire('keypress',element,{key,...properties});fire('keyup',element,{key,...properties});
    return event;
  }
  function scan(element,{text=EPC,gap=75,pauses={}}={}){
    advance(600);
    const values=[];
    for(const [index,key] of [...text].entries()){press(element,key,pauses[index]??gap);values.push(element.value)}
    return Object.assign(press(element,'Enter',gap),{values});
  }
  return {sandbox,document,field,advance,fire,insert,press,scan};
}

// Every manager page installs the same capture guard before interactive forms
// are parsed, avoiding late loading and duplicate per-page policies.
for(const name of ['login','scan','kiosk','inventory','dashboard','history']){
  const html=fs.readFileSync(`manager/${name}.html`,'utf8');
  check((html.match(/password-guard\.js/g)||[]).length,1,`${name}: exactly one guard`);
  check(html.indexOf('password-guard.js')<html.indexOf('</head>'),true,`${name}: guard loads before forms`);
}

for(const type of ['text','password','search','email','tel','url','number','textarea']){
  const h=setup(),element=h.field(type);
  const scan=h.scan(element);
  check(scan.defaultPrevented,true,`${type}: delayed reader Enter cannot submit`);
  check(scan.values.every(value=>value==='manual '),true,`${type}: known reader prefix never appears, even briefly`);
  check(element.value,'manual ',`${type}: 75 ms reader output is removed`);
  // Frame terminator releases typing immediately, including hexadecimal keys.
  for(const key of 'abc123')h.press(element,key,140);
  h.advance(100); // A standalone 3 is briefly held by the existing EPC prefix buffer.
  check(element.value,'manual abc123',`${type}: keyboard input resumes after reader Enter`);
}

// A short prefix and USB scheduling pauses previously left scanner fragments
// behind when the rollback baseline was reset or a detected frame ended early.
for(const pauses of [{1:120},{3:170},{12:180,21:260},{4:120,15:300}]){
  const h=setup(),element=h.field();
  h.scan(element,{gap:8,pauses});
  check(element.value,'manual ','Jitter cannot leave the prefix or final 2-3 EPC characters');
}
{
  const h=setup(),element=h.field();
  h.advance(600);
  for(const key of EPC){
    const shifted=/[A-F]/.test(key);
    if(shifted){h.advance(3);h.fire('keydown',element,{key:'Shift'})}
    h.press(element,key,5,{shiftKey:shifted});
    if(shifted)h.fire('keyup',element,{key:'Shift'});
  }
  check(h.press(element,'Enter',5).defaultPrevented,true,'Reader Enter remains blocked after uppercase Shift transitions');
  check(element.value,'manual ','Reader Shift keys cannot release its prefix or final hexadecimal letters');
}
for(const text of ['A1B2C3D4E5F6','A3CDEF123456','12E456789ABC']){
  const h=setup(),element=h.field();
  h.scan(element,{text,gap:8});
  check(element.value,'manual ','A prefix candidate inside a frame cannot hide it from the fallback');
}
for(const text of ['312345','E2a5cf','ABCDEF12']){
  const h=setup(),element=h.field();
  for(const key of text)h.press(element,key,7);
  check(h.press(element,'Enter',7).defaultPrevented,false,'Short manual hexadecimal/PIN input must still submit');
  check(element.value,'manual '+text,'Short physical-keyboard input cannot be classified as a long reader frame');
}

// Rollback restores replacement selections rather than dropping the manager's
// existing suffix or moving the caret to the end of the form field.
{
  const h=setup(),element=h.field('password','keep REPLACE suffix');
  element.setSelectionRange(5,12);
  h.scan(element);
  check(element.value,'keep REPLACE suffix','Selected text is restored');
  check([element.selectionStart,element.selectionEnd],[5,12],'Original selection is restored');
}

// Some input surfaces deliver a whole text frame in beforeinput/input rather
// than individual keydowns. Explicit human paste and IME edits stay available.
for(const options of [{},{cancelable:false},{before:false}]){
  const h=setup(),element=h.field('text','keep REPLACE suffix');
  element.setSelectionRange(5,12);
  // A focus/selection snapshot also covers an input-only event without beforeinput.
  h.fire('focusin',element);
  h.insert(element,EPC,options);
  check(element.value,'keep REPLACE suffix','Bulk reader insertion restores the pre-edit value');
  check([element.selectionStart,element.selectionEnd],[5,12],'Bulk rollback preserves selection');
  check(h.press(element,'Enter').defaultPrevented,true,'Bulk frame Enter cannot submit');
}
{
  const h=setup(),element=h.field();
  h.press(element,'E'); // Held prefix followed by the remainder as one text insertion.
  h.insert(element,EPC.slice(1));
  h.advance(500);
  check(element.value,'manual ','A pending prefix cannot reappear after bulk frame rejection');
}
{
  const h=setup(),element=h.field();
  h.insert(element,EPC,{inputType:'insertFromPaste'});
  check(element.value,'manual '+EPC,'Deliberate paste remains available');
  h.insert(element,'ABCDEF',{inputType:'insertCompositionText',isComposing:true});
  check(element.value,'manual '+EPC+'ABCDEF','Composition input is preserved');
  for(const key of 'ABCDEF')h.press(element,key,7,{isComposing:true});
  check(element.value,'manual '+EPC+'ABCDEFABCDEF','Composition key events are preserved too');
  check(h.press(element,'v',8,{ctrlKey:true}).defaultPrevented,false,'Ctrl+V stays available');
  check(h.press(element,'a',8,{metaKey:true}).defaultPrevented,false,'Keyboard shortcuts stay available');
}
{
  const h=setup(),element=h.field();
  for(const key of 'James2026')h.press(element,key,7);
  check(element.value,'manual James2026','Fast ordinary name input remains immediate');
  h.advance(600);
  for(const key of EPC.slice(0,12))h.press(element,key,100);
  check(element.value,'manual James2026'+EPC.slice(0,12),'A person can type 12 hexadecimal characters at normal speed');
  h.advance(600);
  check(h.press(element,'Enter',140).defaultPrevented,false,'Deliberate keyboard Enter is preserved');
  h.advance(600);
  for(const key of EPC)h.press(element,key,100);
  check(element.value,'manual James2026'+EPC.slice(0,12),'A 24-character hexadecimal run at reader pace is rejected as a frame');
}

// A verified independent bridge disables heuristics for physical typing. This
// check does not imply compatibility of the supplied physical reader/SDK.
{
  const h=setup(),element=h.field('password','');
  h.sandbox.RFIDScanner={getBridgeHealth:()=>({connected:true})};
  for(const key of EPC)h.press(element,key,7);
  check(element.value,EPC,'Verified raw mode accepts fast physical hexadecimal typing');
  h.insert(element,EPC);
  check(element.value,EPC+EPC,'Verified raw mode does not reject physical bulk input');
}
{
  const h=setup();
  // Loading the script twice must not attach another independently timed guard.
  const first=h.sandbox.QuickMartInputGuard;
  vm.runInContext(source,h.sandbox);
  check(h.sandbox.QuickMartInputGuard===first,true,'Guard installation is idempotent');
}
console.log(`${checks} input-frame regressions passed (synthetic reader events; physical source remains unverified)`);
