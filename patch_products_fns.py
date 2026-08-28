import re
with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_return = "  return ("
new_return = """  const handleSaveQuickAdd = () => {
    const trimmedCustomerName = customerName.trim();
    if (!trimmedCustomerName) {
      window.alert('تنبيه: لم تقم بإدخال اسم الزبون!');
      return;
    }

    const itemsToSave = [];
    const entries = Object.entries(selectedQuantities);
    if (entries.length === 0) {
      window.alert('تنبيه: لم تقم بإضافة أي منتج للزبون.');
      return;
    }

    for (const [prodId, qtyStr] of entries) {
      const q = parseInt(qtyStr, 10);
      if (isNaN(q) || q <= 0) continue;
      
      const prod = productsList.find(p => p.id === prodId);
      if (!prod) continue;
      
      const wGrams = Math.round(Number(prod.pieceWeightKg) * 1000) || 0;
      const pieceWeightKg = wGrams / 1000;
      const totalW = (q * wGrams) / 1000;
      
      itemsToSave.push({
        productName: prod.productName,
        categoryName: prod.categoryName,
        quantity: q,
        pieceWeightKg: pieceWeightKg,
        totalWeightKg: totalW,
        delegateName: activeDelegateName || 'عام',
        dateString: new Date().toISOString().split('T')[0],
        customerName: trimmedCustomerName,
        customerCode: customerCode.trim(),
        customerAddress: customerAddress.trim()
      });
    }

    if (itemsToSave.length > 0) {
      saveSalesEntries(itemsToSave);
      setUserMessage(`تم حفظ ${itemsToSave.length} منتجات للزبون ${trimmedCustomerName} وتم إرسالها لصفحة الإدخالات.`);
      setSelectedQuantities({});
      setCustomerName('');
      setCustomerCode('');
      setCustomerAddress('');
    }
  };

  const handleUpdateQuantity = (prodId: string, val: string) => {
    if (val === '') {
      const newQ = { ...selectedQuantities };
      delete newQ[prodId];
      setSelectedQuantities(newQ);
    } else {
      setSelectedQuantities({ ...selectedQuantities, [prodId]: val });
    }
  };

  return ("""
content = content.replace(old_return, new_return)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
