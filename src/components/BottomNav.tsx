import React from 'react';
import { FileText, BarChart2, Package, Award, MapPin } from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDarkMode: boolean;
  setShowQuickAdd?: (show: boolean) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab, isDarkMode, setShowQuickAdd }) => {
  const tabs = [
    { id: 'entry', label: 'الفواتير', icon: FileText },
    { id: 'routes', label: 'المسارات', icon: MapPin },
    { id: 'reports', label: 'التقارير', icon: BarChart2 },
    { id: 'evaluations', label: 'التقييمات', icon: Award },
    { id: 'products', label: 'المنتجات', icon: Package },
  ];

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 sm:hidden border-t ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <div className="flex justify-around items-center py-2 pb-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === 'products' && setShowQuickAdd) setShowQuickAdd(false);
                setActiveTab(tab.id);
              }}
              className={`flex flex-col items-center justify-center p-1 text-[10px] font-bold transition-colors ${isActive ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-700') : (isDarkMode ? 'text-slate-500' : 'text-slate-500')}`}
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
