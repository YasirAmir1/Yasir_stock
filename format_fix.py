import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update formatWithCommas calls for weights
content = content.replace("formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)))", "formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)")
content = content.replace("formatWithCommas(parseFloat(rowKgVal.toFixed(2)))", "formatWithCommas(parseFloat(rowKgVal.toFixed(2)), true)")
content = content.replace("formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)))", "formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)")
content = content.replace("formatWithCommas(entry.pieceWeightKg)", "formatWithCommas(entry.pieceWeightKg, true)")
content = content.replace("formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)))", "formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)")

# Redesign the grouped entries display
old_grouped = """              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-300 shadow-sm">
                      {formatWithCommas(entries.reduce((sum, e) => sum + (e.quantity || 0), 0))} قطع
                    </span>
                    <span className="bg-emerald-600 text-white text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-700 shadow-sm">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)))} كجم
                    </span>
                  </div>
                </h4>
                <div className="space-y-2">"""

new_grouped = """              <div key={customerName} className="bg-white border border-slate-300 rounded-xl p-0 shadow-sm overflow-hidden">
                <h4 className="font-extrabold text-slate-800 text-sm p-3 bg-slate-100 flex items-center justify-between gap-2 flex-wrap border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-black px-3 py-1.5 rounded-md border border-emerald-300 shadow-sm">
                      {formatWithCommas(entries.reduce((sum, e) => sum + (e.quantity || 0), 0))} قطع
                    </span>
                    <span className="bg-emerald-600 text-white text-xs font-black px-3 py-1.5 rounded-md border border-emerald-700 shadow-sm">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)), true)} كجم
                    </span>
                  </div>
                </h4>
                <div className="flex flex-col">"""

content = content.replace(old_grouped, new_grouped)

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
                      {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)))} كجم
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
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer"
                        title="حذف هذا الإدخال"
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
                  className="p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-900 text-xs border-b last:border-b-0 border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 flex flex-col">
                    <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                      <span>{entry.productName}</span>
                      {entry.delegateName && (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[10px] font-bold border border-emerald-100">
                          {entry.delegateName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <div className="flex items-center gap-1 text-slate-700 font-bold">
                      <span className="bg-slate-100 px-2 py-1 rounded">{formatWithCommas(entry.quantity)} قطعة</span>
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-1 rounded">{formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded transition-colors"
                        title="تعديل"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSalesEntry(entry.id)}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-100 rounded transition-colors"
                        title="حذف"
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
