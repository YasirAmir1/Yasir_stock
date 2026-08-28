import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add calculation before return
calc_code = """  const customersPerDelegate: Record<string, Set<string>> = {};
  safeSavedEntries.forEach((entry) => {
    const delegate = entry.delegateName || 'غير محدد';
    const customer = entry.customerName || 'بدون اسم زبون';
    if (!customersPerDelegate[delegate]) {
      customersPerDelegate[delegate] = new Set();
    }
    customersPerDelegate[delegate].add(customer);
  });

  return (
"""

content = content.replace("  return (\n", calc_code)

# 2. Add JSX
old_summary_card = """        <div className="flex justify-center gap-3 pt-1">
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            إجمالي القطع: {formatWithCommas(totalSavedQuantity)} قطعة
          </span>
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            عدد السجلات: {formatWithCommas(safeSavedEntries.length)} منتج
          </span>
        </div>
      </div>"""

new_summary_card = """        <div className="flex justify-center gap-3 pt-1">
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            إجمالي القطع: {formatWithCommas(totalSavedQuantity)} قطعة
          </span>
          <span className="px-3 py-1 bg-emerald-100 border border-emerald-400 text-slate-900 font-bold text-xs rounded-full">
            عدد السجلات: {formatWithCommas(safeSavedEntries.length)} منتج
          </span>
        </div>
        {Object.keys(customersPerDelegate).length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 pt-3 mt-2 border-t border-emerald-200">
            {Object.entries(customersPerDelegate)
              .sort(([, a], [, b]) => b.size - a.size)
              .map(([delegate, customersSet]) => (
               <span key={delegate} className="px-3 py-1.5 bg-white border-2 border-emerald-500 text-slate-800 font-bold text-xs rounded-lg shadow-sm">
                 {delegate} : {customersSet.size}
               </span>
            ))}
          </div>
        )}
      </div>"""

content = content.replace(old_summary_card, new_summary_card)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
