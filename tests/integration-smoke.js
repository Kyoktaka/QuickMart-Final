const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pages=['login.html','dashboard.html','history.html','inventory.html','scan.html','kiosk.html'];
for(const p of pages){
 const html=fs.readFileSync(path.join(root,p),'utf8');
 for(const m of html.matchAll(/<script src="((?:js|assets\/js)\/[^\"]+)"/g))
  assert(fs.existsSync(path.join(root,m[1])),p+' missing '+m[1]);
 if(p==='inventory.html')for(const id of ['epc-product','epc-arm','epc-clear','epc-captured'])assert(html.includes('id="'+id+'"'));
 if(['login.html','scan.html','kiosk.html'].includes(p))assert(html.includes('id="m-reset-confirm"'));
}
const adapter=fs.readFileSync(path.join(root,'js/backend.js'),'utf8');
for(const ep of ['api/auth/login.php','api/auth/signup.php','api/auth/forgot-password.php',
 'api/auth/reset-password.php','api/rfid/detect.php','api/rfid/register.php',
 'api/checkout/process.php','api/transactions/list.php','api/rfid/list.php'])
 assert(adapter.includes(ep),'API endpoint missing '+ep);
assert(!adapter.includes('DEMO_MODE'));
// Hardware snapshot and removal test on emulated keyboard HID event stream.
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
console.log('Page references, PHP API integration references, and RFID presence tests passed');
