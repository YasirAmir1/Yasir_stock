import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_save = """    saveSalesEntries(itemsToSave);
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_saved_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setSuccessMessage(`تم حفظ الإدخال بنجاح (${itemsToSave.length} منتجات)`);
    setErrorMessage(null);
  };"""

new_save = """    saveSalesEntries(itemsToSave);
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_saved_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setCustomerName('');
    setCustomerCode('');
    setCustomerAddress('');
    setSuccessMessage(`تم حفظ الإدخال بنجاح (${itemsToSave.length} منتجات)`);
    setErrorMessage(null);
  };"""

content = content.replace(old_save, new_save)

old_clear = """  const handleClearGrid = () => {
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_clear_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setErrorMessage(null);
    setSuccessMessage(null);
  };"""

new_clear = """  const handleClearGrid = () => {
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_clear_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setCustomerName('');
    setCustomerCode('');
    setCustomerAddress('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };"""

content = content.replace(old_clear, new_clear)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

