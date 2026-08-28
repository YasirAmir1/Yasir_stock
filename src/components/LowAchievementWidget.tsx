import React, { useState } from 'react';
import {
  Award,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
} from 'lucide-react';
import { useSales } from '../context/SalesContext';

export const LowAchievementWidget: React.FC = () => {
  const { isDarkMode, categoryReports } = useSales();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Products with achievement percentage < 50%
  const lowAchievementProducts = categoryReports.filter(
    (item) => item.percentage < 50 && item.dailyTargetWeightKg > 0
  );

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-4 mt-2 mb-1 dir-rtl">
      {/* Products < 50% Dropdown Button */}
      <div
        className={`rounded-2xl border transition-all duration-300 shadow-md ${
          isDarkMode
            ? 'bg-slate-900/90 border-emerald-500/30 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className={`w-full px-3 sm:px-4 py-2.5 flex items-center justify-between font-bold text-xs sm:text-sm rounded-2xl transition-colors ${
            isDropdownOpen
              ? isDarkMode
                ? 'bg-amber-950/80 text-amber-300'
                : 'bg-amber-50 text-amber-900'
              : isDarkMode
              ? 'hover:bg-slate-800/80 text-slate-100'
              : 'hover:bg-slate-50 text-slate-900'
          }`}
        >
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-hidden">
            <div
              className={`p-1 sm:p-1.5 rounded-lg shrink-0 ${
                lowAchievementProducts.length > 0
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              {lowAchievementProducts.length > 0 ? (
                <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
              ) : (
                <Award className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </div>
            <span className="font-extrabold truncate text-xs sm:text-sm">
              منتجات دون 50%
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-xs">
            {lowAchievementProducts.length > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-[11px] shadow-sm">
                {lowAchievementProducts.length}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px] border border-emerald-500/30">
                ممتاز!
              </span>
            )}
            {isDropdownOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>
      </div>

      {/* Expanded Products < 50% Dropdown Card */}
      {isDropdownOpen && (
        <div
          className={`mt-2 p-4 rounded-2xl border shadow-xl space-y-3 animate-in fade-in duration-200 ${
            isDarkMode
              ? 'bg-slate-900 border-amber-500/40 text-white'
              : 'bg-white border-amber-500/50 text-slate-900'
          }`}
        >
          <div className="flex items-center justify-between border-b pb-2 border-slate-700/40">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className={`font-extrabold text-sm ${isDarkMode ? 'text-amber-300' : 'text-amber-900'}`}>
                المنتجات التي لم تحقق 50% من نسبة الإنجاز
              </h3>
            </div>
            <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {lowAchievementProducts.length} منتجات متبقية
            </span>
          </div>

          {lowAchievementProducts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto p-1">
              {lowAchievementProducts.map((item) => {
                const halfwayKg = item.dailyTargetWeightKg * 0.5;
                const missingTo50Kg = Math.max(0, halfwayKg - item.dailySalesWeightKg);

                return (
                  <div
                    key={item.categoryName}
                    className={`p-3 rounded-xl border space-y-1.5 transition-all ${
                      isDarkMode
                        ? 'bg-slate-950/80 border-slate-800 hover:border-amber-500/40'
                        : 'bg-amber-50/60 border-amber-200 hover:border-amber-400 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span className={`font-black text-sm sm:text-base ${isDarkMode ? 'text-white' : 'text-slate-950'}`}>
                        {item.categoryName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[11px] font-black">
                        {item.percentage.toFixed(0)}%
                      </span>
                    </div>

                    <div className={`w-full rounded-full h-2.5 overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
                      <div
                        className="bg-amber-500 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                      ></div>
                    </div>

                    <div className={`flex items-center justify-between text-[11px] font-extrabold pt-0.5 ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>
                      <span>
                        المبيعات: <strong className={isDarkMode ? 'text-amber-300' : 'text-amber-900'}>{item.dailySalesWeightKg.toFixed(1)}</strong> / {item.dailyTargetWeightKg.toFixed(1)} كجم
                      </span>
                      <span className={isDarkMode ? 'text-amber-400' : 'text-amber-900'}>
                        متبقي للـ50%: {missingTo50Kg.toFixed(1)} كجم
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="font-extrabold text-sm text-emerald-200">
                ممتاز جداً! جميع المنتجات حققت 50% فأكثر من التاركت المخصص لها 🎉
              </p>
              <p className="text-xs text-slate-300">
                لا يوجد أي صنف حالياً يحتاج لمتابعة لنسبة 50%.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
