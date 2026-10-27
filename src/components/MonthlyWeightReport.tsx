import React, { useState, useMemo, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { logFirestoreErrorGracefully, isGlobalQuotaExceeded, safeOnSnapshot } from '../lib/firestoreUtils';
import { formatWithCommas } from '../utils/numberUtils';
import { Share2, Download, MessageCircle, FileText, Calendar, X } from 'lucide-react';
import { isExcludedReportDelegate } from '../context/SalesContext';
import html2canvas from 'html2canvas-pro';

// --- Types ---
export interface MonthlyItemTarget {
  id?: string;
  categoryName: string;
  delegateName: string;
  monthlyTarget: number;
  monthlySales: number;
  updatedAt?: string;
  updatedBy?: string;
}

// --- Utils ---
const normalizeText = (str: string) => {
  if (!str) return '';
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/١/g, '1')
    .replace(/٢/g, '2')
    .replace(/٣/g, '3')
    .replace(/٤/g, '4')
    .replace(/٥/g, '5')
    .replace(/٦/g, '6')
    .replace(/٧/g, '7')
    .replace(/٨/g, '8')
    .replace(/٩/g, '9')
    .replace(/٠/g, '0')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
};

const sanitizeModernColors = (clonedDoc: Document, fallback: string = '#0f172a') => {
  const links = clonedDoc.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => link.remove());

  try {
    for (let i = 0; i < clonedDoc.styleSheets.length; i++) {
      try {
        const sheet = clonedDoc.styleSheets[i];
        const rules = sheet.cssRules;
        if (rules) {
          for (let j = rules.length - 1; j >= 0; j--) {
            const ruleText = rules[j].cssText;
            if (ruleText && (ruleText.includes('oklch') || ruleText.includes('oklab') || ruleText.includes('color('))) {
              sheet.deleteRule(j);
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  const styleTags = clonedDoc.querySelectorAll('style');
  styleTags.forEach(style => {
    if (style.textContent) {
      style.textContent = style.textContent
        .replace(/oklch\([^)]+\)/g, fallback)
        .replace(/oklab\([^)]+\)/g, fallback)
        .replace(/color\([^)]+\)/g, fallback);
    }
  });

  const allEls = clonedDoc.querySelectorAll('*');
  allEls.forEach((el: any) => {
    if (el.style) {
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style[i];
        const val = el.style.getPropertyValue(prop);
        if (val && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
          el.style.setProperty(prop, fallback);
        }
      }
    }
  });
};

export const MonthlyWeightReport: React.FC<{
  salesEntries: any[],
  delegatesList: string[],
  monthlyItemTargets: MonthlyItemTarget[],
  delegateTargets: any[],
  currentUser: any,
  isDarkMode: boolean
}> = ({ salesEntries, delegatesList, monthlyItemTargets, delegateTargets, currentUser, isDarkMode }) => {
  const [totalMonthlyWorkingDays, setTotalMonthlyWorkingDays] = useState<number>(26);
  const [showDaysModal, setShowDaysModal] = useState(false);
  const [tempDays, setTempDays] = useState<string>('26');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isSavingDays, setIsSavingDays] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const isAdmin = Boolean(currentUser?.isAdmin || currentUser?.role === 'admin' || currentUser?.name === 'الأدمن');

  useEffect(() => {
    if (isGlobalQuotaExceeded()) return;
    const unsub = safeOnSnapshot(
      doc(db, 'app_settings', 'total_monthly_working_days_config'),
      (snap: any) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.days !== undefined) {
            setTotalMonthlyWorkingDays(Number(data.days) || 26);
            setTempDays(String(data.days));
          }
        }
      },
      (err: any) => logFirestoreErrorGracefully(err, 'total_monthly_working_days_config'),
      'total_monthly_working_days_report'
    );
    return () => unsub();
  }, []);

  const handleSaveWorkingDays = async () => {
    try {
      setIsSavingDays(true);
      const val = parseInt(tempDays, 10) || 26;
      await setDoc(doc(db, 'app_settings', 'total_monthly_working_days_config'), {
        days: val,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name || 'الأدمن'
      }, { merge: true });
      setTotalMonthlyWorkingDays(val);
      setShowDaysModal(false);
      setActionFeedback("تم حفظ أيام العمل بنجاح");
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingDays(false);
    }
  };

  const monthlyWeightReportData = useMemo(() => {
    const TARGET_DELEGATES = ["خلدون جمال", "ناجي خلف", "محمد جاسم", "بكر بدران", "فيصل فؤاد", "صباح فرحان"];
    return TARGET_DELEGATES.map(del => {
      const delCategories = monthlyItemTargets.filter(t => normalizeText(t.delegateName) === normalizeText(del));
      const delDailyTargets = delegateTargets.filter(t => normalizeText(t.delegateName) === normalizeText(del));
      const dailyTarget = delDailyTargets.reduce((sum, t) => sum + (Number(t.dailyTargetWeightKg) || 0), 0);
      
      // Calculate monthly target based on daily target * working days
      const monthlyTarget = dailyTarget * totalMonthlyWorkingDays;
      
      const monthlySalesFromTargets = delCategories.reduce((sum, t) => sum + (Number(t.monthlySales) || 0), 0);

      const currentMonthPrefix = new Date().toISOString().substring(0, 7);
      const delMonthSalesEntries = (salesEntries || []).filter(e => 
        (normalizeText(e.delegateName || '') === normalizeText(del)) &&
        (e.dateString || '').startsWith(currentMonthPrefix) &&
        !isExcludedReportDelegate(e.delegateName)
      );
      const monthlySalesFromEntries = delMonthSalesEntries.reduce((sum, e) => sum + (Number(e.totalWeightKg) || 0), 0);
      const monthlySales = monthlySalesFromTargets > 0 ? monthlySalesFromTargets : monthlySalesFromEntries;

      const pct = monthlyTarget > 0 ? (monthlySales / monthlyTarget) * 100 : 0;
      const remaining = monthlyTarget > monthlySales ? monthlyTarget - monthlySales : 0;

      return {
        delegateName: del,
        dailyTarget,
        monthlyTarget,
        monthlySales,
        pct,
        remaining
      };
    });
  }, [monthlyItemTargets, delegateTargets, totalMonthlyWorkingDays, salesEntries]);

  const handleExport = async (actionType: 'share' | 'download' = 'download') => {
    if (!reportRef.current) return;
    try {
      setIsExporting(true);
      await document.fonts.ready;
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 300));

      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        onclone: (clonedDoc) => {
          sanitizeModernColors(clonedDoc, '#0f172a');
          const noExportEls = clonedDoc.querySelectorAll('.no-export');
          noExportEls.forEach(el => (el as HTMLElement).style.display = 'none');
          
          const container = clonedDoc.getElementById('monthly-weight-report-container');
          if (container) {
            container.style.width = '1000px';
            container.style.maxWidth = 'none';
            container.style.padding = '30px';
            container.style.backgroundColor = '#0f172a';
            container.style.borderRadius = '16px';
            container.style.border = '2px solid #1e293b';
            
            const table = container.querySelector('table');
            if (table) {
              table.style.width = '100%';
              table.style.borderCollapse = 'collapse';
              table.style.backgroundColor = '#1e293b';
              table.style.color = 'white';
              
              const ths = table.querySelectorAll('th');
              ths.forEach(th => {
                th.style.backgroundColor = '#0f172a';
                th.style.color = '#94a3b8';
                th.style.padding = '12px';
                th.style.fontSize = '18px';
                th.style.border = '1px solid #334155';
              });
              
              const tds = table.querySelectorAll('td');
              tds.forEach(td => {
                td.style.padding = '12px';
                td.style.fontSize = '17px';
                td.style.border = '1px solid #334155';
                td.style.color = 'white';
              });
            }
          }
        }
      });

      const todayStr = new Date().toISOString().split('T')[0];
      const fileName = `التقرير-الشهري-للوزن-${todayStr}.jpg`;

      if (actionType === 'share') {
        let shared = false;
        if (navigator.share && navigator.canShare) {
          const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.95));
          if (blob) {
            const file = new File([blob], fileName, { type: 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: 'التقرير الشهري للوزن',
                text: `تقرير الأهداف الشهرية للوزن بتاريخ ${todayStr}`,
              });
              shared = true;
            }
          }
        }
        if (!shared) {
          const link = document.createElement('a');
          link.download = fileName;
          link.href = canvas.toDataURL('image/jpeg', 0.95);
          link.click();
          setActionFeedback("تم تحميل الصورة بنجاح");
        }
      } else {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        setActionFeedback("تم تحميل الصورة بنجاح ✅");
      }
      setTimeout(() => setActionFeedback(null), 3000);
    } catch (error) {
      console.error(error);
      setActionFeedback("حدث خطأ أثناء التصدير");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div 
      ref={reportRef}
      id="monthly-weight-report-container"
      className="bg-slate-900 rounded-xl sm:rounded-2xl border border-slate-800 p-2 sm:p-5 text-white shadow-xl space-y-3 w-full"
    >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 bg-slate-800/90 p-2 sm:p-4 rounded-xl border border-slate-700 shadow-md">
            <div>
                <h3 className="font-black text-white text-sm sm:text-lg flex items-center gap-1.5 sm:gap-2">
                    <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
                    <span>📈 التقرير الشهري للوزن</span>
                    <span className="text-[10px] sm:text-xs font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/30">
                        متابعة الأهداف
                    </span>
                </h3>
                <p className="text-[10px] sm:text-xs text-slate-300 font-bold mt-0.5 sm:mt-1">
                    مقارنة التاركت الشهري بالمبيعات الشهرية لحد الآن لكل مندوب
                </p>
            </div>
            
            <div className="no-export w-full sm:w-auto flex items-center justify-end gap-2 flex-wrap">
                {actionFeedback && (
                  <span className="text-[10px] text-emerald-400 font-bold animate-pulse">
                    {actionFeedback}
                  </span>
                )}
                
                {isAdmin && (
                  <button 
                    onClick={() => setShowDaysModal(true)}
                    className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-amber-400 border border-amber-500/30 font-black py-1.5 px-3 rounded-xl shadow-lg transition-all text-xs cursor-pointer active:scale-95"
                    title="تعديل عدد أيام العمل في الشهر"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>أيام العمل: {totalMonthlyWorkingDays}</span>
                  </button>
                )}

                <button 
                  onClick={() => handleExport('share')}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black py-1.5 px-3 rounded-xl shadow-lg transition-all text-xs cursor-pointer active:scale-95 disabled:opacity-60"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>مشاركة</span>
                </button>
                <button 
                  onClick={() => handleExport('download')}
                  disabled={isExporting}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-1.5 px-3 rounded-xl shadow-lg transition-all text-xs cursor-pointer active:scale-95 disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تحميل</span>
                </button>
            </div>
        </div>

        <div className="overflow-x-auto w-full">
            <table className="w-full min-w-[600px] text-xs sm:text-sm font-bold text-center border-collapse border border-slate-700/50">
                <thead>
                    <tr className="border-b border-slate-700 text-slate-400 bg-slate-950 font-black">
                        <th className="p-2 sm:p-3 border border-slate-700/50">اسم المندوب</th>
                        <th className="p-2 sm:p-3 border border-slate-700/50">التاركت اليومي</th>
                        <th className="p-2 sm:p-3 border border-slate-700/50">التاركت الشهري</th>
                        <th className="p-2 sm:p-3 border border-slate-700/50">المبيعات الشهرية</th>
                        <th className="p-2 sm:p-3 border border-slate-700/50">الإنجاز</th>
                        <th className="p-2 sm:p-3 border border-slate-700/50">المتبقي</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                    {monthlyWeightReportData.map((row) => (
                        <tr 
                            key={row.delegateName} 
                            className={`transition-colors ${isAdmin && row.pct < 50 ? 'bg-rose-500/10 border-r-4 border-r-rose-500/50' : 'hover:bg-slate-800/30'}`}
                        >
                            <td className="p-2 sm:p-3 font-black text-white border border-slate-700/30 bg-slate-800/20">{row.delegateName}</td>
                            <td className="p-2 sm:p-3 font-mono border border-slate-700/30 text-slate-300">{formatWithCommas(Math.round(row.dailyTarget), true)}</td>
                            <td className="p-2 sm:p-3 font-mono text-amber-400 border border-slate-700/30 font-black">{formatWithCommas(Math.round(row.monthlyTarget), true)}</td>
                            <td className="p-2 sm:p-3 font-mono text-emerald-400 border border-slate-700/30 font-black">{formatWithCommas(Math.round(row.monthlySales), true)}</td>
                            <td className={`p-2 sm:p-3 font-black border border-slate-700/30 ${row.pct < 30 ? 'text-rose-500 animate-pulse bg-rose-500/5' : row.pct >= 100 ? 'text-emerald-500 bg-emerald-500/5' : 'text-amber-500'}`}>
                                {row.pct.toFixed(1)}%
                            </td>
                            <td className="p-2 sm:p-3 font-mono text-slate-400 border border-slate-700/30">{formatWithCommas(Math.round(row.remaining), true)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* Modal for Admin to Edit Total Monthly Working Days */}
        {showDaysModal && isAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`w-full max-w-sm p-5 sm:p-6 rounded-2xl shadow-2xl border ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`} dir="rtl">
              <div className="flex items-center justify-between mb-4 pb-2 border-b">
                <h3 className="font-black text-base sm:text-lg text-amber-500 flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  <span>تعديل أيام العمل في الشهر</span>
                </h3>
                <button type="button" onClick={() => setShowDaysModal(false)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <p className="text-xs text-slate-400 font-bold">
                  أدخل عدد أيام العمل الكلية لهذا الشهر ليتم حساب التاركت الشهري بناءً على (التاركت اليومي × عدد الأيام).
                </p>
                
                <div className="flex items-center gap-3 p-3 rounded-xl border bg-slate-800/40 border-slate-700">
                  <span className="font-black text-sm text-white shrink-0">عدد الأيام:</span>
                  <input
                    type="number"
                    value={tempDays}
                    onChange={(e) => setTempDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border bg-slate-800 border-slate-700 text-white font-mono text-lg focus:outline-none focus:border-amber-500 text-center"
                    placeholder="26"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 mt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowDaysModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-black text-xs cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={isSavingDays}
                  onClick={handleSaveWorkingDays}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg cursor-pointer transition-all disabled:opacity-50"
                >
                  {isSavingDays ? 'جاري الحفظ...' : 'حفظ التعديل'}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};
