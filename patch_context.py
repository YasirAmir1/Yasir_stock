import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Update deleteSalesEntry
old_delete = """  const deleteSalesEntry = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'sales_entries', id));
      setUserMessage('تم حذف المنتج المسجل بنجاح');"""
new_delete = """  const deleteSalesEntry = async (id: string) => {
    setSalesEntries(prev => prev.filter(e => e.id !== id));
    try {
      await deleteDoc(doc(db, 'sales_entries', id));
      setUserMessage('تم حذف المنتج المسجل بنجاح');"""
content = content.replace(old_delete, new_delete)

# Update updateSalesEntry
old_update = """  const updateSalesEntry = async (id: string, updatedData: Partial<SalesEntry>) => {
    try {
      const entryRef = doc(db, 'sales_entries', id);
      await setDoc(entryRef, updatedData, { merge: true });
      setUserMessage('تم تعديل بيانات المنتج المسجل بنجاح');"""
new_update = """  const updateSalesEntry = async (id: string, updatedData: Partial<SalesEntry>) => {
    setSalesEntries(prev => prev.map(e => e.id === id ? { ...e, ...updatedData } : e));
    try {
      const entryRef = doc(db, 'sales_entries', id);
      await setDoc(entryRef, updatedData, { merge: true });
      setUserMessage('تم تعديل بيانات المنتج المسجل بنجاح');"""
content = content.replace(old_update, new_update)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched Context!")
