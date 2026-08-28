import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_code = """        // Save to Firestore using a batch
        try {
          const batch = writeBatch(db);
          parsedProducts.forEach((prod) => {
            const docRef = doc(db, 'products_catalog', prod.id);
            batch.set(docRef, prod);
          });
          await batch.commit();
        } catch (err) {
          console.error('Error saving imported products to Firestore:', err);
        }"""

new_code = """        // Save to Firestore using chunked batches to handle >500 limits, and clear old products first
        try {
          // 1. Delete old products
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

          // 2. Add new products in chunks
          let insertBatch = writeBatch(db);
          let insertCount = 0;
          for (const prod of parsedProducts) {
            const docRef = doc(db, 'products_catalog', prod.id);
            insertBatch.set(docRef, prod);
            insertCount++;
            if (insertCount === 450) {
              await insertBatch.commit();
              insertBatch = writeBatch(db);
              insertCount = 0;
            }
          }
          if (insertCount > 0) {
            await insertBatch.commit();
          }
        } catch (err) {
          console.error('Error saving imported products to Firestore:', err);
        }"""

content = content.replace(old_code, new_code)

# Let's also fix the onSnapshot so it clears local list if empty
old_snap = """      (snapshot) => {
        if (!snapshot.empty) {
          const products: ProductItem[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as ProductItem;
            if (data) {
              products.push({ ...data, id: docSnap.id });
            }
          });
          setProductsList(products);
          try {
            localStorage.setItem('app_products_catalog', JSON.stringify(products));
          } catch {}
        }
      },"""

new_snap = """      (snapshot) => {
        const products: ProductItem[] = [];
        if (!snapshot.empty) {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as ProductItem;
            if (data) {
              products.push({ ...data, id: docSnap.id });
            }
          });
        } else {
          // If empty, fall back to default
          DEFAULT_PRODUCTS_LIST.forEach(p => products.push(p));
        }
        
        setProductsList(products);
        try {
          localStorage.setItem('app_products_catalog', JSON.stringify(products));
        } catch {}
      },"""

content = content.replace(old_snap, new_snap)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
