import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update import products
old_import = """        const productCode = row['كود المنتج'] || row['الكود'] || row['Code'] || `PRD-${100 + index}`;
        const pieceWeightKg = row['وزن القطعة الواحدة'] || row['وزن القطعة'] || row['الوزن'] || row['Piece Weight'] || row['Weight'] || 0.2;

        return {
          id: `prod_${Date.now()}_${index}`,
          productName: String(productName),
          cartonQuantity: Number(cartonQuantity) || cartonQuantity,
          categoryName: String(categoryName),
          productCode: String(productCode),
          pieceWeightKg: Number(pieceWeightKg) || pieceWeightKg,
        };"""

new_import = """        const productCode = row['كود المنتج'] || row['الكود'] || row['Code'] || `PRD-${100 + index}`;
        const pieceWeightKg = row['وزن القطعة الواحدة'] || row['وزن القطعة'] || row['الوزن'] || row['Piece Weight'] || row['Weight'] || 0.2;
        const retailPrice = row['سعر المفرد'] || row['سعر القطعة مفرد'] || row['Retail Price'] || 0;
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
content = content.replace(old_import, new_import)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Context updated")
