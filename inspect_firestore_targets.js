import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  const snap = await getDocs(collection(db, 'report11_targets'));
  console.log(`Total docs in report11_targets: ${snap.size}`);
  snap.docs.forEach(doc => {
    const d = doc.data();
    console.log(`Doc ID: ${doc.id} | Del: "${d.delegateName}" | Cat: "${d.categoryName}" | Target: ${d.monthlyTarget} | Sales: ${d.monthlySales}`);
  });
  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
