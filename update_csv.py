import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_headers = "const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'اسم المنتج', 'الصنف', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)'];"
new_headers = "const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'اسم المنتج', 'الصنف', 'كود المنتج', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)'];"
content = content.replace(old_headers, new_headers)

old_rows = """    const rows = safeSavedEntries.map(entry => [
      entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : '',
      entry.delegateName || 'غير محدد',
      entry.customerName || 'بدون اسم زبون',
      entry.productName,
      entry.categoryName,
      entry.quantity.toString(),
      entry.pieceWeightKg.toString(),
      entry.totalWeightKg.toString()
    ]);"""

new_rows = """    const rows = safeSavedEntries.map(entry => [
      entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : '',
      entry.delegateName || 'غير محدد',
      entry.customerName || 'بدون اسم زبون',
      entry.productName,
      entry.categoryName,
      getProductCode(entry.productName),
      entry.quantity.toString(),
      entry.pieceWeightKg.toString(),
      entry.totalWeightKg.toString()
    ]);"""
content = content.replace(old_rows, new_rows)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("CSV export updated with product code")
