import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const CollapsibleCard: React.FC<{ title: string; children: React.ReactNode; icon?: React.ReactNode }> = ({ title, children, icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-emerald-800/80 rounded-2xl overflow-hidden shadow-sm dark:shadow-md transition-colors">
      <button 
        type="button"
        className="w-full flex items-center justify-between p-4 font-black text-slate-800 dark:text-emerald-200 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
            {icon}
            <span>{title}</span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500 dark:text-emerald-400" /> : <ChevronDown className="w-4 h-4 text-slate-500 dark:text-emerald-400" />}
      </button>
      {isOpen && <div className="p-4 bg-slate-50/70 dark:bg-slate-950/60 border-t border-slate-200 dark:border-emerald-800/60 text-slate-700 dark:text-slate-200">{children}</div>}
    </div>
  );
};
