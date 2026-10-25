import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove delegate name from customer display
content = content.replace("<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `${customerName} (المندوب: ${entries[0]?.delegateName || 'غير محدد'})` : `الزبون: ${customerName}`}</span>", "<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>")
content = content.replace("<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>", "<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>")

# Also there's another place it might be:
content = content.replace("groupKey = `${entry.delegateName || 'مندوب غير محدد'} | الزبون: ${groupKey}`;", "groupKey = groupKey;")
# Wait, if we remove delegate from grouping it might group customers with the same name from different delegates into one. Let's not break grouping, just remove it from display.
# In EntryScreen.tsx around line 350:
# groupKey = `${entry.delegateName || 'مندوب غير محدد'} | الزبون: ${groupKey}`;
# This is how the key is formed.
# Then below in the JSX:
# {Object.entries(groupedEntries).map(([customerName, entries]) => (
# It renders customerName, which will contain the delegate name if it's the admin! Let's check the map.

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
