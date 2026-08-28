import re

with open('src/components/ReportsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_banner = """      {/* 12-Hour Reset Info Banner */}
      <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 text-white shadow-md space-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm text-emerald-200">
            نظام التقرير اليومي وتصفير الـ 12 ساعة
          </h3>
        </div>

        <p className="text-xs text-slate-300 font-semibold leading-relaxed">
          * يتم تنظيف وحذف سجلات المبيعات تلقائياً بعد مرور 12 ساعة، مع المحافظة التامة على قيم التاركت والأهداف التي حددها الأدمن.
        </p>
      </div>"""

new_banner = """      {/* Daily Reset Info Banner */}
      <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-4 text-white shadow-md space-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm text-emerald-200">
            نظام التقرير والمبيعات اليومية
          </h3>
        </div>

        <p className="text-xs text-slate-300 font-semibold leading-relaxed">
          * يتم تصفير المبيعات وبدء يوم عمل جديد تلقائياً في الساعة 12:00 منتصف الليل (12:00 AM) من كل يوم، مع المحافظة التامة على قيم التاركت التراكمي.
        </p>
      </div>"""

if old_banner in content:
    content = content.replace(old_banner, new_banner)
else:
    print("Warning: old banner not found precisely. Falling back to regex.")
    content = re.sub(r'نظام التقرير اليومي وتصفير الـ 12 ساعة', 'نظام التقرير والمبيعات اليومية', content)
    content = re.sub(r'يتم تنظيف وحذف سجلات المبيعات تلقائياً بعد مرور 12 ساعة', 'يتم تصفير المبيعات وبدء يوم عمل جديد تلقائياً في الساعة 12:00 منتصف الليل (12:00 AM) من كل يوم', content)

with open('src/components/ReportsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
