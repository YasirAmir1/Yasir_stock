import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanCategories() {
  console.log("Cleaning Report 11 targets in Firestore...");
  const snap = await getDocs(collection(db, 'report11_targets'));
  console.log(`Found ${snap.size} documents in report11_targets.`);

  const targetsToZero = [
    'مقرمش وبركر وبيتزا جاهز',
    'كل انواع الجبن العادي',
    'خضراوات مجمدة وفنكر'
  ];

  let resetCount = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const catName = data.categoryName || '';
    
    // Check if category matches any of the 3 target categories
    const isTargetCat = targetsToZero.some(t => catName.includes(t) || t.includes(catName));
    if (isTargetCat || data.monthlySales === 404.1 || data.monthlySales === 1982 || data.monthlySales === 1825.7) {
      console.log(`Resetting doc ${docSnap.id}: ${data.delegateName} - ${catName} (Old monthlySales: ${data.monthlySales})`);
      await setDoc(doc(db, 'report11_targets', docSnap.id), {
        ...data,
        monthlySales: 0,
        monthlyTarget: 0,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system_cleanup'
      }, { merge: true });
      resetCount++;
    }
  }

  console.log(`Successfully reset ${resetCount} documents to 0 in Firestore!`);
  process.exit(0);
}

cleanCategories().catch(err => {
  console.error("Error during cleanup:", err);
  process.exit(1);
});
