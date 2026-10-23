import re
with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_expanded = """                  {/* Expanded Details Section */}"""
new_expanded = """                  {/* Quick Add Section */}
                  {!isEditing && (
                    <div className="mt-2 flex items-center gap-2">
                      {addingQuantityId === prod.id ? (
                        <div className="flex items-center gap-1 w-full bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                          <input
                            type="number"
                            min="1"
                            placeholder="العدد"
                            value={selectedQuantities[prod.id] || ''}
                            onChange={(e) => handleUpdateQuantity(prod.id, e.target.value)}
                            className="flex-1 px-2 py-1 text-xs font-bold rounded-md border border-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddingQuantityId(null);
                            }}
                            className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : selectedQuantities[prod.id] ? (
                         <div 
                           className="flex items-center justify-between w-full bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-500 p-1.5 rounded-lg cursor-pointer"
                           onClick={(e) => {
                             e.stopPropagation();
                             setAddingQuantityId(prod.id);
                           }}
                         >
                           <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                             تم إضافة: {selectedQuantities[prod.id]} قطع
                           </span>
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               handleUpdateQuantity(prod.id, '');
                             }}
                             className="text-emerald-700 dark:text-emerald-400 hover:text-red-500 transition-colors"
                           >
                             <X className="w-3 h-3" />
                           </button>
                         </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddingQuantityId(prod.id);
                          }}
                          className="w-full py-1.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-900/30 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg flex items-center justify-center gap-1 transition-all"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Expanded Details Section */}"""
content = content.replace(old_expanded, new_expanded)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
