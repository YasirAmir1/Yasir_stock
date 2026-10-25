import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add states for customer fields
state_addition = """  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
"""
if 'const [customerName, setCustomerName]' not in content:
    content = content.replace(
        'const [activeAutocompleteRowId, setActiveAutocompleteRowId] = useState<string | null>(null);',
        state_addition + '  const [activeAutocompleteRowId, setActiveAutocompleteRowId] = useState<string | null>(null);'
    )

# Add clear to handleClearGrid
old_clear = """  const handleClearGrid = () => {
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
  };"""

new_clear = """  const handleClearGrid = () => {
    setGridRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `row_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        category: defaultCategory,
        pieceWeight: '',
        quantity: '',
        productName: '',
      }))
    );
    setCustomerName('');
    setCustomerCode('');
    setCustomerAddress('');
  };"""

content = content.replace(old_clear, new_clear)

# Update handleSaveGrid to validate customer name and include the data
old_save_start = """  const handleSaveGrid = () => {
    const itemsToSave: {
      productName: string;
      categoryName: string;
      quantity: number;
      pieceWeightKg: number;
      totalWeightKg: number;
      delegateName: string;
      dateString: string;
    }[] = [];

    let invalidFound = false;"""

new_save_start = """  const handleSaveGrid = () => {
    const itemsToSave: {
      productName: string;
      categoryName: string;
      quantity: number;
      pieceWeightKg: number;
      totalWeightKg: number;
      delegateName: string;
      dateString: string;
      customerName: string;
      customerCode?: string;
      customerAddress?: string;
    }[] = [];

    let invalidFound = false;
    const trimmedCustomerName = customerName.trim();
"""

content = content.replace(old_save_start, new_save_start)

# After validating if fields are filled, we should check if customer name is empty.
old_save_push = """        itemsToSave.push({
          productName: name,
          categoryName: cat,
          quantity: q,
          pieceWeightKg: pieceWeightKg,
          totalWeightKg: totalW,
          delegateName: activeDelegateName || 'غير محدد',
          dateString: new Date().toISOString().split('T')[0],
        });"""

new_save_push = """        if (!trimmedCustomerName) {
          setErrorMessage('يرجى إدخال اسم الزبون قبل الحفظ');
          invalidFound = true;
          break;
        }

        itemsToSave.push({
          productName: name,
          categoryName: cat,
          quantity: q,
          pieceWeightKg: pieceWeightKg,
          totalWeightKg: totalW,
          delegateName: activeDelegateName || 'غير محدد',
          dateString: new Date().toISOString().split('T')[0],
          customerName: trimmedCustomerName,
          customerCode: customerCode.trim(),
          customerAddress: customerAddress.trim()
        });"""

content = content.replace(old_save_push, new_save_push)

# Finally, clear customer details after successful save
old_save_end = """    if (invalidFound) return;

    if (itemsToSave.length > 0) {
      saveSalesEntries(itemsToSave);
      handleClearGrid();
      setSuccessMessage(`تم حفظ ${itemsToSave.length} منتج بنجاح ✅`);
    } else {
      setErrorMessage('الجدول فارغ! يرجى إدخال منتجات قبل الحفظ.');
    }
  };"""

new_save_end = """    if (invalidFound) return;

    if (itemsToSave.length > 0) {
      saveSalesEntries(itemsToSave);
      handleClearGrid();
      setSuccessMessage(`تم حفظ ${itemsToSave.length} منتج بنجاح ✅`);
    } else {
      setErrorMessage('الجدول فارغ! يرجى إدخال منتجات قبل الحفظ.');
    }
  };"""

content = content.replace(old_save_end, new_save_end)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
