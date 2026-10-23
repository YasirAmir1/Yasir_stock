import re

with open('src/types.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_product = """export interface ProductItem {
  id: string;
  productName: string;      // اسم المنتج
  cartonQuantity: string | number; // عدد في الكارتون
  categoryName: string;     // صنف المنتج
  productCode: string;      // كود المنتج
  pieceWeightKg: string | number; // وزن القطعة الواحدة
  retailPrice?: number;     // سعر المفرد
  wholesalePrice?: number;  // سعر الجملة
}"""

new_product = """export interface ProductItem {
  id: string;
  productName: string;      // اسم المنتج
  cartonQuantity: string | number; // عدد في الكارتون
  categoryName: string;     // صنف المنتج
  productCode: string;      // كود المنتج
  pieceWeightKg: string | number; // وزن القطعة الواحدة
  retailPrice?: number;     // سعر المفرد
  wholesalePrice?: number;  // سعر الجملة
  stockCartons?: number;    // عدد الكارتون بالمخزن
  imageUrl?: string;        // صورة المنتج
}"""

content = content.replace(old_product, new_product)

with open('src/types.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Types updated")
