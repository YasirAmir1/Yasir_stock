import re
with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_search_bar_start = "      {/* Search and Filter Bar */}"
new_customer_ui = """      {/* Quick Add Customer Info Box */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 sm:p-4 shadow-sm relative">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
            إضافة سريعة للمنتجات
          </h3>
          <button
            onClick={handleSaveQuickAdd}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-xs sm:text-sm shadow-md transition-colors"
          >
            حفظ المنتجات المختارة
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الزبون (إلزامي)</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="اسم الزبون..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">كود الزبون</label>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="الكود..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">العنوان</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="العنوان..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Search and Filter Bar */}"""
content = content.replace(old_search_bar_start, new_customer_ui)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
