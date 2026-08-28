import re
with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_useSales = "const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage } = useSales();"
new_useSales = "const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage, saveSalesEntries, activeDelegateName } = useSales();"
content = content.replace(old_useSales, new_useSales)

old_state = "const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');"
new_state = """const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>('retail');
  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({});
  const [addingQuantityId, setAddingQuantityId] = useState<string | null>(null);"""
content = content.replace(old_state, new_state)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
