import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State changes
old_states = """  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');

  // Inline editing state for Admin
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editCartonQuantity, setEditCartonQuantity] = useState<string | number>('');
  const [editPieceWeightKg, setEditPieceWeightKg] = useState<string | number>('');
  const [editRetailPrice, setEditRetailPrice] = useState<string | number>('');
  const [editWholesalePrice, setEditWholesalePrice] = useState<string | number>('');"""

new_states = """  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Inline editing state for Admin
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editCartonQuantity, setEditCartonQuantity] = useState<string | number>('');
  const [editPieceWeightKg, setEditPieceWeightKg] = useState<string | number>('');
  const [editRetailPrice, setEditRetailPrice] = useState<string | number>('');
  const [editWholesalePrice, setEditWholesalePrice] = useState<string | number>('');
  const [editStockCartons, setEditStockCartons] = useState<string | number>('');
  const [editImageUrl, setEditImageUrl] = useState('');"""
content = content.replace(old_states, new_states)

# 2. startEditing
old_startEditing = """    setEditCartonQuantity(p.cartonQuantity);
    setEditPieceWeightKg(p.pieceWeightKg.toString());
    setEditRetailPrice(p.retailPrice?.toString() || '0');
    setEditWholesalePrice(p.wholesalePrice?.toString() || '0');
  };"""

new_startEditing = """    setEditCartonQuantity(p.cartonQuantity);
    setEditPieceWeightKg(p.pieceWeightKg.toString());
    setEditRetailPrice(p.retailPrice?.toString() || '0');
    setEditWholesalePrice(p.wholesalePrice?.toString() || '0');
    setEditStockCartons(p.stockCartons?.toString() || '0');
    setEditImageUrl(p.imageUrl || '');
    setExpandedId(p.id); // Expand when editing
  };"""
content = content.replace(old_startEditing, new_startEditing)

# 3. saveEditing
old_saveEditing = """      cartonQuantity: Number(editCartonQuantity) || 12,
      pieceWeightKg: Number(editPieceWeightKg) || 0,
      retailPrice: Number(editRetailPrice) || 0,
      wholesalePrice: Number(editWholesalePrice) || 0,
    });
    setEditingId(null);
  };"""

new_saveEditing = """      cartonQuantity: Number(editCartonQuantity) || 12,
      pieceWeightKg: Number(editPieceWeightKg) || 0,
      retailPrice: Number(editRetailPrice) || 0,
      wholesalePrice: Number(editWholesalePrice) || 0,
      stockCartons: Number(editStockCartons) || 0,
      imageUrl: editImageUrl.trim(),
    });
    setEditingId(null);
  };"""
content = content.replace(old_saveEditing, new_saveEditing)

# 4. Card Container
old_card_container = """                <div
                  key={prod.id || idx}
                  className={`relative flex flex-col p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md ${
                    isDarkMode 
                      ? 'bg-slate-900 border-slate-800 hover:border-emerald-500/30' 
                      : 'bg-white border-slate-200 hover:border-emerald-400/50'
                  }`}
                >"""

new_card_container = """                <div
                  key={prod.id || idx}
                  onClick={() => !isEditing && setExpandedId(expandedId === prod.id ? null : prod.id)}
                  className={`relative flex flex-col p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md cursor-pointer ${
                    isDarkMode 
                      ? 'bg-slate-900 border-slate-800 hover:border-emerald-500/30' 
                      : 'bg-white border-slate-200 hover:border-emerald-400/50'
                  } ${expandedId === prod.id ? (isDarkMode ? 'ring-1 ring-emerald-500/50' : 'ring-1 ring-emerald-400') : ''}`}
                >"""
content = content.replace(old_card_container, new_card_container)

# 5. Product Code & Stock Cartons
old_product_code = """                  {/* Product Code */}
                  <div className="text-right">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editProductCode}
                        onChange={(e) => setEditProductCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full px-2 py-1  text-xs rounded border border-emerald-500 bg-slate-800 text-white font-mono text-right"
                        placeholder="كود المنتج"
                      />
                    ) : (
                      <div className="font-mono text-[8px] font-bold text-cyan-600 dark:text-cyan-400 opacity-80">
                        {prod.productCode}
                      </div>
                    )}
                  </div>"""

new_product_code = """                  {/* Product Code & Stock Cartons */}
                  <div className="text-right flex items-center justify-between">
                    <div>
                      {isEditing ? (
                        <div className="flex flex-col gap-1">
                          <label className="text-[8px] text-slate-400">عدد كارتون بالمخزن:</label>
                          <input
                            type="number"
                            value={editStockCartons}
                            onChange={(e) => setEditStockCartons(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-16 px-1 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                            placeholder="المخزن"
                          />
                        </div>
                      ) : (
                        prod.stockCartons !== undefined && prod.stockCartons > 0 && (
                          <div className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 px-1.5 py-0.5 rounded text-[8px] font-bold text-indigo-600 dark:text-indigo-400" title="عدد كارتون بالمخزن">
                            <Package className="w-2.5 h-2.5" />
                            {prod.stockCartons} بالمخزن
                          </div>
                        )
                      )}
                    </div>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editProductCode}
                        onChange={(e) => setEditProductCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-20 px-2 py-1 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-mono text-right"
                        placeholder="كود المنتج"
                      />
                    ) : (
                      <div className="font-mono text-[8px] font-bold text-cyan-600 dark:text-cyan-400 opacity-80">
                        {prod.productCode}
                      </div>
                    )}
                  </div>"""
content = content.replace(old_product_code, new_product_code)


# 6. Prices
old_price = """                  {/* Price Section */}
                  <div className={`mt-2 p-1.5 rounded-md border flex justify-between items-center ${
                    isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[8px] font-bold text-slate-400">سعر القطعة</span>"""

new_price = """                  {/* Price Section */}
                  <div className={`mt-2 p-1.5 rounded-md border flex justify-between items-center ${
                    isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[8px] font-bold text-slate-400">سعر القطعة ({priceMode === 'retail' ? 'مفرد' : 'جملة'})</span>"""
content = content.replace(old_price, new_price)

# 7. Add Expanded Section
old_end_card = """                  </div>

                </div>
              );
            })}"""

new_end_card = """                  </div>
                  
                  {/* Expanded Details Section */}
                  {(expandedId === prod.id || isEditing) && (
                    <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-2 animate-in slide-in-from-top-1 fade-in duration-200`}>
                      {isEditing ? (
                        <div className="flex flex-col gap-1 w-full">
                          <label className="text-[8px] font-bold text-slate-400">رابط صورة المنتج</label>
                          <input
                            type="text"
                            value={editImageUrl}
                            onChange={(e) => setEditImageUrl(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full px-2 py-1 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white text-right"
                            placeholder="http://..."
                          />
                        </div>
                      ) : (
                        prod.imageUrl && (
                          <div className="w-full flex justify-center">
                            <img 
                              src={prod.imageUrl} 
                              alt={prod.productName} 
                              className="w-24 h-24 object-contain rounded-md shadow-sm border border-slate-200 dark:border-slate-700 bg-white"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          </div>
                        )
                      )}
                    </div>
                  )}

                </div>
              );
            })}"""
content = content.replace(old_end_card, new_end_card)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Card modifications applied")
