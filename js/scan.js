/* Password verification is performed by PHP before opening the kiosk. */
$('#btn-start-scan').onclick=()=>openAuth(async()=>{
  sessionStorage.setItem(SS_KIOSK,'1');location.href='kiosk.html';
},2,true);
