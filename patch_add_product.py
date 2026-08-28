import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_add = """    const newProduct: ProductItem = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      productName: 'منتج جديد',
      cartonQuantity: 1,
      categoryName: 'عام',
      productCode: `PRD-${Date.now().toString().slice(-4)}`,
      pieceWeightKg: 1,
    };"""

new_add = """    const newProduct: ProductItem = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      productName: 'منتج جديد',
      cartonQuantity: 1,
      categoryName: 'عام',
      productCode: `PRD-${Date.now().toString().slice(-4)}`,
      pieceWeightKg: 1,
      retailPrice: 0,
      wholesalePrice: 0,
    };"""

content = content.replace(old_add, new_add)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("addProduct updated")
