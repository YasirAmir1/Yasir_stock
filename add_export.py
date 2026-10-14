import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add Download icon
if "Download" not in content:
    content = content.replace("from 'lucide-react';", ", Download } from 'lucide-react';")

export_fn = """
  const handleExportCSV = () => {
    if (safeSavedEntries.length === 0) {
      window.alert('لا توجد بيانات لتصديرها');
      return;
    }
    
    const headers = ['تاريخ الادخال', 'المندوب', 'اسم الزبون', 'اسم المنتج', 'الصنف', 'عدد القطع', 'وزن القطعة (كجم)', 'الوزن الكلي (كجم)'];
    const rows = safeSavedEntries.map(entry => [
      entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-GB') : '',
      entry.delegateName || 'غير محدد',
      entry.customerName || 'بدون اسم زبون',
      entry.productName,
      entry.categoryName,
      entry.quantity.toString(),
      entry.pieceWeightKg.toString(),
      entry.totalWeightKg.toString()
    ]);
    
    const csvContent = "\\uFEFF" + [headers.join(','), ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sales_entries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
"""

content = content.replace("  const filteredSavedEntries =", export_fn + "\n  const filteredSavedEntries =")

old_ui = """          <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
            سجل المبيعات المحفوظة اليوم ({safeSavedEntries.length})
          </h3>"""

new_ui = """          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
              سجل المبيعات المحفوظة اليوم ({safeSavedEntries.length})
            </h3>
            {currentUser?.isAdmin && safeSavedEntries.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="px-2.5 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg border border-blue-300 flex items-center gap-1.5 text-xs font-bold transition-colors shadow-sm cursor-pointer"
                title="تصدير البيانات كملف CSV"
              >
                <Download className="w-4 h-4" />
                <span>تصدير CSV</span>
              </button>
            )}
          </div>"""

content = content.replace(old_ui, new_ui)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Export functionality added successfully")
