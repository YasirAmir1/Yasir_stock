import re
with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_use = "const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage, saveSalesEntries, activeDelegateName } = useSales();"
new_use = "const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage, saveSalesEntries } = useSales();"
content = content.replace(old_use, new_use)

old_delegate = "delegateName: activeDelegateName || 'عام',"
new_delegate = "delegateName: (currentUser?.isAdmin ? 'الأدمن' : currentUser?.name) || 'عام',"
content = content.replace(old_delegate, new_delegate)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
