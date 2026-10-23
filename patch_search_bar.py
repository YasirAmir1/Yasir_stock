import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_search = """      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
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
                className={`px-4 py-2 rounded-lg text-sm sm:text-base font-bold transition-all ${
                  selectedCategoryFilter === cat
                    ? 'bg-emerald-600 text-white shadow-md'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>"""

new_search = """      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
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
                className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
                  selectedCategoryFilter === cat
                    ? 'bg-emerald-600 text-white shadow-md'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>"""

content = content.replace(old_search, new_search)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
