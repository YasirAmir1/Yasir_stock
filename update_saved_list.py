import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_delegate_badge = """                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-[10px] border border-emerald-300">
                        المندوب: {entry.delegateName || 'غير محدد'}
                      </span>
                    </div>"""

new_delegate_badge = """                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-[10px] border border-emerald-300">
                        المندوب: {entry.delegateName || 'غير محدد'}
                      </span>
                      {entry.customerName && (
                        <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded font-black text-[10px] border border-sky-300">
                          الزبون: {entry.customerName}
                          {entry.customerCode ? ` (${entry.customerCode})` : ''}
                        </span>
                      )}
                    </div>"""

content = content.replace(old_delegate_badge, new_delegate_badge)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
