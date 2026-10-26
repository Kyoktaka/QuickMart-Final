// Real guard + browser insertion/deletion order. Physical HID identity remains unverified.
const assert=require('node:assert/strict');
const {setup}=require('./rfid-modifier-guard');
const EPCs=['E28011700000021905AC0C04','30142B8A004C2000000463'];
let checks=0;
function check(actual,expected,label){assert.deepEqual(actual,expected,label);checks++}
function code(key){return key.length===1?(/\d/.test(key)?'Digit'+key:'Key'+key.toUpperCase()):key}
function edited(value,start,end,key){
  let text=key;
  if(key==='Backspace'||key==='Delete'){
    text='';
    if(start===end){if(key==='Backspace')start=Math.max(0,start-1);else end=Math.min(value.length,end+1)}
  }
  return {value:value.slice(0,start)+text+value.slice(end),caret:start+text.length};
}
for(const text of EPCs){
  for(const type of ['text','password','search','textarea']){
    for(const key of ['Backspace','Delete','g',' ']){
      for(let at=1;at<text.length;at++){
        for(const selection of [[5,12],[7,7],[18,18]]){
          const h=setup(),el=h.field(type),original=el.value;
          el.setSelectionRange(...selection);
          const expected=edited(original,...selection,key);
          const observed=[];
          for(let index=0;index<text.length;index++){
            if(index===at)h.press(el,key,code(key),1);
            h.readerKey(el,text[index]);
            observed.push(el.value);
          }
          const enter=h.press(el,'Enter','Enter',8);h.advance(800);
          const label=`${type}, ${text.slice(0,2)}, ${key} at ${at}, selection ${selection}`;
          check(observed.every(value=>value===original),true,label+': no transient reader prefix');
          check(el.value,expected.value,label+': exact human edit survives');
          check([el.selectionStart,el.selectionEnd],[expected.caret,expected.caret],label+': caret survives');
          check(enter.defaultPrevented,true,label+': reader Enter is blocked');
        }
      }
    }
  }
}
// A short ordinary prefix, edits and subsequent hex keys must replay in their
// original order, rather than moving all deferred edits behind the final digit.
for(const keys of [
  ['E','Backspace','2','6'],['3','Delete','g','1'],
  [...'James2026'],['E','g','2','Delete','7'],['3',' ','0','Backspace','9']
]){
  const h=setup(),el=h.field('text');let expected={value:el.value,caret:5},end=12;
  for(const key of keys){
    expected=edited(expected.value,expected.caret,end,key);end=expected.caret;
    h.press(el,key,code(key),7);
  }
  h.advance(100);
  check(el.value,expected.value,'Ordinary pending edits retain key order: '+keys.join(','));
  check([el.selectionStart,el.selectionEnd],[expected.caret,expected.caret],'Ordinary pending caret is exact');
  check(h.press(el,'Enter','Enter',140).defaultPrevented,false,'Ordinary Enter remains available');
}
for(const key of ['Backspace','Delete']){
  const h=setup(),el=h.field('password');
  let expected=edited(el.value,5,12,key);
  for(let index=0;index<EPCs[0].length;index++){
    if(index===1||index===2||index===3){
      h.press(el,key,key,1,{repeat:index>1});
      if(index>1)expected=edited(expected.value,expected.caret,expected.caret,key);
    }
    h.readerKey(el,EPCs[0][index]);
  }
  h.press(el,'Enter','Enter',8);h.advance(800);
  check(el.value,expected.value,'Held '+key+' cannot release the first three reader characters');
}
for(const delay of [401,500,590]){
  const h=setup(),el=h.field('password');
  for(const char of EPCs[0])h.readerKey(el,char);
  check(h.press(el,'Enter','Enter',delay).defaultPrevented,true,'Delayed reader Enter remains blocked at '+delay+' ms');
  check(el.value,'left REPLACE right','Delayed Enter cannot change the password');
}
console.log(`${checks} input-edit isolation checks passed (synthetic events; physical reader unverified)`);
