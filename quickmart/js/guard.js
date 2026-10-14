/* guard.js – load in <head> of every protected page (before the page renders).
   Sends the visitor to login.html unless a manager is signed in.
   Add the data-require-kiosk attribute to also require the kiosk unlock (kiosk.html). */
(function(){
  if(sessionStorage.getItem('qm_auth')!=='1'){location.replace('login.html');return}
  var me=document.currentScript;
  if(me&&me.hasAttribute('data-require-kiosk')&&sessionStorage.getItem('qm_kiosk')!=='1')location.replace('scan.html');
})();
