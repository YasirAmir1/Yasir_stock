import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_filter = """  const filteredProducts = useMemo(() => {
    return productsList.filter(p => {
      const matchSearch = 
        p.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchCat = selectedCategoryFilter === 'الكل' || p.categoryName === selectedCategoryFilter;
      return matchSearch && matchCat;
    });
  }, [productsList, searchTerm, selectedCategoryFilter]);"""

new_filter = """  const filteredProducts = useMemo(() => {
    return productsList.filter(p => {
      // Hide unavailable products for non-admins
      if (!isAdmin && p.isAvailable === false) return false;

      const matchSearch = 
        p.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchCat = selectedCategoryFilter === 'الكل' || p.categoryName === selectedCategoryFilter;
      return matchSearch && matchCat;
    });
  }, [productsList, searchTerm, selectedCategoryFilter, isAdmin]);"""

content = content.replace(old_filter, new_filter)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
