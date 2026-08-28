import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_header = """            {Object.entries(groupedEntries).map(([customerName, entries]) => (
              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  {currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}
                </h4>"""

new_header = """            {Object.entries(groupedEntries).map(([customerName, entries]) => (
              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-md border border-emerald-300 shadow-sm">
                    {entries.reduce((sum, e) => sum + (e.quantity || 0), 0)} قطع
                  </span>
                </h4>"""

content = content.replace(old_header, new_header)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
