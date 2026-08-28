import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_card = """              return (
                <div
                  key={`saved_${entry.id || 'item'}_${index}`}
                  className="p-3 bg-white border border-slate-300 rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-slate-900 text-xs hover:border-emerald-400 transition-all"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-black text-[10px] border border-emerald-300">
                        المندوب: {entry.delegateName || 'غير محدد'}
                      </span>
                    </div>
                    <div className="font-bold text-sm text-slate-900">{entry.productName}</div>
                    <div className="text-slate-600 font-semibold">الصنف: {entry.categoryName}</div>
                  </div>
                  <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-800">
                      {formatWithCommas(entry.quantity)} قطعة
                    </div>
                    <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-800">
                      {Math.round(entry.pieceWeightKg * 1000)} غرام
                    </div>
                    <div className="text-center font-black text-emerald-800 text-sm px-2.5 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
                      {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
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
                        onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="حذف السجل"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                        <span>حذف</span>
                      </button>
                    </div>
                  </div>
                </div>
              );"""

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
                      <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-md text-slate-800 text-[11px] min-w-[65px]">
                        {Math.round(entry.pieceWeightKg * 1000)} غرام
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
                </div>
              );"""

content = content.replace(old_card, new_card)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
