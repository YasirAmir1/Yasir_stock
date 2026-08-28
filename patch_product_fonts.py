import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Product Name
old_name = """                      <h3 className="font-bold text-[10px] sm:text-xs leading-tight">
                        {prod.productName}
                      </h3>"""
new_name = """                      <h3 className="font-black text-xs sm:text-sm leading-tight text-slate-900 dark:text-slate-100">
                        {prod.productName}
                      </h3>"""
content = content.replace(old_name, new_name)

# 2. Category Name
old_cat = """<span className={`inline-block px-1.5 py-0.5 rounded-full text-[8px] font-bold ${"""
new_cat = """<span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black ${"""
content = content.replace(old_cat, new_cat)

# 3. Code & Stock
old_code = """                      <div className="font-mono text-[8px] font-bold text-cyan-600 dark:text-cyan-400 opacity-80">"""
new_code = """                      <div className="font-mono text-[9px] sm:text-[10px] font-black text-cyan-600 dark:text-cyan-400 opacity-80">"""
content = content.replace(old_code, new_code)

old_stock = """                          <div className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 px-1.5 py-0.5 rounded text-[8px] font-bold text-indigo-600 dark:text-indigo-400" title="عدد كارتون بالمخزن">"""
new_stock = """                          <div className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 px-1.5 py-0.5 rounded text-[9px] font-black text-indigo-600 dark:text-indigo-400" title="عدد كارتون بالمخزن">"""
content = content.replace(old_stock, new_stock)


# 4. Small labels (Carton QTY, Weight)
old_label1 = """<span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 ">العدد بالكرتون</span>"""
new_label1 = """<span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">العدد بالكرتون</span>"""
content = content.replace(old_label1, new_label1)

old_label2 = """<span className="text-[8px] font-bold text-slate-400 dark:text-slate-500 ">وزن القطعة</span>"""
new_label2 = """<span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">وزن القطعة</span>"""
content = content.replace(old_label2, new_label2)

old_qty = """<span className="font-extrabold text-amber-600 dark:text-amber-400 text-[10px] sm:text-xs">"""
new_qty = """<span className="font-black text-amber-600 dark:text-amber-400 text-xs sm:text-sm">"""
content = content.replace(old_qty, new_qty)

old_wt = """<span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-[10px] sm:text-xs">
                          {Math.round(Number(prod.pieceWeightKg) * 1000)} غ
                        </span>"""
new_wt = """<span className="font-black text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm">
                          {Math.round(Number(prod.pieceWeightKg) * 1000)} غ
                        </span>"""
content = content.replace(old_wt, new_wt)

# 5. Price Section
old_pricel = """<span className="text-[8px] font-bold text-slate-400">سعر القطعة ({priceMode === 'retail' ? 'مفرد' : 'جملة'})</span>"""
new_pricel = """<span className="text-[9px] font-bold text-slate-400 mb-0.5">سعر ({priceMode === 'retail' ? 'مفرد' : 'جملة'})</span>"""
content = content.replace(old_pricel, new_pricel)

old_carl = """<span className="text-[8px] font-bold text-slate-400">سعر الكارتون</span>"""
new_carl = """<span className="text-[9px] font-bold text-slate-400 mb-0.5">الكارتون</span>"""
content = content.replace(old_carl, new_carl)

old_pricev = """<span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-[10px] sm:text-xs">
                          {priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)}
                        </span>"""
new_pricev = """<span className="font-black text-emerald-600 dark:text-emerald-400 text-xs sm:text-[15px]">
                          {priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)}
                        </span>"""
content = content.replace(old_pricev, new_pricev)

old_carv = """<span className="font-extrabold text-indigo-600 dark:text-indigo-400 text-[10px] sm:text-xs">
                        {(priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)) * (Number(prod.cartonQuantity) || 1)}
                      </span>"""
new_carv = """<span className="font-black text-indigo-600 dark:text-indigo-400 text-xs sm:text-[15px]">
                        {(priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)) * (Number(prod.cartonQuantity) || 1)}
                      </span>"""
content = content.replace(old_carv, new_carv)

# Also padding for the stat grids
old_gap = """<div className={`grid grid-cols-2 gap-2 p-1 rounded-md border ${"""
new_gap = """<div className={`grid grid-cols-2 gap-2 p-1.5 rounded-md border ${"""
content = content.replace(old_gap, new_gap)

# Product Card Container paddings
old_card_container = """className={`relative flex flex-col gap-2 p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${"""
new_card_container = """className={`relative flex flex-col gap-2 p-2 sm:p-3 rounded-lg border shadow-sm transition-all hover:shadow-md cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${"""
content = content.replace(old_card_container, new_card_container)
# Let's handle the existing string which was probably `relative flex flex-col p-1.5 sm:p-2 ...`
old_card_container2 = """className={`relative flex flex-col p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${"""
new_card_container2 = """className={`relative flex flex-col gap-1 p-2 sm:p-2.5 rounded-lg border shadow-sm transition-all hover:shadow-md cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${"""
content = content.replace(old_card_container2, new_card_container2)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

