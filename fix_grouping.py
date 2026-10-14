import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the grouping key
content = content.replace("groupKey = groupKey;", "groupKey = `${entry.delegateName || 'مندوب غير محدد'} | الزبون: ${groupKey}`;")

# Fix the display in the header to strip out the delegate part
# The group key looks like: "مندوب 1 | الزبون: أحمد"
# We want to extract just "أحمد"
# So in the render: `customerName.split(' | الزبون: ').pop()` or similar.

old_header_text = "<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>"
new_header_text = "<span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? `الزبون: ${customerName.split(' | الزبون: ').pop()}` : `الزبون: ${customerName}`}</span>"

content = content.replace(old_header_text, new_header_text)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
