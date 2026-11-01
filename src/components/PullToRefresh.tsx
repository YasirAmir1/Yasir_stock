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
          className="flex flex-col items-center justify-center text-emerald-500 gap-1"
          style={{
            opacity: pullDistance / 40,
            transform: `scale(${Math.min(pullDistance / 60, 0.8)})`,
          }}
        >
          <Loader2 className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </div>
      </div>
      {children}
    </div>
  );
}
