import re

with open('src/components/ReportsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("formatWithCommas(parseFloat(totalWeight.toFixed(2)))", "formatWithCommas(parseFloat(totalWeight.toFixed(2)), true)")
content = content.replace("formatWithCommas(parseFloat(val.weight.toFixed(2)))", "formatWithCommas(parseFloat(val.weight.toFixed(2)), true)")
content = content.replace("formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)))", "formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)), true)")

with open('src/components/ReportsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
