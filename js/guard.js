/* Visual navigation guard; server authentication is verified in main.js.
   Browser sessionStorage is NEVER accepted as proof of authentication by PHP. */
(function(){
  const script=document.currentScript;
  // The server authorization check in main.js also supports recoverable direct refreshes.
  // This early guard deliberately does not treat sessionStorage as access authorization.
  if(script?.hasAttribute('data-require-kiosk')&&window.RFIDScanner)window.RFIDScanner.disable();
})();
