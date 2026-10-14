import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

bad_block = """  const filteredSavedEntries = safeSavedEntries.filter(
    (e) => !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm))
  );

  const groupedEntries: Record<string, typeof safeSavedEntries> = {};
  filteredSavedEntries.forEach((entry) => {
    const customer = entry.customerName || 'بدون اسم زبون';
    if (!groupedEntries[customer]) {
      groupedEntries[customer] = [];
    }
    groupedEntries[customer].push(entry);
  });

  return ("""

content = content.replace(bad_block, "  return (")

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
