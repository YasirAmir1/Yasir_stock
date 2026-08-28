import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add syncData to SalesContextType
old_interface = "  deleteProduct: (id: string) => void;\n}"
new_interface = "  deleteProduct: (id: string) => void;\n  syncData: () => Promise<void>;\n}"
content = content.replace(old_interface, new_interface)

# Expose syncPendingEntries as syncData
old_provider = "    deleteProduct,\n  };"
new_provider = "    deleteProduct,\n    syncData: syncPendingEntries,\n  };"
content = content.replace(old_provider, new_provider)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
