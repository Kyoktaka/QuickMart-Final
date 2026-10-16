const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pages=['login.html','dashboard.html','history.html','inventory.html','scan.html','kiosk.html'];
const rootHtml=fs.readdirSync(root).filter(p=>p.endsWith('.html'));
assert.deepEqual(rootHtml,['index.html'],'Only index.html should exist at repository root');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(index.includes("location.replace('manager/login.html'+location.search+location.hash)"));
for(const p of pages){
 const name='manager/'+p;
 const html=fs.readFileSync(path.join(root,name),'utf8');
 for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
  const ref=match[1];
  if(/^(https?:|data:|mailto:|#)/i.test(ref)||ref.startsWith('//'))continue;
  const clean=ref.split(/[?#]/)[0];
  if(!clean)continue;
  const target=path.resolve(root,'manager',clean);
  assert(fs.existsSync(target),name+' has broken asset/navigation path: '+ref);
 }
 for(const m of html.matchAll(/<script src="([^"]+)"/g)){
  if(!/^https?:/i.test(m[1]))assert(fs.existsSync(path.resolve(root,'manager',m[1])),name+' missing '+m[1]);
 }
 assert(html.includes('../js/backend.js'),name+' must load the real PHP API adapter');
 if(p==='inventory.html')for(const id of ['epc-product','epc-arm','epc-clear','epc-captured'])
  assert(html.includes('id="'+id+'"'),name+' missing '+id);
 if(['login.html','scan.html','kiosk.html'].includes(p))
  assert(html.includes('id="m-reset-confirm"'),name+' missing reset confirmation');
}
// EPC batch UI contract: all captured tags belong INSIDE the multiline field,
// not in a subtitle below a single-line input. Asset versioning avoids stale JS.
const inventoryHtml=fs.readFileSync(path.join(root,'manager/inventory.html'),'utf8');
const inventoryJs=fs.readFileSync(path.join(root,'js/inventory.js'),'utf8');
assert(inventoryHtml.includes('<textarea id="epc-code"'),'EPC entry must be multiline');
assert(!inventoryHtml.includes('<input id="epc-code"'),'Old single-line EPC box must be absent');
assert(inventoryHtml.includes('data-epc-ui="multiline-v3"'),'EPC UI version marker missing');
assert(inventoryHtml.includes('inventory.js?v=epc-multiline-v3'),'Inventory JS must be cache-busted');
assert(inventoryHtml.includes('inventory.css?v=epc-multiline-v3'),'Inventory CSS must be cache-busted');
assert(!inventoryHtml.includes('No EPCs captured yet.'),'Do not show an extra subtitle below EPC list');
assert(!inventoryJs.includes("unique EPC'+"),'Old EPC subtitle output must never reappear');
assert(inventoryJs.includes("field.value=[...pendingEpcs].join('\\n')"),
  'All scanned EPCs must populate the multiline box, one per line');

const legacy=fs.readFileSync(path.join(root,'manager/reset-password.html'),'utf8');
assert(legacy.includes("const target='login.html'+"));
const mail=fs.readFileSync(path.join(root,'api/auth/forgot-password.php'),'utf8');
assert(mail.includes("'/manager/login.html?reset_token='"));
const adapter=fs.readFileSync(path.join(root,'js/backend.js'),'utf8');
for(const ep of ['api/auth/login.php','api/auth/signup.php','api/auth/forgot-password.php',
 'api/auth/reset-password.php','api/rfid/detect.php','api/rfid/register.php',
 'api/checkout/process.php','api/transactions/list.php','api/rfid/list.php'])
 assert(adapter.includes(ep),'API endpoint missing '+ep);
assert(!adapter.includes('DEMO_MODE'));
assert(adapter.includes("fetch('../'+path"),'PHP API fetch must go up from manager/');
const url=new URL('../api/auth/me.php','http://localhost/QuickMart-Final/manager/dashboard.html');
assert.equal(url.href,'http://localhost/QuickMart-Final/api/auth/me.php');
// Existing no-hardware RFID presence and removal test.
const scanner=fs.readFileSync(path.join(root,'assets/js/rfid-scanner.js'),'utf8');
let now=0,keyListener=null,intervalFn=null,timeoutFn=null;
const events=[],win={dispatchEvent:e=>events.push(e)};
class CustomEvent{constructor(type,opt){this.type=type;this.detail=opt.detail}}
vm.runInNewContext(scanner,{
 window:win,CustomEvent,document:{activeElement:{tagName:'BODY'},addEventListener:(key,cb)=>{if(key==='keydown')keyListener=cb}},
 performance:{now:()=>now},setInterval:fn=>{intervalFn=fn},
 setTimeout:fn=>{timeoutFn=fn;return 1},clearTimeout:()=>{timeoutFn=null}
});
const reader=win.RFIDScanner;reader.enable();
function scan(epc){for(const c of epc){keyListener({key:c,preventDefault(){},stopPropagation(){}});now+=8}
 keyListener({key:'Enter',preventDefault(){},stopPropagation(){}})}
const a='E280111100000000000001',b='E280111100000000000002';
scan(a);scan(b);scan(a);
assert.deepEqual([...reader.getPresentEpcs()],[a,b]);
assert.equal(events.filter(e=>e.type==='rfid:epc').length,2);
for(let i=0;i<4;i++){now+=1300;scan(a);scan(b);intervalFn()}
assert.deepEqual([...reader.getPresentEpcs()],[a,b]);
now+=11000;intervalFn();assert.deepEqual([...reader.getPresentEpcs()],[]);
reader.disable();assert(!reader.isEnabled());
console.log('Manager page paths, password-reset routing, PHP API and RFID smoke tests passed');
