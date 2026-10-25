// A keyboard-wedge frame can mark consecutive identical keys as repeats. Those
// flags must not flush a buffered EPC into the kiosk exit password. Synthetic
// event coverage cannot establish the physical reader's actual event stream.
const assert=require('node:assert/strict');
const {setup}=require('./rfid-modifier-guard');
let checks=0;const failures=[];
function check(actual,expected,message){
  checks++;try{assert.deepEqual(actual,expected,message)}catch(error){failures.push(error.message)}
}
const EPC='E28011700000021905AC0C04',SAMPLE_EPC='30142B8A004C2000000463';
function exitField(){
  const h=setup(),scanner=h.loadScanner();scanner.disable();
  const element=h.field('password');element.id='auth-pw';
  return {h,element,scanner};
}
for(const text of [EPC,SAMPLE_EPC]){
  for(const scenario of [
    {},{capsAt:[0]},{capsAt:[2,12]},
    {shiftAt:{0:true}},{shiftAt:{7:true,18:false}},
    {capsAt:[0,13],shiftAt:{2:true}}
  ]){
    const {h,element,scanner}=exitField();
    const result=h.scan(element,{text,...scenario,repeatConsecutive:true});
    const label=text.slice(0,2)+' repeated keys '+JSON.stringify(scenario);
    check(result.values.every(value=>value==='left REPLACE right'),true,label+': no transient text reaches auth-pw');
    check(element.value,'left REPLACE right',label+': existing password text survives');
    check([element.selectionStart,element.selectionEnd],[5,12],label+': password selection survives');
    check(result.enter.defaultPrevented,true,label+': closing Enter cannot verify a password');
    check(scanner.isEnabled(),false,label+': password dialog keeps capture disabled');
    check([...scanner.getPresentEpcs()],[],label+': rejected input cannot register a product');
    check(result.capsEvents.every(event=>!event.defaultPrevented),true,label+': CapsLock remains usable');
  }
}
// The duplicate Enter is an extra down event belonging to the same rejected
// frame. It must not become the kiosk's Verify password click.
for(const scenario of [{},{shiftAt:{0:true}},{capsAt:[0]}]){
  const {h,element}=exitField();
  const result=h.scan(element,{...scenario,repeatConsecutive:true,repeatEnter:true});
  check(result.enter.defaultPrevented,true,'Repeated Enter scenario: first frame terminator is blocked');
  check(result.repeatedEnter.defaultPrevented,true,'Repeated Enter scenario: repeated frame terminator is blocked');
}
// A real scan can start while the person is typing; no artificial 700 ms pause
// separates the last password character from the reader's next EPC.
for(const suffix of ['a','C']){
  for(const shifted of [false,true]){
    const {h,element}=exitField();
    h.press(element,suffix,'Key'+suffix.toUpperCase(),140);
    const expected='left '+suffix+' right',position=5+suffix.length,values=[];
    if(shifted)h.shift(element,true);
    for(let index=0;index<EPC.length;index++){
      h.readerKey(element,EPC[index],EPC[index]===EPC[index-1],EPC[index]===EPC[index+1]);
      values.push(element.value);
    }
    const enter=h.press(element,'Enter','Enter');h.advance(800);
    const label='Immediate scan after '+suffix+' (Shift '+shifted+')';
    check(values.every(value=>value===expected),true,label+': no scanner characters enter the password');
    check(element.value,expected,label+': final manual character survives');
    check([element.selectionStart,element.selectionEnd],[position,position],label+': caret survives');
    check(enter.defaultPrevented,true,label+': scanner Enter remains blocked');
  }
}
// A person's final E/e/3 may still be in the short prefix buffer when the
// reader starts. Resolving that overlap must preserve the manual character
// without replaying the reader's subsequent E2 prefix into the password.
for(const suffix of ['E','e','3','passE','pass3','e3']){
  for(const mode of ['normal','Shift','CapsLock','Shift+CapsLock']){
    const {h,element}=exitField();
    for(const char of suffix){
      h.press(element,char,/\d/.test(char)?'Digit'+char:'Key'+char.toUpperCase(),140);
    }
    const pendingValue=element.value,expected='left '+suffix+' right';
    const position=5+suffix.length,values=[];
    if(mode.includes('CapsLock'))h.toggleCaps(element);
    if(mode.includes('Shift'))h.shift(element,true);
    for(let index=0;index<EPC.length;index++){
      h.readerKey(element,EPC[index],EPC[index]===EPC[index-1],EPC[index]===EPC[index+1]);
      values.push(element.value);
    }
    const enter=h.press(element,'Enter','Enter');h.advance(800);
    const label='Immediate reader after pending '+suffix+' ('+mode+')';
    check(values.every(value=>value===pendingValue||value===expected),true,
      label+': resolving manual input never inserts scanner text');
    check(element.value,expected,label+': the complete manual password prefix survives');
    check([element.selectionStart,element.selectionEnd],[position,position],label+': manual caret survives');
    check(enter.defaultPrevented,true,label+': reader Enter cannot submit the password');
  }
}
// Losing the rejected Enter's keyup (for example, on browser focus loss) must
// not consume a later, separate Enter from the person using the dialog.
for(const mode of ['normal','Shift','CapsLock']){
  const {h,element}=exitField();
  if(mode==='Shift')h.shift(element,true);
  if(mode==='CapsLock')h.toggleCaps(element);
  for(let index=0;index<EPC.length;index++){
    h.readerKey(element,EPC[index],EPC[index]===EPC[index-1],EPC[index]===EPC[index+1]);
  }
  const readerEnter=h.press(element,'Enter','Enter',8,{keepHeld:true});
  check(readerEnter.defaultPrevented,true,'Lost keyup ('+mode+'): reader Enter is rejected');
  h.advance(2000);
  const humanEnter=h.press(element,'Enter','Enter',140,{repeat:false});
  check(humanEnter.defaultPrevented,false,'Lost keyup ('+mode+'): later non-repeat human Enter remains available');
}
// OS autorepeat from a person holding one key is ordinary input. It must not
// become a scanner frame merely because repeat events arrive every 30 ms.
for(const [key,code,properties] of [
  ['E','KeyE',{}],['3','Digit3',{}],['A','KeyA',{}],['1','Digit1',{}],
  ['!','Digit1',{shiftKey:true}],['x','KeyX',{}],[' ','Space',{}]
]){
  const {h,element}=exitField(),text=key.repeat(18);
  h.press(element,key,code,140,{...properties,keepHeld:true});
  for(let index=1;index<text.length;index++)h.press(element,key,code,30,
    {...properties,repeat:true,keepHeld:index<text.length-1});
  h.advance(100);
  check(element.value,'left '+text+' right','Held '+JSON.stringify(key)+': every human repeat remains');
  const password=' JAMES#Safe9';
  for(const char of password){
    const nextCode=/[A-Za-z]/.test(char)?'Key'+char.toUpperCase():/\d/.test(char)?'Digit'+char:
      char===' '?'Space':char==='#'?'Digit3':'';
    h.press(element,char,nextCode,140,{shiftKey:char==='#'||/[A-Z]/.test(char)});
  }
  h.advance(100);
  check(element.value,'left '+text+password+' right','Held '+JSON.stringify(key)+': later password text remains unchanged');
  check(h.press(element,'Enter','Enter',140).defaultPrevented,false,'Held '+JSON.stringify(key)+': human Enter remains usable');
}
{
  const {h,element}=exitField();
  h.press(element,'B','KeyB',140);
  h.press(element,'E','KeyE',8,{keepHeld:true});
  for(let index=1;index<18;index++)h.press(element,'E','KeyE',30,{repeat:true,keepHeld:index<17});
  h.advance(100);
  check(element.value,'left B'+'E'.repeat(18)+' right','Fast BE followed by held E is ordinary manual input');
  check(h.press(element,'Enter','Enter',140).defaultPrevented,false,'Human Enter remains available after BE and held E');
}
// A prefix alone is insufficient evidence: a person can type E2/30 and hold
// its final digit. Repeat flags must preserve that input, even with modifiers.
for(const [prefix,firstCode,lastCode,shifted] of [
  ['E2','KeyE','Digit2',false],['30','Digit3','Digit0',false],
  ['e@','KeyE','Digit2',true],['#)','Digit3','Digit0',true]
]){
  const {h,element}=exitField(),held=prefix[1];
  if(shifted){h.toggleCaps(element);h.shift(element,true)}
  h.press(element,prefix[0],firstCode,140,{shiftKey:shifted});
  h.press(element,held,lastCode,8,{shiftKey:shifted,keepHeld:true});
  for(let index=1;index<18;index++){
    if(index===8)h.toggleCaps(element);
    h.press(element,held,lastCode,30,{shiftKey:shifted,repeat:true,keepHeld:index<17});
    if(index===3||index===8||index===17){
      check(element.value,'left '+prefix[0]+held.repeat(index+1)+' right',
        'Human '+prefix+': held input is visible within 90 ms and while repeats continue ('+index+')');
    }
  }
  h.advance(100);
  check(element.value,'left '+prefix[0]+held.repeat(18)+' right','Human '+prefix+' then held final digit retains every character');
  check(h.press(element,'Enter','Enter',140).defaultPrevented,false,'Human '+prefix+' then held final digit may submit');
}
// Slow, deliberately typed hexadecimal input is still manual input even when
// an operating-system event marks a repeated character. The frame detector is
// not permission to reject non-reader-speed typing.
{
  const {h,element}=exitField();let previous='';
  for(let index=0;index<EPC.length;index++){
    const char=EPC[index];
    h.press(element,char,/\d/.test(char)?'Digit'+char:'Key'+char,140,
      {repeat:char===previous,keepHeld:char===EPC[index+1]});
    previous=char;
  }
  h.advance(100);
  check(element.value,'left '+EPC+' right','Slow hexadecimal manual input retains repeated characters');
  check(h.press(element,'Enter','Enter',140).defaultPrevented,false,'Slow manual input may submit');
}
if(failures.length){
  console.error(failures.join('\n\n'));
  console.error(`${failures.length}/${checks} repeat regression checks failed`);process.exitCode=1;
}else console.log(`${checks} repeat regression checks passed (synthetic events; physical reader unverified)`);
