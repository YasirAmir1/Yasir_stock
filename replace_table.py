import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# We want to replace everything from {/* Products Table */} to the end of the div containing Table Footer Summary
start_marker = "{/* Products Table */}"
end_marker = "</div>\n    </div>\n  );\n};"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    exit(1)

new_content = """{/* Products Grid */}
      <div className="mt-4 pb-12">
        {filteredProducts.length === 0 ? (
          <div className={`rounded-2xl border shadow-xl flex flex-col items-center justify-center py-12 px-4 text-center ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <Package className="w-12 h-12 text-slate-500 opacity-40 mb-3" />
            <p className="font-bold text-slate-400">لا توجد منتجات مسجلة حالياً.</p>
            {isAdmin && (
              <p className="text-xs text-slate-500 mt-1">
                قم بإضافة منتج جديد أو رفع ملف إكسل.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((prod, idx) => {
              const isEditing = editingId === prod.id;
              return (
                <div
                  key={prod.id || idx}
                  className={`relative flex flex-col p-5 rounded-2xl border shadow-sm transition-all hover:shadow-md ${
                    isDarkMode 
                      ? 'bg-slate-900 border-slate-800 hover:border-emerald-500/30' 
                      : 'bg-white border-slate-200 hover:border-emerald-400/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3 gap-2">
                    {/* Category Label */}
                    <div className="shrink-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editCategoryName}
                          onChange={(e) => setEditCategoryName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-20 px-2 py-1 text-[11px] rounded border border-emerald-500 bg-slate-800 text-white font-bold text-center"
                          placeholder="الصنف"
                        />
                      ) : (
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          isDarkMode ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        }`}>
                          {prod.categoryName}
                        </span>
                      )}
                    </div>
                    {/* Actions */}
                    {isAdmin && (
                      <div className="shrink-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => saveEditing(prod.id)}
                              title="حفظ"
                              className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow save-btn transition-all"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={cancelEditing}
                              title="إلغاء"
                              className="p-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow transition-all"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditing(prod)}
                            title="تعديل تفاصيل المنتج"
                            className={`p-1.5 rounded-lg transition-all ${
                              isDarkMode
                                ? 'bg-slate-800 hover:bg-emerald-950 text-slate-400 hover:text-emerald-400 border border-slate-700'
                                : 'bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border border-slate-300'
                            }`}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Product Code */}
                  <div className="mb-1 text-right">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editProductCode}
                        onChange={(e) => setEditProductCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full px-2 py-1 mb-1 text-xs rounded border border-emerald-500 bg-slate-800 text-white font-mono text-right"
                        placeholder="كود المنتج"
                      />
                    ) : (
                      <div className="font-mono text-[10px] font-bold text-cyan-600 dark:text-cyan-400 opacity-80">
                        {prod.productCode}
                      </div>
                    )}
                  </div>

                  {/* Product Name */}
                  <div className="mb-4 text-right flex-1">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editProductName}
                        onChange={(e) => setEditProductName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full px-2 py-1.5 text-sm rounded border border-emerald-500 bg-slate-800 text-white font-bold text-right"
                        placeholder="اسم المنتج"
                      />
                    ) : (
                      <h3 className="font-bold text-sm sm:text-base leading-tight">
                        {prod.productName}
                      </h3>
                    )}
                  </div>

                  {/* Stats Grid */}
                  <div className={`grid grid-cols-2 gap-2 p-3 rounded-xl border ${
                    isDarkMode ? 'bg-slate-950/50 border-slate-800/80' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center border-l border-slate-200 dark:border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">العدد بالكرتون</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editCartonQuantity}
                          onChange={(e) => setEditCartonQuantity(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-16 px-1 py-1 text-xs rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                        />
                      ) : (
                        <span className="font-extrabold text-amber-600 dark:text-amber-400 text-sm">
                          {prod.cartonQuantity}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">وزن القطعة</span>
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={editPieceWeightKg}
                            onChange={(e) => setEditPieceWeightKg(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-16 px-1 py-1 text-xs rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                          />
                        </div>
                      ) : (
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-sm">
                          {Math.round(Number(prod.pieceWeightKg) * 1000)} غ
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Summary */}
        <div className={`mt-6 p-4 rounded-xl border flex items-center justify-between text-xs font-bold ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          <span>إجمالي المنتجات: <strong className="text-emerald-500">{filteredProducts.length}</strong></span>
          {isAdmin && (
            <span className="text-amber-500 dark:text-amber-400">✨ يمكنك تعديل أي منتج بالضغط على أيقونة التعديل</span>
          )}
        </div>
      </div>
"""

final_content = content[:start_idx] + new_content + "\n" + end_marker
with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(final_content)
print("Done")
