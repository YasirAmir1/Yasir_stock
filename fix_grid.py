import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_logic = """  const handleSaveGrid = () => {
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
    const trimmedCustomerName = customerName.trim();"""

new_logic = """  const handleSaveGrid = () => {
    const trimmedCustomerName = customerName.trim();
    if (!trimmedCustomerName) {
      window.alert('تنبيه: لم تقم بإدخال اسم الزبون!');
      return;
    }

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

    let invalidFound = false;"""

content = content.replace(old_logic, new_logic)

old_check = """        const pieceWeightKg = wGrams / 1000;
        const totalW = (q * wGrams) / 1000;

        if (!trimmedCustomerName) {
          setErrorMessage('يرجى إدخال اسم الزبون قبل الحفظ');
          invalidFound = true;
          break;
        }

        itemsToSave.push({"""

new_check = """        const pieceWeightKg = wGrams / 1000;
        const totalW = (q * wGrams) / 1000;

        itemsToSave.push({"""

content = content.replace(old_check, new_check)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
