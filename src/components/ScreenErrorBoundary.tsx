import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ScreenErrorBoundary] Caught error in screen component:', error, errorInfo);
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleFullReload = () => {
    try {
      sessionStorage.removeItem('app_chunk_reload_lock');
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isChunkError =
        this.state.error?.message?.includes('dynamically imported module') ||
        this.state.error?.message?.includes('Failed to fetch') ||
        this.state.error?.name === 'ChunkLoadError';

      return (
        <div className="max-w-xl mx-auto my-8 p-6 bg-white dark:bg-slate-900 rounded-3xl border border-amber-200 dark:border-amber-800/60 shadow-xl text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/80 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              {this.props.fallbackTitle || 'تعذر تحميل محتوى هذه الشاشة مؤقتاً'}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              {isChunkError
                ? 'حدث انقطاع مؤقت في الاتصال أو تحديث في حزم النظام. يرجى الضغط على زر إعادة المحاولة للمتابعة.'
                : 'حدث خطأ غير متوقع أثناء معالجة بيانات هذه الشاشة. يمكنك المحاولة مرة أخرى أو تحديث الصفحة.'}
            </p>
          </div>

          {this.state.error?.message && (
            <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-[11px] font-mono text-slate-500 dark:text-slate-400 overflow-x-auto text-left dir-ltr">
              {this.state.error.message.slice(0, 150)}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
            <button
              onClick={this.handleRetry}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل الشاشة</span>
            </button>
            <button
              onClick={this.handleFullReload}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث الصفحة بالكامل</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
