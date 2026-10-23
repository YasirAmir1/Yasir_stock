import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Change grid
content = content.replace(
    'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
    'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3'
)

# Change padding
content = content.replace(
    'className={`relative flex flex-col p-5 rounded-2xl border shadow-sm transition-all hover:shadow-md ${',
    'className={`relative flex flex-col p-2.5 sm:p-3 rounded-xl border shadow-sm transition-all hover:shadow-md ${'
)

# Adjust margins and inner paddings
content = content.replace('mb-3 gap-2', 'mb-2 gap-1.5')
content = content.replace('text-[11px]', 'text-[9px]')
content = content.replace('text-[10px]', 'text-[9px]')
content = content.replace('p-1.5', 'p-1')
content = content.replace('w-4 h-4', 'w-3.5 h-3.5')
content = content.replace('mb-4 text-right flex-1', 'mb-2 text-right flex-1')
content = content.replace('p-3 rounded-xl', 'p-2 rounded-lg')
content = content.replace('w-16 px-1 py-1', 'w-12 px-1 py-0.5 text-[10px]')
content = content.replace('font-extrabold text-amber-600 dark:text-amber-400 text-sm', 'font-extrabold text-amber-600 dark:text-amber-400 text-xs sm:text-sm')
content = content.replace('font-extrabold text-emerald-600 dark:text-emerald-400 text-sm', 'font-extrabold text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm')
content = content.replace('text-sm sm:text-base leading-tight', 'text-xs sm:text-sm leading-tight')

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
