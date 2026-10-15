import React from 'react';
import { FileText, BarChart2, Package, Award, MapPin, History, RotateCcw, Layers, Shield } from 'lucide-react';
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
  const tabs = isSauceUser
    ? [
        { id: 'products', label: 'المنتجات', icon: Package },
        { id: 'item_tracking', label: 'الأصناف', icon: Layers },
      ]
    : [
        { id: 'entry', label: 'الفواتير', icon: FileText },
        ...(isAdmin ? [{ id: 'old_invoices', label: 'القديمة', icon: History }] : []),
        { id: 'routes', label: 'المسارات', icon: MapPin },
        { id: 'reports', label: 'التقارير', icon: BarChart2 },
        ...(canAccessItemTracking ? [{ id: 'item_tracking', label: 'الأصناف', icon: Layers }] : []),
        { id: 'evaluations', label: 'التقييمات', icon: Award },
        { id: 'products', label: 'المنتجات', icon: Package },
        { id: 'returns', label: 'المرتجعات', icon: RotateCcw },
        ...(isAdmin ? [{ id: 'admin', label: 'الإدارة', icon: Shield }] : []),
      ];

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <div className="flex justify-around items-center py-2 pb-3 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'products' && setShowQuickAdd) setShowQuickAdd(false);
                setActiveTab(tab.id as AppTab);
              }}
              className={`flex flex-col items-center justify-center p-1 text-[11px] font-black transition-all shrink-0 min-w-[50px] ${isActive ? (isDarkMode ? 'text-emerald-400 scale-105' : 'text-emerald-700 scale-105') : (isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900')}`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

