import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

state_addition = """  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
"""
if 'const [customerSearchTerm' not in content:
    content = content.replace(
        'const [customerAddress, setCustomerAddress] = useState(\'\');',
        'const [customerAddress, setCustomerAddress] = useState(\'\');\n' + state_addition
    )

old_list = """      {/* Saved Sales List Table */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
            سجل المبيعات المحفوظة اليوم ({safeSavedEntries.length})
          </h3>
          {safeSavedEntries.length > 0 && (
            <span className="text-xs font-bold text-emerald-700">
              الإجمالي: {totalSavedWeight.toFixed(2)} كجم
            </span>
          )}
        </div>

        {safeSavedEntries.length === 0 ? (
          <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl text-center text-xs text-slate-600 font-bold">
            لا توجد مبيعات محفوظة اليوم بعد. أدخل المنتجات في الجدول أعلاه واضغط 'حفظ الادخال'.
          </div>
        ) : (
          <div className="space-y-2">
            {safeSavedEntries"""

new_list = """      {/* Saved Sales List Table */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
            سجل المبيعات المحفوظة اليوم ({safeSavedEntries.length})
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="بحث باسم الزبون..."
              value={customerSearchTerm}
              onChange={(e) => setCustomerSearchTerm(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-64"
            />
            {safeSavedEntries.length > 0 && (
              <span className="text-xs font-bold text-emerald-700 shrink-0">
                الإجمالي: {totalSavedWeight.toFixed(2)} كجم
              </span>
            )}
          </div>
        </div>

        {safeSavedEntries.length === 0 ? (
          <div className="p-4 bg-slate-100 border border-slate-300 rounded-xl text-center text-xs text-slate-600 font-bold">
            لا توجد مبيعات محفوظة اليوم بعد. أدخل المنتجات في الجدول أعلاه واضغط 'حفظ الادخال'.
          </div>
        ) : (
          <div className="space-y-2">
            {safeSavedEntries.filter(e => !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm)))"""

content = content.replace(old_list, new_list)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
