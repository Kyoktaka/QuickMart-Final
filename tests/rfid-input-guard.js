// A USB-HID RFID reader keeps typing even when the app disables RFID logic.
// Verify tag bursts never enter manager password/login/search/product fields.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/rfid-input-guard.js','utf8');
let clock=0,nextTimer=0;
const timers=new Map(),listeners=new Map(),win={};
let active=null,submitted=0;
class Input {
  constructor(type='text'){
    this.tagName='INPUT';this.type=type;this.readOnly=false;
    this.disabled=false;this.isConnected=true;this.value='';
    this.selectionStart=0;this.selectionEnd=0;this.events=[];
  }
  setRangeText(text,start,end){
    this.value=this.value.slice(0,start)+text+this.value.slice(end);
    this.selectionStart=this.selectionEnd=start+text.length;
  }
  dispatchEvent(e){this.events.push(e.type)}
}
class Event {constructor(type,options={}){this.type=type;Object.assign(this,options)}}
const doc={
  get activeElement(){return active},
  addEventListener:(type,fn)=>{
    if(!listeners.has(type))listeners.set(type,[]);
    listeners.get(type).push(fn);
  }
};
const runDue=()=>{
  for(let i=0;i<50;i++){
    const due=[...timers].filter(([,v])=>v.at<=clock).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!due)break;
    timers.delete(due[0]);due[1].fn();
  }
};
const move=ms=>{clock+=ms;runDue()};
vm.runInNewContext(source,{
  document:doc,window:win,Event,performance:{now:()=>clock},
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{at:clock+ms,fn});return id},
  clearTimeout:id=>timers.delete(id)
});
const focus=input=>{for(const fn of listeners.get('focusout')||[])fn({});
  active=input;
  if(input){input.selectionStart=input.value.length;input.selectionEnd=input.value.length}
};
function key(k,delay=9){
  move(delay);
  const e={key:k,defaultPrevented:false,isComposing:false,ctrlKey:false,altKey:false,metaKey:false,
    preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true}};
  for(const handler of listeners.get('keydown')||[])handler(e);
  if(!e.defaultPrevented&&active){
    if(k.length===1){
      active.setRangeText(k,active.selectionStart,active.selectionEnd);
      active.dispatchEvent(new Event('input',{bubbles:true}));
    }else if(k==='Enter'){submitted++}
  }
  return e;
}
function epc(text,delay=7){
  for(const c of text)key(c,delay);
  return key('Enter',delay);
}
function testField(label,type){
 const field=new Input(type);focus(field);epc('E28011700000021905AC150B');
 assert.equal(field.value,'',label+' must not contain RFID EPC digits');
 assert.equal(submitted,0,'HID Enter suffix must not submit a form');
 // Plain human typing must remain functional, including input events.
 for(const c of 'Hello123')key(c,110);
 move(180);
 assert.equal(field.value,'Hello123',label+' human typing should work');
 assert(field.events.includes('input'),label+' must trigger input for search/filter updates');
 epc('E28011700000021905AC150C');
 assert.equal(field.value,'Hello123',label+' must not have RFID appended to typed text');
 focus(null);
}
testField('Manager password','password');
testField('Login email','email');
testField('Inventory search','search');
testField('Product name','text');
testField('Product price','number');
// 24-char reader output without a suffix must also be discarded.
const short=new Input('password');focus(short);for(const c of 'E28011700000021905AC150B')key(c,7);
move(180);assert.equal(short.value,'','Unsuffixed long EPC burst must not enter password');
focus(null);
// Normal slower human text with Enter still goes through.
const human=new Input('password');focus(human);
for(const c of 'MANAGERPASS99')key(c,90);
const enter=key('Enter',90);
assert.equal(enter.defaultPrevented,false,'Normal manager Enter should work');
assert.equal(human.value,'MANAGERPASS99');
assert.equal(submitted,1);
console.log('RFID wedge filtering: manager password/login/search/edit protected; human typing and Enter pass');
