import re

with open('src/components/AdminScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("formatWithCommas(parseFloat(totalCompanySalesWeight.toFixed(1)))", "formatWithCommas(parseFloat(totalCompanySalesWeight.toFixed(1)), true)")
content = content.replace("formatWithCommas(parseFloat(totalCompanyTargetWeight.toFixed(1)))", "formatWithCommas(parseFloat(totalCompanyTargetWeight.toFixed(1)), true)")
content = content.replace("formatWithCommas(parseFloat(delSalesToday.toFixed(1)))", "formatWithCommas(parseFloat(delSalesToday.toFixed(1)), true)")
content = content.replace("formatWithCommas(parseFloat(prod.totalWeightKg.toFixed(1)))", "formatWithCommas(parseFloat(prod.totalWeightKg.toFixed(1)), true)")
content = content.replace("formatWithCommas(parseFloat(totalSalesWeight.toFixed(2)))", "formatWithCommas(parseFloat(totalSalesWeight.toFixed(2)), true)")
content = content.replace("formatWithCommas(product.pieceWeightKg)", "formatWithCommas(product.pieceWeightKg, true)")

with open('src/components/AdminScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
