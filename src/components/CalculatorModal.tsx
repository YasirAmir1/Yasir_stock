import React, { useState } from 'react';
import {
  Calculator as CalcIcon,
  Delete,
  RefreshCw,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { useSales } from '../context/SalesContext';
import { parseArabicDigits } from '../utils/numberUtils';

interface CalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CalculatorModal: React.FC<CalculatorModalProps> = ({ isOpen, onClose }) => {
  const { isDarkMode } = useSales();

  // Calculator State
  const [display, setDisplay] = useState('0');
  const [expression, setExpression] = useState('');
  const [isCalculated, setIsCalculated] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleNum = (rawNum: string) => {
    const num = parseArabicDigits(rawNum);
    if (isCalculated) {
      setDisplay(num);
      setExpression('');
      setIsCalculated(false);
    } else {
      if (display === '0') {
        setDisplay(num);
      } else {
        setDisplay(display + num);
      }
    }
  };

  const handleOp = (op: string) => {
    setIsCalculated(false);
    const lastChar = display.slice(-1);
    if (['+', '-', '×', '÷'].includes(lastChar)) {
      setDisplay(display.slice(0, -1) + op);
    } else {
      setDisplay(display + op);
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setExpression('');
    setIsCalculated(false);
  };

  const handleDelete = () => {
    if (isCalculated) {
      handleClear();
      return;
    }
    if (display.length <= 1) {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handleDot = () => {
    if (isCalculated) {
      setDisplay('0.');
      setExpression('');
      setIsCalculated(false);
      return;
    }
    const parts = display.split(/[+\-×÷]/);
    const lastPart = parts[parts.length - 1];
    if (!lastPart.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleCalculate = () => {
    try {
      const sanitized = parseArabicDigits(display).replace(/×/g, '*').replace(/÷/g, '/');
      // eslint-disable-next-line no-eval
      const result = eval(sanitized);
      if (result !== undefined && !isNaN(result)) {
        const rounded = Math.round(result * 10000) / 10000;
        setExpression(display + ' =');
        setDisplay(String(rounded));
        setIsCalculated(true);
      }
    } catch (e) {
      setExpression('خطأ في العملية');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(display);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto dir-rtl"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-[95vw] sm:max-w-sm max-h-[92dvh] my-auto flex flex-col rounded-2xl sm:rounded-3xl border shadow-2xl p-3.5 sm:p-5 space-y-3 overflow-y-auto ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Sticky on scroll */}
        <div className="sticky top-0 z-20 bg-white dark:bg-slate-900 pb-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <CalcIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">الحاسبة السريعة</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            title="إغلاق"
          >
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Display Screen */}
        <div
          className={`p-3 sm:p-4 rounded-2xl border flex flex-col items-end justify-center min-h-[70px] font-mono transition-colors shadow-inner shrink-0 ${
            isDarkMode
              ? 'bg-slate-950 border-slate-800 text-emerald-400'
              : 'bg-slate-900 border-slate-800 text-emerald-400'
          }`}
        >
          <div className="text-[11px] sm:text-xs text-slate-400 h-4 sm:h-5 overflow-hidden text-ellipsis whitespace-nowrap">
            {expression}
          </div>
          <div className="text-xl sm:text-2xl font-black tracking-wider break-all text-left dir-ltr w-full">
            {display}
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center justify-between text-xs font-bold gap-1.5 shrink-0 flex-wrap">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 sm:py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center gap-1 transition-colors font-black text-[11px] sm:text-xs cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الناتج'}</span>
          </button>

          <div className="flex gap-1.5">
            <button
              onClick={handleDelete}
              className="px-2.5 py-1.5 sm:py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400 flex items-center gap-1 transition-colors font-black text-[11px] sm:text-xs cursor-pointer"
              title="مسح رمز"
            >
              <Delete className="w-3.5 h-3.5" />
              <span>تراجع</span>
            </button>
            <button
              onClick={handleClear}
              className="px-2.5 py-1.5 sm:py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1 transition-colors font-black text-[11px] sm:text-xs cursor-pointer"
              title="تصفير"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تصفير C</span>
            </button>
          </div>
        </div>

        {/* Keypad Grid */}
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 text-base sm:text-lg font-black dir-ltr shrink-0">
          <button
            onClick={handleClear}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border-rose-500/40'
                : 'bg-rose-100 hover:bg-rose-200 text-rose-700 border-rose-300'
            }`}
          >
            C
          </button>
          <button
            onClick={() => handleOp('÷')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all text-lg sm:text-xl font-black ${
              isDarkMode
                ? 'bg-purple-600/30 hover:bg-purple-600/40 text-purple-200 border-purple-400/40'
                : 'bg-purple-100 hover:bg-purple-200 text-purple-800 border-purple-300'
            }`}
            title="قسمة"
          >
            ÷
          </button>
          <button
            onClick={() => handleOp('×')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all text-lg sm:text-xl font-black ${
              isDarkMode
                ? 'bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border-cyan-400/40'
                : 'bg-cyan-100 hover:bg-cyan-200 text-cyan-800 border-cyan-300'
            }`}
            title="ضرب"
          >
            ×
          </button>
          <button
            onClick={() => handleOp('-')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all text-lg sm:text-xl font-black ${
              isDarkMode
                ? 'bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 border-amber-400/40'
                : 'bg-amber-100 hover:bg-amber-200 text-amber-800 border-amber-300'
            }`}
            title="طرح"
          >
            -
          </button>

          {/* Row 1 */}
          <button
            onClick={() => handleNum('9')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            9
          </button>
          <button
            onClick={() => handleNum('8')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            8
          </button>
          <button
            onClick={() => handleNum('7')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            7
          </button>
          <button
            onClick={() => handleOp('+')}
            className={`row-span-2 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all text-lg sm:text-xl flex items-center justify-center font-black ${
              isDarkMode
                ? 'bg-blue-600/30 hover:bg-blue-600/40 text-blue-200 border-blue-400/40'
                : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300 shadow-xs'
            }`}
            title="جمع"
          >
            +
          </button>

          {/* Row 2 */}
          <button
            onClick={() => handleNum('6')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            6
          </button>
          <button
            onClick={() => handleNum('5')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            5
          </button>
          <button
            onClick={() => handleNum('4')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            4
          </button>

          {/* Row 3 */}
          <button
            onClick={() => handleNum('3')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            3
          </button>
          <button
            onClick={() => handleNum('2')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            2
          </button>
          <button
            onClick={() => handleNum('1')}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            1
          </button>
          <button
            onClick={handleCalculate}
            className={`row-span-2 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all text-xl sm:text-2xl flex items-center justify-center font-black ${
              isDarkMode
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-900/40'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-md'
            }`}
          >
            =
          </button>

          {/* Row 4 */}
          <button
            onClick={() => handleNum('0')}
            className={`col-span-2 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            0
          </button>
          <button
            onClick={handleDot}
            className={`p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-xs'
            }`}
          >
            .
          </button>
        </div>
      </div>
    </div>
  );
};
