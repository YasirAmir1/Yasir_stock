import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_badge = """                      {entry.customerName && (
                        <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded font-black text-[10px] border border-sky-300">
                          الزبون: {entry.customerName}
                          {entry.customerCode ? ` (${entry.customerCode})` : ''}
                        </span>
                      )}"""

new_badge = ""

content = content.replace(old_badge, new_badge)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
