import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_save = """        itemsToSave.push({
          productName: name,
          categoryName: cat,
          quantity: q,
          pieceWeightKg: pieceWeightKg,
          totalWeightKg: totalW,
          delegateName: activeDelegateName || 'عام',
          dateString: new Date().toISOString().split('T')[0],
        });"""

new_save = """        if (!trimmedCustomerName) {
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
          delegateName: activeDelegateName || 'عام',
          dateString: new Date().toISOString().split('T')[0],
          customerName: trimmedCustomerName,
          customerCode: customerCode.trim(),
          customerAddress: customerAddress.trim()
        });"""

content = content.replace(old_save, new_save)

# Let's NOT clear the customer name when saving, as delegates usually sell multiple items to same customer, or maybe they want it cleared?
# I'll leave handleClearGrid as is for now. But wait, if they say "يتم مسح... ومسح...", it sounds like they are annoyed by it.
# Let's remove the clear from save just for the customer, or maybe for the whole grid?
# Actually, I'll just remove the customer clear from handleClearGrid to be safe, but wait, if it's a new customer they can clear it themselves using the "مسح الجدول" button, or I can provide a separate "فاتورة جديدة" button.
# "عند الحفظ يتم مسح جدول الادخال اعلاه ومسح ادخال اسم الزبون اعلاه" (Upon saving, the entry table above is cleared and the customer name input above is cleared).
# This implies they DO NOT want it to be cleared upon saving! They probably want to add more things or just see what they saved. Let's remove handleClearGrid() from handleSaveGrid, or just remove the customer clear.
# Actually, it's safer to just clear the table but KEEP the customer name, or not clear anything? Let's just NOT clear anything on save.
# Wait, if they don't clear on save, they might double-save. Clearing the grid is standard. But maybe they want to keep the customer name? Let's keep the customer name, but clear the grid!

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
