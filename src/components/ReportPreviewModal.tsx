import React from 'react';
import { X } from 'lucide-react';

interface ReportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
  isProcessing: boolean;
}

export const ReportPreviewModal: React.FC<ReportPreviewModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  children,
  isProcessing
}) => {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-slate-900 w-[1000px] h-[1000px] p-[30px] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-800">
          <h3 className="font-black text-lg text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500"><X size={20}/></button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1 bg-slate-100 dark:bg-slate-950 flex justify-center items-center">
          {children}
        </div>
        
        <div className="p-4 border-t flex justify-end gap-3 bg-slate-50 dark:bg-slate-800">
          <button 
            onClick={onClose} 
            disabled={isProcessing}
            className="px-6 py-2.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-all disabled:opacity-50"
          >
            إلغاء
          </button>
          <button 
            onClick={onConfirm} 
            disabled={isProcessing}
            className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-black hover:bg-emerald-500 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {isProcessing ? 'جاري التحميل...' : 'تأكيد وتحميل'}
          </button>
        </div>
      </div>
    </div>
  );
};
