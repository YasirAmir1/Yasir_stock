import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_block = """                  <div className="flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300">
                      المندوب: {entries[0]?.delegateName || 'غير محدد'}
                    </span>
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">"""

new_block = """                  <div className="flex items-center gap-2">
                    <div className="bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg border border-slate-300 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                      <span className="text-xs sm:text-sm font-bold">المندوب: {entries[0]?.delegateName || 'غير محدد'}</span>
                      {entries[0]?.timestamp && (
                        <span className="text-[9px] text-slate-500 font-bold whitespace-nowrap sm:border-r border-slate-300 sm:pr-2" dir="ltr">
                          {new Date(entries[0].timestamp).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      )}
                    </div>
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced successfully")
else:
    print("Block not found")
