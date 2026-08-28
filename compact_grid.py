import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3',
    'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-1.5 sm:gap-2'
)

content = content.replace(
    'p-2.5 sm:p-2 rounded-lg',
    'p-1.5 sm:p-2 rounded-md'
)

content = content.replace('mb-2 gap-1', 'mb-1 gap-1')
content = content.replace('px-2.5 py-1', 'px-1.5 py-0.5')
content = content.replace('text-[9px]', 'text-[8px]')
content = content.replace('w-20 px-2 py-1', 'w-16 px-1 py-0.5')
content = content.replace('w-3.5 h-3.5', 'w-3 h-3')
content = content.replace('mb-1 text-right', 'text-right')
content = content.replace('mb-2 text-right flex-1', 'mb-1 text-right flex-1')
content = content.replace('p-2 rounded-lg', 'p-1 rounded-md')
content = content.replace('mb-1', '')
content = content.replace('text-xs sm:text-sm', 'text-[10px] sm:text-xs')
content = content.replace('text-[10px] text-xs', 'text-[10px]')
content = content.replace('w-12 px-1 py-0.5', 'w-10 px-0.5 py-0.5')

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
