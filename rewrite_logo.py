content = """import React from 'react';
import appLogo from '../assets/images/tikrit_kalla_logo_1786226483598.jpg';

interface AppLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const AppLogo: React.FC<AppLogoProps> = ({ className = '', size = 'md' }) => {
  const sizeMap = {
    sm: 'h-10 sm:h-12 w-auto',
    md: 'h-16 sm:h-20 w-auto',
    lg: 'h-32 sm:h-40 w-auto',
    xl: 'h-48 sm:h-56 w-auto',
  };
  const dimensions = sizeMap[size] || sizeMap.md;

  return (
    <div
      className={`relative inline-flex items-center justify-center transition-transform hover:scale-105 select-none shrink-0 ${dimensions} ${className}`}
    >
      <img
        src={appLogo}
        alt="كالة تكريت - Tikrit Sales Logo"
        className="h-full w-auto object-contain rounded-full shadow-lg border border-emerald-900/30"
      />
    </div>
  );
};
"""

with open('src/components/AppLogo.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
