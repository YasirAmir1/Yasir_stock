import re

with open('src/components/AdminScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("onClick={() => deleteDelegateAccount(acc.username)}", "onClick={() => { if(window.confirm('هل أنت متأكد من حذف حساب المندوب هذا؟')) deleteDelegateAccount(acc.username) }}")

with open('src/components/AdminScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
