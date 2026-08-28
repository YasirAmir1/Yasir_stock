import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix the header
old_header = """<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `${customerName} (المندوب: ${entries[0]?.delegateName || 'غير محدد'})` : `الزبون: ${customerName}`}</span>"""
new_header = """<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>"""
content = content.replace(old_header, new_header)

# 2. Fix the product list to be a table-like view
# It says "الغي بطاقة المنتجات واجعل المنتجات تترتب كجدول منتج اسفل منتج وامام كل منتج التصنيف بمربع صغير وعدد القطع ووزن الكمية وزر تعديل وزر حذف"

old_product_card = """              return (
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

new_product_card = """              return (
                <div
                  key={`saved_${entry.id || 'item'}_${index}`}
                  className="py-2 px-2 border-b last:border-b-0 border-slate-100 flex items-center justify-between gap-2 text-slate-900 text-xs hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-1 items-center gap-2 overflow-hidden">
                    <span className="font-bold text-sm text-slate-900 truncate min-w-0">{entry.productName}</span>
                    <span className="shrink-0 bg-slate-100 text-slate-600 font-semibold px-1.5 py-0.5 rounded text-[10px] border border-slate-200">
                      {entry.categoryName}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 w-16 text-left">{formatWithCommas(entry.quantity)} قطعة</span>
                      <span className="font-black text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 w-20 text-center">
                        {formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)} كجم
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="تعديل"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا السجل؟')) deleteSalesEntry(entry.id) }}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors flex items-center justify-center cursor-pointer"
                        title="حذف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );"""

content = content.replace(old_product_card, new_product_card)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
