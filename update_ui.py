import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update imports
content = content.replace(
    'import { Package, Upload, Search, Edit3, Check, X, Shield, Plus } from \'lucide-react\';',
    'import { Package, Upload, Search, Edit3, Check, X, Shield, Plus, Trash2 } from \'lucide-react\';'
)

# 2. Add deleteAllProducts and deleteProduct from useSales
content = content.replace(
    'const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, isDarkMode, setUserMessage } = useSales();',
    'const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage } = useSales();'
)

# 3. Add Delete All button next to Add Product
old_buttons = """            <button
              onClick={() => {
                addProduct();
                setSelectedCategoryFilter('الكل');
                setSearchTerm('');
              }}
              className="cursor-pointer px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
            >
              <Plus className="w-3 h-3" />
              <span>إضافة منتج</span>
            </button>"""

new_buttons = """            <button
              onClick={() => {
                if(window.confirm('هل أنت متأكد من حذف جميع المنتجات؟ لا يمكن التراجع عن هذا الإجراء.')){
                  deleteAllProducts();
                }
              }}
              className="cursor-pointer px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
              title="حذف جميع المنتجات"
            >
              <Trash2 className="w-3 h-3" />
              <span>حذف الكل</span>
            </button>
            <button
              onClick={() => {
                addProduct();
                setSelectedCategoryFilter('الكل');
                setSearchTerm('');
              }}
              className="cursor-pointer px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
            >
              <Plus className="w-3 h-3" />
              <span>إضافة منتج</span>
            </button>"""

content = content.replace(old_buttons, new_buttons)

# 4. Add Delete button in the product card
old_card_actions = """                        ) : (
                          <button
                            onClick={() => startEditing(prod)}
                            title="تعديل تفاصيل المنتج"
                            className={`p-1 rounded-lg transition-all ${
                              isDarkMode
                                ? 'bg-slate-800 hover:bg-emerald-950 text-slate-400 hover:text-emerald-400 border border-slate-700'
                                : 'bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border border-slate-300'
                            }`}
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        )}"""

new_card_actions = """                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if(window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
                                  deleteProduct(prod.id);
                                }
                              }}
                              title="حذف المنتج"
                              className={`p-1 rounded-lg transition-all ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700'
                                  : 'bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-300'
                              }`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => startEditing(prod)}
                              title="تعديل تفاصيل المنتج"
                              className={`p-1 rounded-lg transition-all ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-emerald-950 text-slate-400 hover:text-emerald-400 border border-slate-700'
                                  : 'bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border border-slate-300'
                              }`}
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        )}"""

content = content.replace(old_card_actions, new_card_actions)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
