import re
with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("imageUrl: String(imageUrl),", "imageUrl: String(imageUrl),\n          isAvailable: true,")
content = content.replace("imageUrl: '',", "imageUrl: '',\n      isAvailable: true,")

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
