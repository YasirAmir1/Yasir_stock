import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('تصدير البيانات كملف CSV', 'تصدير البيانات كملف Excel')
content = content.replace('<span>تصدير CSV</span>', '<span>تصدير الادخالات</span>')

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Export text updated")
