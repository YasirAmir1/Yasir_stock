with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("} , Download } from 'lucide-react';", ", Download } from 'lucide-react';")

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
