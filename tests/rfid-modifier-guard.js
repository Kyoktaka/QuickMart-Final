// Exercise the real guard with native insertion order and physical key codes.
// These regressions prove modifier handling, not physical USB-device identity.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/password-guard.js','utf8');
const EPC='E28011700000021905AC0C04',SHIFTED_DIGITS=')!@#$%^&*(';
let checks=0;const failures=[];
function check(actual,expected,message){
  checks++;try{assert.deepEqual(actual,expected,message)}catch(error){failures.push(error.message)}
}
function setup(){
  let now=5000,nextTimer=0,caps=false,heldShift=false;
  const handlers=new Map(),timers=new Map(),events=[];
  const document={body:{tagName:'BODY'},activeElement:null,addEventListener(type,fn){
    if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);
  }};
  function advance(ms){
    const target=now+ms;
    for(let count=0;count<1000;count++){
      const due=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due)break;
      now=due[1].at;timers.delete(due[0]);due[1].fn();
      if(count===999)throw Error('Guard timer did not settle');
    }
    now=target;
  }
  function fire(type,target,properties={}){
    const event={type,target,cancelable:true,defaultPrevented:false,immediate:false,
      ctrlKey:false,metaKey:false,altKey:false,repeat:false,isComposing:false,
      shiftKey:heldShift,getModifierState:name=>name==='CapsLock'&&caps,
      preventDefault(){if(this.cancelable)this.defaultPrevented=true},
      stopPropagation(){},stopImmediatePropagation(){this.immediate=true},...properties};
    for(const handler of handlers.get(type)||[]){handler(event);if(event.immediate)break}
    return event;
  }
  const sandbox={document,Date:{now:()=>now},performance:{now:()=>now},
    Event:class{constructor(type,properties){Object.assign(this,{type},properties)}},
    CustomEvent:class{constructor(type,properties){Object.assign(this,{type},properties)}},
    dispatchEvent:event=>events.push(event),setInterval:()=>++nextTimer,clearInterval(){},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id},
    clearTimeout:id=>timers.delete(id)};
  sandbox.window=sandbox;
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  function field(type='text'){
    const element={tagName:type==='textarea'?'TEXTAREA':'INPUT',type,value:'left REPLACE right',
      selectionStart:5,selectionEnd:12,isConnected:true,
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);
        this.selectionStart=this.selectionEnd=start+text.length},
      dispatchEvent:event=>fire(event.type,element,event),focus(){document.activeElement=this}};
    document.activeElement=element;fire('focusin',element);return element;
  }
  function press(element,key,code,gap=8,properties={}){
    advance(gap);
    const details={key,code,...properties},event=fire('keydown',element,details);
    if(!event.defaultPrevented&&key.length===1&&['INPUT','TEXTAREA'].includes(element.tagName)&&
       !element.readOnly&&!details.ctrlKey&&!details.metaKey&&!details.altKey){
      const printable=fire('keypress',element,details);
      if(!printable.defaultPrevented){
        const insertion={data:key,inputType:'insertText',isComposing:false};
        const before=fire('beforeinput',element,insertion);
        if(!before.defaultPrevented){
          const start=element.selectionStart;
          element.value=element.value.slice(0,start)+key+element.value.slice(element.selectionEnd);
          element.selectionStart=element.selectionEnd=start+key.length;
          fire('input',element,insertion);
        }
      }
    }
    if(!properties.keepHeld)fire('keyup',element,details);
    return event;
  }
  function toggleCaps(element){
    advance(2);
    const event=fire('keydown',element,{key:'CapsLock',code:'CapsLock'});
    if(!event.defaultPrevented)caps=!caps;
    fire('keyup',element,{key:'CapsLock',code:'CapsLock'});
    return event;
  }
  function shift(element,pressed){
    advance(2);heldShift=pressed;
    fire(pressed?'keydown':'keyup',element,{key:'Shift',code:'ShiftLeft',shiftKey:pressed});
  }
  function readerKey(element,char,repeat=false,keepHeld=false){
    const letter=/[A-F]/.test(char),effectiveShift=heldShift||letter;
    // The reader requests uppercase letters using Shift. CapsLock inverts them;
    // a person's held Shift turns the reader's number-row digits into symbols.
    const key=letter?(effectiveShift!==caps?char:char.toLowerCase()):
      effectiveShift?SHIFTED_DIGITS[Number(char)]:char;
    if(letter&&!heldShift)fire('keydown',element,{key:'Shift',code:'ShiftLeft',shiftKey:true});
    const event=press(element,key,letter?'Key'+char:'Digit'+char,8,{shiftKey:effectiveShift,repeat,keepHeld});
    if(letter&&!heldShift)fire('keyup',element,{key:'Shift',code:'ShiftLeft',shiftKey:false});
    return {event,key};
  }
  function scan(element,{text=EPC,capsAt=[],shiftAt={},label='reader',repeatConsecutive=false,repeatEnter=false}={}){
    advance(700);const values=[],capsEvents=[];let emitted='';
    for(let index=0;index<=text.length;index++){
      if(capsAt.includes(index))capsEvents.push(toggleCaps(element));
      if(Object.hasOwn(shiftAt,index))shift(element,shiftAt[index]);
      if(index<text.length){
        const result=readerKey(element,text[index],repeatConsecutive&&text[index]===text[index-1],
          repeatConsecutive&&text[index]===text[index+1]);
        emitted+=result.key;values.push(element.value);
      }
    }
    const enter=press(element,'Enter','Enter',8,{keepHeld:repeatEnter});
    const repeatedEnter=repeatEnter?press(element,'Enter','Enter',8,{repeat:true}):null;
    advance(800);
    return {values,capsEvents,enter,repeatedEnter,emitted,label};
  }
  function loadScanner(){
    vm.runInContext(fs.readFileSync('assets/js/rfid-scanner.js','utf8'),sandbox);
    sandbox.RFIDScanner.enable();return sandbox.RFIDScanner;
  }
  function body(){document.activeElement=document.body;return document.body}
  return {sandbox,field,body,loadScanner,events,advance,press,toggleCaps,shift,scan,readerKey};
}

