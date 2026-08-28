import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("onClick={() => deleteSalesEntry(entry.id)}", "onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}")

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
