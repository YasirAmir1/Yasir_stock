import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const CollapsibleCard: React.FC<{ title: string; children: React.ReactNode; icon?: React.ReactNode }> = ({ title, children, icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-emerald-950 border border-emerald-800/80 rounded-xl overflow-hidden shadow-md">
      <button 
        className="w-full flex items-center justify-between p-4 font-black text-emerald-200 text-sm hover:bg-emerald-900/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
            {icon}
            {title}
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {isOpen && <div className="p-4 bg-slate-900/50 border-t border-emerald-800/80">{children}</div>}
    </div>
  );
};
