/* QR FORMAT FOR LOCAL SCHOOL DEMONSTRATION ONLY.
   QMPAY|DEMO|C293 (checksum is not a real payment signature).
   Backend /api/checkout/process.php enforces explicit localhost demo flags.
   Real payments require server-side payment-provider verification. */
function makeChecksum(walletId){
  let total=0;
  for(const character of String(walletId))total+=character.charCodeAt(0);
  return 'C'+(total%997);
}
