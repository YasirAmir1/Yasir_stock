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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200 dir-rtl">
      <div
        className={`w-full max-w-md sm:max-w-lg rounded-3xl border shadow-2xl p-5 sm:p-6 space-y-4 ${
          isDarkMode
            ? 'bg-slate-900 border-emerald-500/40 text-white'
            : 'bg-white border-emerald-600/30 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <CalcIcon className="w-6 h-6" />
            </div>
            <h3 className="font-black text-base sm:text-lg">الحاسبة السريعة</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="إغلاق"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Display Screen */}
        <div
          className={`p-4 rounded-2xl border flex flex-col items-end justify-center min-h-[80px] font-mono transition-colors shadow-inner ${
            isDarkMode
              ? 'bg-slate-950 border-slate-800 text-emerald-400'
              : 'bg-slate-900 border-slate-800 text-emerald-400'
          }`}
        >
          <div className="text-xs sm:text-sm text-slate-400 h-5 overflow-hidden text-ellipsis whitespace-nowrap">
            {expression}
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-wider break-all text-left dir-ltr w-full">
            {display}
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex items-center justify-between text-xs sm:text-sm font-bold gap-2">
          <button
            onClick={handleCopy}
            className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 flex items-center gap-1.5 transition-colors font-black"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'تم النسخ!' : 'نسخ الناتج'}</span>
          </button>

          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="px-3.5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center gap-1.5 transition-colors font-black"
              title="مسح رمز"
            >
              <Delete className="w-4 h-4" />
              <span>تراجع</span>
            </button>
            <button
              onClick={handleClear}
              className="px-3.5 py-2 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors font-black"
              title="تصفير"
            >
              <RefreshCw className="w-4 h-4" />
              <span>تصفير C</span>
            </button>
          </div>
        </div>

        {/* Keypad Grid */}
        <div className="grid grid-cols-4 gap-2 text-lg sm:text-xl font-black dir-ltr">
          <button
            onClick={handleClear}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border-rose-500/40'
                : 'bg-rose-100 hover:bg-rose-200 text-rose-700 border-rose-300'
            }`}
          >
            C
          </button>
          <button
            onClick={() => handleOp('÷')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all text-xl sm:text-2xl font-black ${
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
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all text-xl sm:text-2xl font-black ${
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
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all text-xl sm:text-2xl font-black ${
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
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            9
          </button>
          <button
            onClick={() => handleNum('8')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            8
          </button>
          <button
            onClick={() => handleNum('7')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            7
          </button>
          <button
            onClick={() => handleOp('+')}
            className={`row-span-2 p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all text-xl sm:text-2xl flex items-center justify-center font-black ${
              isDarkMode
                ? 'bg-blue-600/30 hover:bg-blue-600/40 text-blue-200 border-blue-400/40'
                : 'bg-blue-100 hover:bg-blue-200 text-blue-800 border-blue-300 shadow-sm'
            }`}
            title="جمع"
          >
            +
          </button>

          {/* Row 2 */}
          <button
            onClick={() => handleNum('6')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            6
          </button>
          <button
            onClick={() => handleNum('5')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            5
          </button>
          <button
            onClick={() => handleNum('4')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            4
          </button>

          {/* Row 3 */}
          <button
            onClick={() => handleNum('3')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            3
          </button>
          <button
            onClick={() => handleNum('2')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            2
          </button>
          <button
            onClick={() => handleNum('1')}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            1
          </button>
          <button
            onClick={handleCalculate}
            className={`row-span-2 p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all text-2xl flex items-center justify-center font-black ${
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
            className={`col-span-2 p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            0
          </button>
          <button
            onClick={handleDot}
            className={`p-3.5 sm:p-4 rounded-2xl border active:scale-95 transition-all font-black ${
              isDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900 shadow-sm'
            }`}
          >
            .
          </button>
        </div>
      </div>
    </div>
  );
};
