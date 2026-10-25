import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sure we only replace the final return (
old_return = "  return ("
new_return = """  const filteredSavedEntries = safeSavedEntries.filter(
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

# Replace from the right so we only get the very last one
if content.count(old_return) == 1:
    content = content.replace(old_return, new_return)
else:
    # If multiple, just replace the last one
    idx = content.rfind(old_return)
    content = content[:idx] + new_return + content[idx + len(old_return):]

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
