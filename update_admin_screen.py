import re

with open('src/components/AdminScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("import { parseArabicDigits, parseArabicNumber } from '../utils/numberUtils';",
                          "import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';\nimport { PullToRefresh } from './PullToRefresh';")

content = content.replace("updateSalesEntry,", "updateSalesEntry,\n    syncData,")

content = content.replace("{totalSalesWeight.toFixed(2)}", "{formatWithCommas(parseFloat(totalSalesWeight.toFixed(2)))}")
content = content.replace("{totalSalesQuantity}", "{formatWithCommas(totalSalesQuantity)}")
content = content.replace("{product.pieceWeightKg}", "{formatWithCommas(product.pieceWeightKg)}")

# Wrap with PullToRefresh
old_return = """  return (
    <div className="space-y-6 pb-20">"""
new_return = """  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="space-y-6 pb-20">"""
content = content.replace(old_return, new_return)
content = content.replace("</div>\n    </div>\n  );\n}", "</div>\n    </div>\n    </PullToRefresh>\n  );\n}")

with open('src/components/AdminScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
