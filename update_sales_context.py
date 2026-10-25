import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add deleteProduct and deleteAllProducts to interface
if 'deleteProduct:' not in content:
    content = content.replace(
        'addProduct: () => Promise<void>;',
        'addProduct: () => Promise<void>;\n  deleteProduct: (id: string) => Promise<void>;\n  deleteAllProducts: () => Promise<void>;'
    )

# Add the functions implementation
delete_funcs = """
  const deleteProduct = async (id: string) => {
    setProductsList(prev => {
      const next = prev.filter(p => p.id !== id);
      try {
        localStorage.setItem('app_products_catalog', JSON.stringify(next));
      } catch {}
      return next;
    });
    try {
      const docRef = doc(db, 'products_catalog', id);
      await deleteDoc(docRef);
    } catch (err) {
      console.error('Error deleting product:', err);
    }
    setUserMessage('تم حذف المنتج بنجاح 🗑️✅');
  };

  const deleteAllProducts = async () => {
    setProductsList([]);
    try {
      localStorage.setItem('app_products_catalog', JSON.stringify([]));
    } catch {}
    
    try {
      const oldProductsSnap = await getDocs(collection(db, 'products_catalog'));
      if (!oldProductsSnap.empty) {
        let deleteBatch = writeBatch(db);
        let deleteCount = 0;
        for (const oldDoc of oldProductsSnap.docs) {
          deleteBatch.delete(oldDoc.ref);
          deleteCount++;
          if (deleteCount === 450) {
            await deleteBatch.commit();
            deleteBatch = writeBatch(db);
            deleteCount = 0;
          }
        }
        if (deleteCount > 0) {
          await deleteBatch.commit();
        }
      }
    } catch (err) {
      console.error('Error deleting all products:', err);
    }
    setUserMessage('تم حذف جميع المنتجات بنجاح 🗑️✅');
  };
"""

if 'const deleteProduct =' not in content:
    content = content.replace(
        'const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);',
        delete_funcs + '\n  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);'
    )

if 'deleteProduct,' not in content:
    content = content.replace(
        'addProduct,',
        'addProduct,\n        deleteProduct,\n        deleteAllProducts,'
    )

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
