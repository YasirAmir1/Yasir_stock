import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix saveSalesEntries cutoff logic
old_save_sales = """    const cutoff = Date.now() - TWELVE_HOURS_MS;
    const prevWeight = salesEntries
      .filter(
        (e) =>
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.dateString === selectedDate &&
          e.timestamp >= cutoff
      )"""
new_save_sales = """    const prevWeight = salesEntries
      .filter(
        (e) =>
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.dateString === selectedDate
      )"""
content = content.replace(old_save_sales, new_save_sales)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

