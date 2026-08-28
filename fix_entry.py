import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add to destructuring
content = content.replace("    selectedDelegate,", "    selectedDelegate,\n    setSelectedDelegate,\n    delegatesList = [],")

# Update groupedEntries logic
old_logic = """  const groupedEntries: Record<string, typeof safeSavedEntries> = {};
  filteredSavedEntries.forEach((entry) => {
    const customer = entry.customerName || 'بدون اسم زبون';
    if (!groupedEntries[customer]) {
      groupedEntries[customer] = [];
    }
    groupedEntries[customer].push(entry);
  });"""

new_logic = """  const groupedEntries: Record<string, typeof safeSavedEntries> = {};
  filteredSavedEntries.forEach((entry) => {
    let groupKey = entry.customerName || 'بدون اسم زبون';
    if (currentUser?.isAdmin && selectedDelegate === 'الكل') {
      groupKey = `${entry.delegateName || 'مندوب غير محدد'} | الزبون: ${groupKey}`;
    }
    if (!groupedEntries[groupKey]) {
      groupedEntries[groupKey] = [];
    }
    groupedEntries[groupKey].push(entry);
  });"""

content = content.replace(old_logic, new_logic)

# Replace Zoboon Header logic
old_header = """<h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  الزبون: {customerName}
                </h4>"""

new_header = """<h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  {currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}
                </h4>"""

content = content.replace(old_header, new_header)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
