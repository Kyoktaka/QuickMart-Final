/* Visual navigation guard; server authentication is verified in main.js.
   Browser sessionStorage is NEVER accepted as proof of authentication by PHP. */
(function(){
  const script=document.currentScript;
  if(script?.hasAttribute('data-require-kiosk')&&sessionStorage.getItem('qm_kiosk')!=='1'){
    location.replace('scan.html');
  }
})();
