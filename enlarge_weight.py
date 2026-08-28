import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    """<span className="bg-emerald-600 text-white text-xs font-black px-3 py-1.5 rounded-md border border-emerald-700 shadow-sm">""",
    """<span className="bg-emerald-600 text-white text-base font-black px-3 py-1.5 rounded-md border border-emerald-700 shadow-sm">"""
)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
