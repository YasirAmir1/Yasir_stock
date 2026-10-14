import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add syncData to SalesContextType
content = content.replace("deleteAllProducts: () => Promise<void>;", "deleteAllProducts: () => Promise<void>;\n  syncData: () => Promise<void>;")

# Expose syncData
content = content.replace("deleteAllProducts,", "deleteAllProducts,\n        syncData: syncPendingEntries,")

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
