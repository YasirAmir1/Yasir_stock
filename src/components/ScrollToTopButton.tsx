import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import { useSales } from '../context/SalesContext';

export const ScrollToTopButton: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const { showQuickAdd, activeTab } = useSales();

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  if (!isVisible) return null;

  const isQuickAddActive = activeTab === 'products' && showQuickAdd;

  return (
    <button
      onClick={scrollToTop}
      aria-label="العودة للأعلى"
      className={`fixed left-4 sm:left-6 z-[60] p-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 flex items-center justify-center border-2 border-emerald-400/40 group ${
        isQuickAddActive 
          ? 'bottom-[124px] sm:bottom-[72px]' 
          : 'bottom-20 sm:bottom-6'
      }`}
      title="العودة للأعلى"
    >
      <ArrowUp className="w-5 h-5 transition-transform group-hover:-translate-y-0.5" />
    </button>
  );
};
