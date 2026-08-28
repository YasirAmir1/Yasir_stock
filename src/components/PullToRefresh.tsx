import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [startY, setStartY] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      setStartY(e.touches[0].clientY);
      setPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!pulling || refreshing) return;
    const y = e.touches[0].clientY;
    const distance = y - startY;
    if (distance > 0) {
      setPullDistance(Math.min(distance * 0.5, 100)); 
    }
  };

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance > 60 && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
        setPulling(false);
      }
    } else {
      setPullDistance(0);
      setPulling(false);
    }
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ minHeight: '100%', position: 'relative' }}
    >
      <div 
        style={{
          height: `${pullDistance}px`,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: pulling ? 'none' : 'height 0.3s ease-out',
        }}
      >
        <div 
          className="flex flex-col items-center justify-center text-emerald-600 gap-2"
          style={{
            opacity: pullDistance / 60,
            transform: `scale(${Math.min(pullDistance / 60, 1)})`,
          }}
        >
          <Loader2 className={`w-6 h-6 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="text-xs font-bold">{refreshing ? 'جاري التحديث...' : 'اسحب للتحديث'}</span>
        </div>
      </div>
      {children}
    </div>
  );
}
