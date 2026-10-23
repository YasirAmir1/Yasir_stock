import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Insert the grouping logic before the return statement
old_return = "  return ("
new_return = """  const filteredSavedEntries = safeSavedEntries.filter(
    (e) => !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm))
  );

  const groupedEntries: Record<string, typeof safeSavedEntries> = {};
  filteredSavedEntries.forEach((entry) => {
    const customer = entry.customerName || 'بدون اسم زبون';
    if (!groupedEntries[customer]) {
      groupedEntries[customer] = [];
    }
    groupedEntries[customer].push(entry);
  });

  return ("""
content = content.replace(old_return, new_return)

old_list = """          <div className="space-y-2">
            {safeSavedEntries.filter(e => !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm))).map((entry, index) => {"""

new_list = """          <div className="space-y-4">
            {Object.entries(groupedEntries).map(([customerName, entries]) => (
              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  الزبون: {customerName}
                </h4>
                <div className="space-y-2">
                  {entries.map((entry, index) => {"""

content = content.replace(old_list, new_list)

old_close = """                    <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-800">
                      {Math.round(entry.pieceWeightKg * 1000)} غرام
                    </div>
                    <div className="text-center font-black text-emerald-800 text-sm px-2.5 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
                      {entry.totalWeightKg.toFixed(2)} كجم
                    </div>
                    <div className="flex items-center gap-1 border-r pr-2 border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="تعديل هذا الإدخال"
                      >
                        <Pencil className="w-4 h-4 text-amber-600" />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSalesEntry(entry.id)}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="حذف السجل"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}"""

new_close = """                    <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-800">
                      {Math.round(entry.pieceWeightKg * 1000)} غرام
                    </div>
                    <div className="text-center font-black text-emerald-800 text-sm px-2.5 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
                      {entry.totalWeightKg.toFixed(2)} كجم
                    </div>
                    <div className="flex items-center gap-1 border-r pr-2 border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="تعديل هذا الإدخال"
                      >
                        <Pencil className="w-4 h-4 text-amber-600" />
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSalesEntry(entry.id)}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="حذف السجل"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        )}"""

content = content.replace(old_close, new_close)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

