const fs = require('fs');
let content = fs.readFileSync('src/context/SalesContext.tsx', 'utf8');

const regex = /const newWeight = prevWeight \+ addedWeight;[\s\S]*?setUserMessage\('تعذر الاتصال بالخادم\. تم حفظ المبيعات محلياً وسيتم مزامنتها لاحقاً 📴'\);\s*\}/;

const replacement = `const newWeight = prevWeight + addedWeight;

    const delTargets = delegateTargets.filter(
      (t) => t.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase()
    );

    const dailyTargetKg = delTargets.reduce((sum, t) => sum + t.dailyTargetWeightKg, 0) || 800;
    const now = Date.now();

    const newCommittedEntries: SalesEntry[] = [];
    const updatedEntries: SalesEntry[] = [];

    newEntriesData.forEach((data, idx) => {
      const existing = salesEntries.find(
        (e) => 
          e.dateString === selectedDate &&
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.customerName?.trim() === data.customerName?.trim() &&
          e.productName === data.productName &&
          e.priceMode === data.priceMode
      );
      
      if (existing) {
        const alreadyUpdatedIndex = updatedEntries.findIndex(e => e.id === existing.id);
        if (alreadyUpdatedIndex >= 0) {
           const prevUpd = updatedEntries[alreadyUpdatedIndex];
           updatedEntries[alreadyUpdatedIndex] = {
             ...prevUpd,
             quantity: prevUpd.quantity + data.quantity,
             enteredQuantity: (prevUpd.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: prevUpd.totalWeightKg + data.totalWeightKg
           };
        } else {
           updatedEntries.push({
             ...existing,
             quantity: existing.quantity + data.quantity,
             enteredQuantity: (existing.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: existing.totalWeightKg + data.totalWeightKg
           });
        }
      } else {
        const alreadyNewIndex = newCommittedEntries.findIndex(e => e.productName === data.productName && e.customerName?.trim() === data.customerName?.trim() && e.priceMode === data.priceMode);
        if (alreadyNewIndex >= 0) {
           const prevNew = newCommittedEntries[alreadyNewIndex];
           newCommittedEntries[alreadyNewIndex] = {
             ...prevNew,
             quantity: prevNew.quantity + data.quantity,
             enteredQuantity: (prevNew.enteredQuantity || 0) + (data.enteredQuantity || 0),
             totalWeightKg: prevNew.totalWeightKg + data.totalWeightKg
           };
        } else {
           const id = \`\${now}_\${idx}_\${Math.random().toString(36).substr(2, 5)}\`;
           newCommittedEntries.push({ ...data, id, timestamp: now });
        }
      }
    });

    if (!navigator.onLine) {
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries, ...updatedEntries]);
      setSalesEntries((prev) => {
        let next = [...prev];
        updatedEntries.forEach(upd => {
           const i = next.findIndex(x => x.id === upd.id);
           if(i >= 0) next[i] = upd;
        });
        return [...next, ...newCommittedEntries];
      });
      setUserMessage('أنت في وضع عدم الاتصال. تم حفظ المبيعات محلياً وسيتم مزامنتها تلقائياً عند الاتصال 📴');
      checkAndTriggerMilestoneToasts(activeDelegateName, prevWeight, newWeight, dailyTargetKg);
      return;
    }

    try {
      const batch = writeBatch(db);
      newCommittedEntries.forEach((entry) => {
        const entryRef = doc(db, 'sales_entries', entry.id);
        batch.set(entryRef, entry);
      });
      updatedEntries.forEach((entry) => {
        const entryRef = doc(db, 'sales_entries', entry.id);
        batch.set(entryRef, entry, { merge: true });
      });
      await batch.commit();
      setUserMessage('تم حفظ المبيعات بنجاح ومزامنتها فوراً مع الأدمن ✅');
      checkAndTriggerMilestoneToasts(activeDelegateName, prevWeight, newWeight, dailyTargetKg);
    } catch (e) {
      console.error('Error saving sales entries, queueing offline:', e);
      const pending = getPendingQueue();
      savePendingQueue([...pending, ...newCommittedEntries, ...updatedEntries]);
      setSalesEntries((prev) => {
        let next = [...prev];
        updatedEntries.forEach(upd => {
           const i = next.findIndex(x => x.id === upd.id);
           if(i >= 0) next[i] = upd;
        });
        return [...next, ...newCommittedEntries];
      });
      setUserMessage('تعذر الاتصال بالخادم. تم حفظ المبيعات محلياً وسيتم مزامنتها لاحقاً 📴');
    }`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync('src/context/SalesContext.tsx', content);
    console.log("Success");
} else {
    console.log("Not found via regex either!");
}
