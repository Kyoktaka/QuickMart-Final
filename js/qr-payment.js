/* ===== QR PAYMENT ===== */
/* Demo QR format: QMPAY|<wallet id>|<checksum>. Client-side checks are for the demo only – the backend must validate for real. */
function makeChecksum(walletId){let t=0;for(let i=0;i<walletId.length;i++)t+=walletId.charCodeAt(i);return 'C'+(t%997)}
function checkScannedPayment(text,total){
  const parts=String(text).trim().split('|');
  if(parts.length!==3||parts[0]!=='QMPAY')return{result:'failed',reason:'Unrecognized QR code. Please use a valid QuickMart QR.'};
  const [,walletId,sum]=parts;
  if(sum!==makeChecksum(walletId))return{result:'failed',reason:'Invalid QR code signature. This QR is fake or corrupted.'};
  const w=WALLET_DB[walletId];
  if(!w)return{result:'failed',reason:'Wallet not found. Please register your wallet first.'};
  if(w.balance<total)return{result:'failed',reason:`Insufficient balance. Wallet ${walletId} has ${peso(w.balance)} but the total is ${peso(total)}.`};
  return{result:'success',reason:`Payment approved for ${w.holder}.`};
}
