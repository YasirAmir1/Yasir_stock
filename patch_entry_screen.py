import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_sugg = """  const productSuggestions = useMemo(() => {
    return productsList.map(p => ({
      name: p.productName,
      category: p.categoryName,
      code: p.productCode,
      pieceWeightKg: Number(p.pieceWeightKg) || 0,
    }));
  }, [productsList]);"""

new_sugg = """  const productSuggestions = useMemo(() => {
    return productsList
      .filter(p => p.isAvailable !== false)
      .map(p => ({
        name: p.productName,
        category: p.categoryName,
        code: p.productCode,
        pieceWeightKg: Number(p.pieceWeightKg) || 0,
      }));
  }, [productsList]);"""

content = content.replace(old_sugg, new_sugg)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
