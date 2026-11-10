import React, { useEffect, useRef } from 'react';
import { FileText, BarChart2, Package, MapPin, History, RotateCcw, Layers, Shield, AlertTriangle, FileSpreadsheet, Target } from 'lucide-react';
import { AppTab } from '../types';

interface BottomNavProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  isDarkMode: boolean;
  setShowQuickAdd?: (show: boolean) => void;
  isAdmin?: boolean;
  canAccessItemTracking?: boolean;
  isSauceUser?: boolean;
}

export const BottomNav: React.FC<BottomNavProps> = ({ 
  activeTab, 
  setActiveTab, 
  isDarkMode, 
  setShowQuickAdd, 
  isAdmin, 
  canAccessItemTracking,
  isSauceUser 
}) => {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeTab]);

  const tabs = isSauceUser
    ? [
        { id: 'products', label: 'المنتجات', icon: Package },
        { id: 'item_tracking', label: 'الأصناف', icon: Layers },
      ]
    : [
        { id: 'entry', label: 'الفواتير', icon: FileText },
        ...(isAdmin ? [{ id: 'old_invoices', label: 'القديمة', icon: History }] : []),
        { id: 'routes', label: 'المسارات', icon: MapPin },

        { id: 'report_11', label: 'التقرير (11)', icon: FileSpreadsheet },
        ...(!isSauceUser ? [{ id: 'additional_target', label: 'الهدف الإضافي', icon: Target }] : []),
        ...(canAccessItemTracking ? [{ id: 'item_tracking', label: 'الأصناف', icon: Layers }] : []),
        { id: 'products', label: 'المنتجات', icon: Package },
        { id: 'returns', label: 'المرتجعات', icon: RotateCcw },
        { id: 'qc', label: 'QC', icon: AlertTriangle },
        ...(isAdmin ? [{ id: 'admin', label: 'الإدارة', icon: Shield }] : []),
      ];

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t shadow-lg ${isDarkMode ? 'bg-[#020617] border-slate-800' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1.5 pb-2.5 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeTabRef : null}
              onClick={() => {
                if (tab.id === 'products' && setShowQuickAdd) setShowQuickAdd(false);
                setActiveTab(tab.id as AppTab);
              }}
              className={`flex flex-col items-center justify-center py-1 px-1.5 text-[9px] font-black transition-all shrink-0 min-w-[48px] rounded-xl border-2 ${
                isActive
                  ? isDarkMode
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 shadow-md scale-105'
                    : 'bg-emerald-50 border-emerald-700 text-emerald-900 shadow-md scale-105'
                  : isDarkMode
                  ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
              title={tab.label}
            >
              <Icon className={`w-4 h-4 mb-0.5 transition-transform ${isActive ? 'scale-110 text-emerald-600 dark:text-emerald-400' : ''}`} />
              <span className={`truncate w-full text-center leading-tight ${isActive ? 'font-black' : 'font-extrabold'}`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

