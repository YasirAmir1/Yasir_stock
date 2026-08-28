import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update import products
old_import = """        const retailPrice = row['سعر المفرد'] || row['سعر القطعة مفرد'] || row['Retail Price'] || 0;
        const wholesalePrice = row['سعر الجملة'] || row['سعر القطعة جملة'] || row['Wholesale Price'] || 0;

        return {
          id: `prod_${Date.now()}_${index}`,
          productName: String(productName),
          cartonQuantity: Number(cartonQuantity) || cartonQuantity,
          categoryName: String(categoryName),
          productCode: String(productCode),
          pieceWeightKg: Number(pieceWeightKg) || pieceWeightKg,
          retailPrice: Number(retailPrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
        };"""

new_import = """        const retailPrice = row['سعر المفرد'] || row['سعر القطعة مفرد'] || row['Retail Price'] || 0;
        const wholesalePrice = row['سعر الجملة'] || row['سعر القطعة جملة'] || row['Wholesale Price'] || 0;
        const stockCartons = row['المخزن'] || row['كارتون بالمخزن'] || row['عدد كارتون بالمخزن'] || row['Stock'] || 0;
        const imageUrl = row['صورة'] || row['صورة المنتج'] || row['Image'] || '';

        return {
          id: `prod_${Date.now()}_${index}`,
          productName: String(productName),
          cartonQuantity: Number(cartonQuantity) || cartonQuantity,
          categoryName: String(categoryName),
          productCode: String(productCode),
          pieceWeightKg: Number(pieceWeightKg) || pieceWeightKg,
          retailPrice: Number(retailPrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
          stockCartons: Number(stockCartons) || 0,
          imageUrl: String(imageUrl),
        };"""

content = content.replace(old_import, new_import)

old_add = """      pieceWeightKg: 1,
      retailPrice: 0,
      wholesalePrice: 0,
    };"""

new_add = """      pieceWeightKg: 1,
      retailPrice: 0,
      wholesalePrice: 0,
      stockCartons: 0,
      imageUrl: '',
    };"""

content = content.replace(old_add, new_add)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Context updated for stock and image")