if(require.main!==module){
  module.exports={setup};
}else{
// CapsLock remains a real keyboard mode change, including while an EPC is held
// or dropped. Its non-printable event cannot flush/reset the reader candidate.
for(const capsAt of [[0],[1],[2],[12],[23],[EPC.length],[0,2,12,23]]){
  const h=setup(),element=h.field('password'),result=h.scan(element,{capsAt});
  const label='CapsLock at '+capsAt.join(',');
  check(result.capsEvents.every(event=>!event.defaultPrevented),true,label+': CapsLock default action remains available');
  check(result.values.every(value=>value==='left REPLACE right'),true,label+': no transient reader prefix');
  check(element.value,'left REPLACE right',label+': original text survives');
  check([element.selectionStart,element.selectionEnd],[5,12],label+': original selection survives');
  check(result.enter.defaultPrevented,true,label+': reader Enter cannot submit');
}
for(const text of [EPC,'30142B8A004C2000000463']){
  for(const scenario of [
    {shiftAt:{0:true}},
    {capsAt:[0],shiftAt:{0:true}},
    {shiftAt:{2:true}},
    {shiftAt:{12:true}},
    {shiftAt:{0:true,12:false}},
    {capsAt:[1,13],shiftAt:{2:true,18:false}}
  ]){
    const h=setup(),element=h.field('search'),result=h.scan(element,{text,...scenario});
    const label=text.slice(0,2)+' '+JSON.stringify(scenario);
    check(result.values.every(value=>value==='left REPLACE right'),true,label+': physical hex codes block shifted reader symbols immediately');
    check(element.value,'left REPLACE right',label+': no reader fragments remain');
    check([element.selectionStart,element.selectionEnd],[5,12],label+': selected text remains selected');
    check(result.enter.defaultPrevented,true,label+': closing Enter remains blocked');
    check(result.capsEvents.every(event=>!event.defaultPrevented),true,label+': CapsLock still toggles');
  }
}

// Throttled readers and Shift transitions push key gaps past 85 ms. The whole
// tag must still be rejected from a focused password field, with CapsLock on or off.
for(const useCaps of [false,true]){
  for(const gap of [90,120,200,230]){
    const h=setup(),element=h.field('password');
    if(useCaps)h.toggleCaps(element);
    h.advance(700);
    for(const char of EPC){h.advance(gap-8);h.readerKey(element,char)}
    const enter=h.press(element,'Enter','Enter',gap);
    h.advance(800);
    const label='Slow reader '+gap+'ms, CapsLock '+useCaps;
    check(element.value,'left REPLACE right',label+': no tag text remains in the field');
    check(enter.defaultPrevented,true,label+': closing Enter cannot submit');
  }
}
// A 12-character hexadecimal password typed at normal speed is not a reader frame.
{
  const h=setup(),element=h.field('password');
  element.value='';
  for(const char of 'ab12cd34ef56')h.press(element,char,/\d/.test(char)?'Digit'+char:'Key'+char.toUpperCase(),140);
  h.advance(100);
  check(element.value,'ab12cd34ef56','Short hexadecimal password typed by a person survives');
}

// Ordinary human uppercase letters, CapsLock, Shift and number-row symbols keep
// their event.key text rather than being rewritten to the physical code value.
for(const useCaps of [false,true]){
  const h=setup(),element=h.field();
  if(useCaps)h.toggleCaps(element);
  const text='E2B CAFe!@#$%^&*() SHIFT James2026';
  for(const key of text){
    const symbol=SHIFTED_DIGITS.indexOf(key);
    const code=/[A-Za-z]/.test(key)?'Key'+key.toUpperCase():/\d/.test(key)?'Digit'+key:
      symbol>=0?'Digit'+symbol:key===' '?'Space':'';
    h.press(element,key,code,140,{shiftKey:/[A-Za-z]/.test(key)?/[A-Z]/.test(key)!==useCaps:symbol>=0});
  }
  h.advance(100);
  check(element.value,'left '+text+' right','Human capitals/symbols retain original key text (CapsLock '+useCaps+')');
  check(h.press(element,'Enter','Enter',140).defaultPrevented,false,'Human Enter remains available');
}

// Verified raw mode bypasses heuristics even for a fast modifier-distorted EPC.
{
  const h=setup(),element=h.field('password');
  h.sandbox.RFIDScanner={getBridgeHealth:()=>({connected:true})};
  const result=h.scan(element,{capsAt:[0],shiftAt:{0:true}});
  check(element.value,'left '+result.emitted+' right','Raw bridge keeps physical keyboard event.key text');
  check(result.enter.defaultPrevented,false,'Raw bridge does not intercept physical Enter');
  check(result.capsEvents.every(event=>!event.defaultPrevented),true,'Raw bridge preserves CapsLock');
}

// The authorized capture surface consumes the same physical EPC rather than a
// CapsLock/Shift-distorted tag. Editable fields must never register inventory.
for(const surface of ['body','readonly','editable']){
  for(const scenario of [{shiftAt:{0:true}},{capsAt:[0,13],shiftAt:{2:true}}]){
    const h=setup(),scanner=h.loadScanner(),element=surface==='body'?h.body():h.field('text');
    if(surface==='readonly'){element.id='epc-code';element.readOnly=true}
    const result=h.scan(element,scenario),label=surface+' '+JSON.stringify(scenario);
    check([...scanner.getPresentEpcs()],surface==='editable'?[]:[EPC],label+': only capture surfaces register canonical EPC');
    check(result.enter.defaultPrevented,true,label+': captured reader Enter cannot activate a form/button');
    if(surface==='editable'){
      check(element.value,'left REPLACE right',label+': editable text remains protected with scanner enabled');
      check(result.values.every(value=>value==='left REPLACE right'),true,label+': enabled capture does not leak into focused field');
    }
  }
}
// A person editing halfway through a reader frame must not release its tail.
for(const key of ['Backspace','Delete','g',' ']){
  for(const at of [4,14]){
    for(const caps of [false,true]){
      const h=setup(),el=h.field('password');
      if(caps)h.toggleCaps(el);
      for(let i=0;i<EPC.length;i++){
        if(i===at)h.press(el,key,key.length===1?'KeyG':key,1);
        h.readerKey(el,EPC[i]);
      }
      const enter=h.press(el,'Enter','Enter',8);h.advance(800);
      check(el.value,key==='Backspace'||key==='Delete'?'left  right':'left '+key+' right',
        `Interleaved ${key} at ${at}, caps ${caps}: preserve edit without tag fragments`);
      check(enter.defaultPrevented,true,'Interrupted reader Enter remains blocked');
    }
  }
}
if(failures.length){
  console.error(failures.join('\n\n'));
  console.error(`${failures.length}/${checks} modifier regression checks failed`);process.exitCode=1;
}else console.log(`${checks} modifier regression checks passed (synthetic physical codes; USB identity unverified)`);
}
