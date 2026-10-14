import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Sorting the grouped entries
old_map = "{Object.entries(groupedEntries).map(([customerName, entries]) => ("
new_map = """{Object.entries(groupedEntries)
              .sort(([, entriesA], [, entriesB]) => {
                const weightA = entriesA.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                const weightB = entriesB.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                return weightB - weightA;
              })
              .map(([customerName, entries]) => ("""
content = content.replace(old_map, new_map)

# 2. Add border to customer card
old_card = '<div key={customerName} className="bg-white border border-slate-200 rounded-xl p-0 shadow-sm overflow-hidden">'
new_card = '<div key={customerName} className="bg-white border-2 border-slate-400 rounded-xl p-0 shadow-md overflow-hidden">'
content = content.replace(old_card, new_card)

# 3. Add Delegate Name next to weight
old_weight_section = """                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>"""

new_weight_section = """                  <div className="flex items-center gap-2">
                    <span className="bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300">
                      المندوب: {entries[0]?.delegateName || 'غير محدد'}
                    </span>
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>"""
content = content.replace(old_weight_section, new_weight_section)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
