import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the customer header
old_header = """                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-300 shadow-sm">
                      {formatWithCommas(entries.reduce((sum, e) => sum + (e.quantity || 0), 0))} قطع
                    </span>
                    <span className="bg-emerald-600 text-white text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-700 shadow-sm">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>
                </h4>"""

new_header = """                <h4 className="font-extrabold text-slate-800 text-sm mb-0 p-3 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap rounded-t-xl">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `${customerName} (المندوب: ${entries[0]?.delegateName || 'غير محدد'})` : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-600 text-white text-base sm:text-lg font-black px-4 py-1.5 rounded-lg border border-emerald-700 shadow-md">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>
                </h4>"""

content = content.replace(old_header, new_header)
content = content.replace('                <div className="space-y-2">', '                <div className="flex flex-col px-2 pb-2 pt-1">')
content = content.replace('              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">', '              <div key={customerName} className="bg-white border border-slate-200 rounded-xl p-0 shadow-sm overflow-hidden">')

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
              );"""

new_card = """              return (
                <div
                  key={`saved_${entry.id || 'item'}_${index}`}
                  className="py-2.5 px-2 border-b last:border-b-0 border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-900 text-xs hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[13px] text-slate-900">{entry.productName}</span>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded">
                        {entry.categoryName}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <span className="text-xs bg-slate-100 px-2 py-1 rounded">{formatWithCommas(entry.quantity)} قطعة</span>
                      <span className="text-emerald-700 font-black bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                        {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="تعديل الإدخال"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSalesEntry(entry.id)}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="حذف الإدخال"
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
