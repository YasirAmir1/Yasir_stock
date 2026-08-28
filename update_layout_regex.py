import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# We want to replace the `return (` block inside the `entries.map` after `if (isEditing) { ... }`
# Let's find: `              return (\n                <div\n                  key={\`saved_${entry.id || 'item'}_${index}\`}`
# And replace until `              );` before `            })}`

start_marker = "              return (\n                <div\n                  key={`saved_${entry.id || 'item'}_${index}`}"
end_marker = "              );\n            })}\n                </div>"

start_idx = content.find(start_marker)
if start_idx != -1:
    end_idx = content.find(end_marker, start_idx)
    if end_idx != -1:
        new_card = """              return (
                <div
                  key={`saved_${entry.id || 'item'}_${index}`}
                  className="py-2.5 px-3 border-b last:border-b-0 border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-900 text-xs hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 flex flex-col gap-1 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{entry.productName}</span>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                        {entry.categoryName}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-2">
                      <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-md text-slate-800 text-[11px] min-w-[65px]">
                        {formatWithCommas(entry.quantity)} قطعة
                      </div>
                      <div className="text-center font-black text-emerald-800 px-2.5 py-1 bg-emerald-50 rounded-md border border-emerald-100 text-[11px] min-w-[75px]">
                        {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-100 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="تعديل هذا الإدخال"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="حذف السجل"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>"""
        
        content = content[:start_idx] + new_card + content[end_idx:]

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
