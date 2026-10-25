import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add state for priceMode and edit states
old_states = """  // Inline editing state for Admin
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editCartonQuantity, setEditCartonQuantity] = useState<string | number>('');
  const [editPieceWeightKg, setEditPieceWeightKg] = useState<string | number>('');"""

new_states = """  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');

  // Inline editing state for Admin
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editCartonQuantity, setEditCartonQuantity] = useState<string | number>('');
  const [editPieceWeightKg, setEditPieceWeightKg] = useState<string | number>('');
  const [editRetailPrice, setEditRetailPrice] = useState<string | number>('');
  const [editWholesalePrice, setEditWholesalePrice] = useState<string | number>('');"""
content = content.replace(old_states, new_states)

# 2. Update startEditing
old_startEditing = """  const startEditing = (p: ProductItem) => {
    if (!isAdmin) return;
    setEditingId(p.id);
    setEditCategoryName(p.categoryName);
    setEditProductCode(p.productCode);
    setEditProductName(p.productName);
    setEditCartonQuantity(p.cartonQuantity);
    setEditPieceWeightKg(p.pieceWeightKg.toString());
  };"""

new_startEditing = """  const startEditing = (p: ProductItem) => {
    if (!isAdmin) return;
    setEditingId(p.id);
    setEditCategoryName(p.categoryName);
    setEditProductCode(p.productCode);
    setEditProductName(p.productName);
    setEditCartonQuantity(p.cartonQuantity);
    setEditPieceWeightKg(p.pieceWeightKg.toString());
    setEditRetailPrice(p.retailPrice?.toString() || '0');
    setEditWholesalePrice(p.wholesalePrice?.toString() || '0');
  };"""
content = content.replace(old_startEditing, new_startEditing)

# 3. Update saveEditing
old_saveEditing = """  const saveEditing = (id: string) => {
    updateProduct(id, {
      categoryName: editCategoryName.trim() || 'عام',
      productCode: editProductCode.trim() || 'PRD-000',
      productName: editProductName.trim() || 'منتج جديد',
      cartonQuantity: Number(editCartonQuantity) || 12,
      pieceWeightKg: Number(editPieceWeightKg) || 0,
    });
    setEditingId(null);
  };"""

new_saveEditing = """  const saveEditing = (id: string) => {
    updateProduct(id, {
      categoryName: editCategoryName.trim() || 'عام',
      productCode: editProductCode.trim() || 'PRD-000',
      productName: editProductName.trim() || 'منتج جديد',
      cartonQuantity: Number(editCartonQuantity) || 12,
      pieceWeightKg: Number(editPieceWeightKg) || 0,
      retailPrice: Number(editRetailPrice) || 0,
      wholesalePrice: Number(editWholesalePrice) || 0,
    });
    setEditingId(null);
  };"""
content = content.replace(old_saveEditing, new_saveEditing)

# 4. Shrink category buttons and Add price mode buttons
old_search_filter = """      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم المنتج أو الكود..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pr-10 pl-4 py-2.5 rounded-xl border text-[10px] sm:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>
        {categoriesList.length > 2 && (
          <div className="flex items-center gap-2 w-full flex-wrap pb-1 sm:pb-0">
            <span className="text-sm font-bold shrink-0">الصنف:</span>
            {categoriesList.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-4 py-2 rounded-lg text-sm sm:text-base font-bold transition-all ${"""

new_search_filter = """      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              type="text"
              placeholder="بحث باسم المنتج أو الكود..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pr-10 pl-4 py-2.5 rounded-xl border text-[10px] sm:text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                isDarkMode
                  ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                  : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
              }`}
            />
          </div>
          
          <div className="flex items-center gap-1 shrink-0 p-1 rounded-lg bg-slate-200 dark:bg-slate-800">
            <button
              onClick={() => setPriceMode('retail')}
              className={`px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-bold transition-all ${priceMode === 'retail' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}
            >
              مفرد
            </button>
            <button
              onClick={() => setPriceMode('wholesale')}
              className={`px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-bold transition-all ${priceMode === 'wholesale' ? 'bg-white dark:bg-slate-700 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}
            >
              جملة
            </button>
          </div>
        </div>
        
        {categoriesList.length > 2 && (
          <div className="flex items-center gap-2 w-full flex-wrap pb-1 sm:pb-0">
            <span className="text-[10px] sm:text-xs font-bold shrink-0">الصنف:</span>
            {categoriesList.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${"""
content = content.replace(old_search_filter, new_search_filter)


# 5. Add price stats to product card
old_card_stats = """                      )}
                    </div>
                  </div>
                </div>
              );
            })}"""

new_card_stats = """                      )}
                    </div>
                  </div>
                  
                  {/* Price Section */}
                  <div className={`mt-2 p-1.5 rounded-md border flex justify-between items-center ${
                    isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[8px] font-bold text-slate-400">سعر القطعة</span>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={priceMode === 'retail' ? editRetailPrice : editWholesalePrice}
                          onChange={(e) => priceMode === 'retail' ? setEditRetailPrice(e.target.value) : setEditWholesalePrice(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-16 px-1 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                        />
                      ) : (
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-[10px] sm:text-xs">
                          {priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center justify-center text-center border-r border-slate-200 dark:border-slate-700 pr-2">
                      <span className="text-[8px] font-bold text-slate-400">سعر الكارتون</span>
                      <span className="font-extrabold text-indigo-600 dark:text-indigo-400 text-[10px] sm:text-xs">
                        {(priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)) * (Number(prod.cartonQuantity) || 1)}
                      </span>
                    </div>
                  </div>

                </div>
              );
            })}"""
content = content.replace(old_card_stats, new_card_stats)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("ProductsScreen patched successfully")
