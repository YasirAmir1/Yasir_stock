import React from 'react';
import { FileSpreadsheet, Lock, Check, Upload } from 'lucide-react';
import { formatWithCommas } from '../utils/numberUtils';

// You will need to import these or ensure they are available in AdditionalTargetScreen.tsx scope
// For this replacement, assume they are accessible
export const FamilyMilkTable: React.FC<{
  delegatesAnalysis: any[];
  isDarkMode: boolean;
  isAdmin: boolean;
  handleOpenConfigModal: (delName: string, tab?: 'milk' | 'willie') => void;
  downloadFamilyTemplate: () => void;
  handleFamilyMilkUpload: (file: File) => void;
  familyMilkUploadRef: React.RefObject<HTMLInputElement>;
  setLockedModalDelegateName: (name: string) => void;
  setShowLockedConditionModal: (show: boolean) => void;
}> = ({
  delegatesAnalysis,
  isDarkMode,
  isAdmin,
  handleOpenConfigModal,
  downloadFamilyTemplate,
  handleFamilyMilkUpload,
  familyMilkUploadRef,
  setLockedModalDelegateName,
  setShowLockedConditionModal
}) => {
  return (
    <div
      className={`p-4 rounded-3xl border shadow-xl space-y-4 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-3 border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-500" />
          <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
            ملخص أداء المندوبين وحوافز الحليب (كبير)
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            ref={familyMilkUploadRef}
            className="hidden"
            accept=".xlsx, .xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFamilyMilkUpload(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => familyMilkUploadRef.current?.click()}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            title="استيراد بيانات الحليب الكبير"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>استرداد إكسل</span>
          </button>
          <button
            onClick={downloadFamilyTemplate}
            className="px-3 py-1.5 rounded-xl bg-blue-700/90 hover:bg-blue-700 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            title="تنزيل نموذج ملف إكسل مخصص للحليب الكبير"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>نموذج إكسل</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md">
        <table className="w-full text-xs text-center border-collapse">
          <thead>
            <tr className="text-[#0a192f] font-black text-xs">
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">اسم المندوب</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">هدف الوزن (كغم)</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">مبيعات الوزن (كغم)</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">حافز الوزن</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">المحلات المستهدفة</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">المحلات المقبولة (≥ 11.5 كغم)</th>
              <th className="py-3.5 px-3 border border-blue-600/30 bg-[#2563eb] text-white font-black">حافز التغطية</th>
              <th className="py-3.5 px-3 border border-blue-700 bg-[#1e40af] text-white font-black text-sm">إجمالي الحافز</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-bold">
            {delegatesAnalysis.map((item) => (
              <tr key={item.delegateName + '_family'} className="hover:bg-blue-500/5 transition-colors">
                <td className="py-3 px-3 font-black text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
                  {item.delegateName}
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">{Math.round(item.familyTargetWeight)} كغم</td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-blue-700 dark:text-blue-300">
                  {Math.round(item.totalFamilyWeight)} كغم
                  <span className="block text-[10px] text-slate-400 font-normal">({item.familyWeightPct.toFixed(0)}%)</span>
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black">
                  {item.hasFamilySalesIncentiveUnlocked ? (
                    <span className="text-emerald-600 dark:text-emerald-400">32,500 د.ع ✅</span>
                  ) : !item.hasFamily100Coverage ? (
                    <button
                      onClick={() => {
                        setLockedModalDelegateName(item.delegateName);
                        setShowLockedConditionModal(true);
                      }}
                      className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 hover:bg-amber-200 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto shadow-2xs"
                      title="اضغط لتنبيه المندوب بشرط التغطية 100%"
                    >
                      <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span className="underline">مقفل بالشرط</span>
                    </button>
                  ) : (
                    <span className="text-slate-400">0 د.ع</span>
                  )}
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">{Math.round(item.familyTargetShops)} محل</td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-indigo-600 dark:text-indigo-400">
                  {Math.round(item.familyCoveredCount)} محل
                  <span className="block text-[10px] text-slate-400 font-normal">({item.familyCoveragePct.toFixed(0)}%)</span>
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-emerald-600 dark:text-emerald-400">
                  {formatWithCommas(item.familyCoverageIncentiveEarned || 0)} د.ع
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 bg-blue-500/10 font-black text-sm text-emerald-700 dark:text-emerald-300">
                  {formatWithCommas(item.familyTotalIncentive)} د.ع
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const SmallMilkTable: React.FC<{
  delegatesAnalysis: any[];
  isDarkMode: boolean;
  isAdmin: boolean;
  handleOpenConfigModal: (delName: string, tab?: 'milk' | 'willie') => void;
  downloadSmallTemplate: () => void;
  handleSmallMilkUpload: (file: File) => void;
  smallMilkUploadRef: React.RefObject<HTMLInputElement>;
  setLockedModalDelegateName: (name: string) => void;
  setShowLockedConditionModal: (show: boolean) => void;
}> = ({
  delegatesAnalysis,
  isDarkMode,
  isAdmin,
  handleOpenConfigModal,
  downloadSmallTemplate,
  handleSmallMilkUpload,
  smallMilkUploadRef,
  setLockedModalDelegateName,
  setShowLockedConditionModal
}) => {
  return (
    <div
      className={`p-4 rounded-3xl border shadow-xl space-y-4 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-3 border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
          <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
            ملخص أداء المندوبين وحوافز الحليب (صغير)
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            ref={smallMilkUploadRef}
            className="hidden"
            accept=".xlsx, .xls"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSmallMilkUpload(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => smallMilkUploadRef.current?.click()}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            title="استيراد بيانات الحليب الصغير"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>استرداد إكسل</span>
          </button>
          <button
            onClick={downloadSmallTemplate}
            className="px-3 py-1.5 rounded-xl bg-indigo-700/90 hover:bg-indigo-700 text-white text-xs font-black shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
            title="تنزيل نموذج ملف إكسل مخصص للحليب الصغير"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>نموذج إكسل</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md">
        <table className="w-full text-xs text-center border-collapse">
          <thead>
            <tr className="text-[#0a192f] font-black text-xs">
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">اسم المندوب</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">هدف الوزن (كغم)</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">مبيعات الوزن (كغم)</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">حافز الوزن</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">المحلات المستهدفة</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">المحلات المقبولة (≥ 7.5 كغم)</th>
              <th className="py-3.5 px-3 border border-indigo-600/30 bg-[#4f46e5] text-white font-black">حافز التغطية</th>
              <th className="py-3.5 px-3 border border-indigo-700 bg-[#3730a3] text-white font-black text-sm">إجمالي الحافز</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-bold">
            {delegatesAnalysis.map((item) => (
              <tr key={item.delegateName + '_small'} className="hover:bg-indigo-500/5 transition-colors">
                <td className="py-3 px-3 font-black text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
                  {item.delegateName}
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">{Math.round(item.smallTargetWeight)} كغم</td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-indigo-700 dark:text-indigo-300">
                  {Math.round(item.totalSmallWeight)} كغم
                  <span className="block text-[10px] text-slate-400 font-normal">({item.smallWeightPct.toFixed(0)}%)</span>
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black">
                  {item.hasSmallSalesIncentiveUnlocked ? (
                    <span className="text-emerald-600 dark:text-emerald-400">32,500 د.ع ✅</span>
                  ) : !item.hasSmall100Coverage ? (
                    <button
                      onClick={() => {
                        setLockedModalDelegateName(item.delegateName);
                        setShowLockedConditionModal(true);
                      }}
                      className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 hover:bg-amber-200 border border-amber-300 dark:border-amber-700 px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto shadow-2xs"
                      title="اضغط لتنبيه المندوب بشرط التغطية 100%"
                    >
                      <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      <span className="underline">مقفل بالشرط</span>
                    </button>
                  ) : (
                    <span className="text-slate-400">0 د.ع</span>
                  )}
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800">{Math.round(item.smallTargetShops)} محل</td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-indigo-600 dark:text-indigo-400">
                  {Math.round(item.smallCoveredCount)} محل
                  <span className="block text-[10px] text-slate-400 font-normal">({item.smallCoveragePct.toFixed(0)}%)</span>
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 font-black text-emerald-600 dark:text-emerald-400">
                  {formatWithCommas(item.smallCoverageIncentiveEarned || 0)} د.ع
                </td>
                <td className="py-3 px-3 border border-slate-200 dark:border-slate-800 bg-indigo-500/10 font-black text-sm text-emerald-700 dark:text-emerald-300">
                  {formatWithCommas(item.smallTotalIncentive)} د.ع
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

