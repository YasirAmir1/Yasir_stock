import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300 hidden sm:inline-block"',
    'className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300"'
)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
