/* scan.js – Product Recognition page: password check, then open the kiosk */
$('#btn-start-scan').onclick=()=>openAuth(()=>{
  sessionStorage.setItem(SS_KIOSK,'1');
  location.href='kiosk.html';
},2,true);
