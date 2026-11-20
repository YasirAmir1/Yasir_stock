import { useState, useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  totalItems: number;
  initialCount?: number;
  batchSize?: number;
  rootMargin?: string;
  /** Optional scrollable container ref; defaults to viewport (null) */
  scrollContainerRef?: React.RefObject<HTMLElement>;
  /** Key representing active filters — resets visibleCount when changed */
  resetKey?: string;
  /** True when the server/backend still has additional pages to fetch */
  hasMoreExternal?: boolean;
  /** True while a server/backend page fetch is currently in flight */
  isLoadingExternal?: boolean;
  /** Triggered when user scrolls near the end of loaded items and more exist on server */
  onReachEnd?: () => void;
}

interface UseInfiniteScrollResult {
  visibleCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement>;
  loadMore: () => void;
  reset: () => void;
}

export function useInfiniteScroll({
  totalItems,
  initialCount = 20,
  batchSize = 20,
  rootMargin = '350px 0px',
  scrollContainerRef,
  resetKey = '',
  hasMoreExternal = false,
  isLoadingExternal = false,
  onReachEnd,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const [visibleCount, setVisibleCount] = useState<number>(initialCount);
  const [isLoadingLocal, setIsLoadingLocal] = useState<boolean>(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingTimerRef = useRef<number | null>(null);

  const hasMoreLocal = visibleCount < totalItems;
  const hasMore = hasMoreLocal || hasMoreExternal;
  const isLoadingMore = isLoadingLocal || isLoadingExternal;

  // Reset visible count only when active filters change
  useEffect(() => {
    setVisibleCount(initialCount);
    setIsLoadingLocal(false);
    if (loadingTimerRef.current !== null) {
      window.clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  }, [resetKey, initialCount]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (loadingTimerRef.current !== null) {
        window.clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  const loadMore = useCallback(() => {
    // Trigger server prefetch when approaching or at end of currently loaded items
    if (hasMoreExternal && !isLoadingExternal && visibleCount + batchSize >= totalItems) {
      onReachEnd?.();
    }

    if (!hasMoreLocal) return;
    if (loadingTimerRef.current !== null) return;

    setIsLoadingLocal(true);
    loadingTimerRef.current = window.setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + batchSize, totalItems));
      setIsLoadingLocal(false);
      loadingTimerRef.current = null;
    }, 100);
  }, [batchSize, totalItems, hasMoreLocal, hasMoreExternal, isLoadingExternal, visibleCount, onReachEnd]);

  const reset = useCallback(() => {
    setVisibleCount(initialCount);
    setIsLoadingLocal(false);
  }, [initialCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      {
        root: scrollContainerRef?.current ?? null,
        rootMargin,
        threshold: 0.01,
      }
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, visibleCount, totalItems, isLoadingExternal, loadMore, rootMargin, scrollContainerRef]);

  return {
    visibleCount,
    hasMore,
    isLoadingMore,
    sentinelRef,
    loadMore,
    reset,
  };
}
