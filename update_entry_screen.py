import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add formatWithCommas import
content = content.replace("import { parseArabicDigits, parseArabicNumber } from '../utils/numberUtils';",
                          "import { parseArabicDigits, parseArabicNumber, formatWithCommas } from '../utils/numberUtils';\nimport { PullToRefresh } from './PullToRefresh';")

# Extract syncData
content = content.replace("updateSalesEntry,", "updateSalesEntry,\n    syncData,")

# Update customer name row (lines 621-631)
old_customer_row = """            {Object.entries(groupedEntries).map(([customerName, entries]) => (
              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-2 py-0.5 rounded-md border border-emerald-300 shadow-sm">
                    {entries.reduce((sum, e) => sum + (e.quantity || 0), 0)} قطع
                  </span>
                </h4>"""

new_customer_row = """            {Object.entries(groupedEntries).map(([customerName, entries]) => (
              <div key={customerName} className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                <h4 className="font-extrabold text-slate-800 text-sm mb-3 px-2 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{currentUser?.isAdmin && selectedDelegate === 'الكل' ? customerName : `الزبون: ${customerName}`}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-300 shadow-sm">
                      {formatWithCommas(entries.reduce((sum, e) => sum + (e.quantity || 0), 0))} قطع
                    </span>
                    <span className="bg-emerald-600 text-white text-[11px] font-black px-2.5 py-1 rounded-md border border-emerald-700 shadow-sm">
                      {formatWithCommas(parseFloat(entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0).toFixed(2)))} كجم
                    </span>
                  </div>
                </h4>"""

if old_customer_row in content:
    content = content.replace(old_customer_row, new_customer_row)
else:
    print("Warning: old_customer_row not found in EntryScreen.tsx")

# Format other numbers in EntryScreen:
# {totalSavedWeight.toFixed(2)} كجم -> {formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)))} كجم
content = content.replace("{totalSavedWeight.toFixed(2)} كجم", "{formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)))} كجم")
content = content.replace("{totalSavedQuantity} قطعة", "{formatWithCommas(totalSavedQuantity)} قطعة")
content = content.replace("{safeSavedEntries.length} منتج", "{formatWithCommas(safeSavedEntries.length)} منتج")

content = content.replace("`${rowKgVal.toFixed(2)} كجم`", "`${formatWithCommas(parseFloat(rowKgVal.toFixed(2)))} كجم`")

content = content.replace("{entry.quantity} قطعة", "{formatWithCommas(entry.quantity)} قطعة")
content = content.replace("{entry.pieceWeightKg} كجم", "{formatWithCommas(entry.pieceWeightKg)} كجم")
content = content.replace("{entry.totalWeightKg.toFixed(2)} كجم", "{formatWithCommas(parseFloat(entry.totalWeightKg.toFixed(2)))} كجم")


# Wrap with PullToRefresh
old_return = """  return (
    <div className="space-y-4 max-w-full overflow-hidden pb-20">"""
new_return = """  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="space-y-4 max-w-full overflow-hidden pb-20">"""
content = content.replace(old_return, new_return)
content = content.replace("</div>\n    </div>\n  );\n}", "</div>\n    </div>\n    </PullToRefresh>\n  );\n}")

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
