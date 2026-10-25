import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_search = """      {/* Search and Filter Bar */}
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
          <div className="flex items-center gap-1.5 w-full flex-wrap pb-1 sm:pb-0">
            <span className="text-[9px] sm:text-[10px] font-bold shrink-0">الصنف:</span>
            {categoriesList.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-2 py-1 rounded text-[8px] sm:text-[9px] font-extrabold transition-all ${
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
      <div className="flex flex-col gap-3">
        {/* Search on a single line */}
        <div className="relative w-full">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم المنتج أو الكود..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pr-10 pl-4 py-3 rounded-xl border text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex items-center justify-center sm:justify-start w-full sm:w-auto bg-slate-200 dark:bg-slate-800 p-1.5 rounded-lg">
            <button
              onClick={() => setPriceMode('retail')}
              className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-xs sm:text-sm font-black transition-all ${priceMode === 'retail' ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
            >
              مفرد
            </button>
            <button
              onClick={() => setPriceMode('wholesale')}
              className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-xs sm:text-sm font-black transition-all ${priceMode === 'wholesale' ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
            >
              جملة
            </button>
          </div>
          
          {categoriesList.length > 2 && (
            <div className="flex items-center gap-1.5 w-full flex-wrap pb-1 sm:pb-0">
              <span className="text-[9px] sm:text-[10px] font-bold shrink-0">الصنف:</span>
              {categoriesList.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategoryFilter(cat)}
                  className={`px-2 py-1 rounded text-[8px] sm:text-[9px] font-extrabold transition-all ${
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
        </div>
      </div>"""

content = content.replace(old_search, new_search)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
