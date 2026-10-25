import re

with open('src/types.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_product = """  stockCartons?: number;    // عدد الكارتون بالمخزن
  imageUrl?: string;        // صورة المنتج
}"""

new_product = """  stockCartons?: number;    // عدد الكارتون بالمخزن
  imageUrl?: string;        // صورة المنتج
  isAvailable?: boolean;    // حالة المنتج
}"""
content = content.replace(old_product, new_product)

with open('src/types.ts', 'w', encoding='utf-8') as f:
    f.write(content)
