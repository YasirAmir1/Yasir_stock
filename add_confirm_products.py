import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("onClick={() => deleteProduct(prod.id)}", "onClick={() => { if(window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) deleteProduct(prod.id) }}")
content = content.replace("onClick={() => {\n                if (productsList.length > 0) {\n                  deleteAllProducts();\n                }\n              }}", "onClick={() => { if (productsList.length > 0 && window.confirm('هل أنت متأكد من حذف جميع المنتجات؟')) deleteAllProducts(); }}")
content = content.replace("onClick={() => deleteAllProducts()}", "onClick={() => { if(window.confirm('هل أنت متأكد من حذف جميع المنتجات؟')) deleteAllProducts(); }}")

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
