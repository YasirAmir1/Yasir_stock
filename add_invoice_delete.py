import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_block = """                  <div className="flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300">
                      المندوب: {entries[0]?.delegateName || 'غير محدد'}
                    </span>
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>"""

new_block = """                  <div className="flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300 hidden sm:inline-block">
                      المندوب: {entries[0]?.delegateName || 'غير محدد'}
                    </span>
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if(window.confirm('هل تريد حذف الفاتورة : نعم او لا')) {
                          entries.forEach(e => deleteSalesEntry(e.id));
                        }
                      }}
                      className="p-1.5 bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-800 rounded-lg border border-red-200 transition-colors cursor-pointer shadow-sm flex items-center justify-center"
                      title="حذف الفاتورة بالكامل"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced successfully")
else:
    print("Target block not found!")
