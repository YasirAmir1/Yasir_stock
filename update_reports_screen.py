import re

with open('src/components/ReportsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add formatWithCommas import
content = content.replace("import { Download, Filter, TrendingUp, Calendar, ChevronDown, Check, Trash2, Printer } from 'lucide-react';",
                          "import { Download, Filter, TrendingUp, Calendar, ChevronDown, Check, Trash2, Printer } from 'lucide-react';\nimport { formatWithCommas } from '../utils/numberUtils';\nimport { PullToRefresh } from './PullToRefresh';")

content = content.replace("updateSalesEntry,", "updateSalesEntry,\n    syncData,")

content = content.replace("{totalWeight.toFixed(2)}", "{formatWithCommas(parseFloat(totalWeight.toFixed(2)))}")
content = content.replace("{totalQuantity}", "{formatWithCommas(totalQuantity)}")
content = content.replace("{val.weight.toFixed(2)}", "{formatWithCommas(parseFloat(val.weight.toFixed(2)))}")
content = content.replace("{val.quantity}", "{formatWithCommas(val.quantity)}")
content = content.replace("{entry.quantity}", "{formatWithCommas(entry.quantity)}")
content = content.replace("{entry.pieceWeightKg}", "{formatWithCommas(entry.pieceWeightKg)}")
content = content.replace("{entry.totalWeightKg.toFixed(2)}", "{formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)))}")

# Wrap with PullToRefresh
old_return = """  return (
    <div className="space-y-4 max-w-full overflow-hidden pb-20">"""
new_return = """  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="space-y-4 max-w-full overflow-hidden pb-20">"""
content = content.replace(old_return, new_return)
content = content.replace("</div>\n    </div>\n  );\n}", "</div>\n    </div>\n    </PullToRefresh>\n  );\n}")

with open('src/components/ReportsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
