import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'setSuccessMessage(`تم حفظ الإدخال بنجاح (${itemsToSave.length} منتجات)`);',
    "setCustomerName('');\n    setCustomerCode('');\n    setCustomerAddress('');\n    setSuccessMessage(`تم حفظ الإدخال بنجاح (${itemsToSave.length} منتجات)`);"
)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
