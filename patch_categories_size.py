import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_cats = """        {categoriesList.length > 2 && (
          <div className="flex items-center gap-2 w-full flex-wrap pb-1 sm:pb-0">
            <span className="text-[10px] sm:text-xs font-bold shrink-0">الصنف:</span>
            {categoriesList.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${"""

new_cats = """        {categoriesList.length > 2 && (
          <div className="flex items-center gap-1.5 w-full flex-wrap pb-1 sm:pb-0">
            <span className="text-[9px] sm:text-[10px] font-bold shrink-0">الصنف:</span>
            {categoriesList.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-2 py-1 rounded text-[8px] sm:text-[9px] font-extrabold transition-all ${"""

content = content.replace(old_cats, new_cats)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
