import re

with open('src/components/AdminScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("  } = useSales();", "    syncData,\n  } = useSales();")

with open('src/components/AdminScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
