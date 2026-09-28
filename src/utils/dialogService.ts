// Global Dialog Service to replace native browser alert() and confirm()
export interface DialogState {
  isOpen: boolean;
  type: 'alert' | 'confirm';
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  resolve?: (value: boolean) => void;
}

type DialogListener = (state: DialogState) => void;

class DialogManager {
  private listener: DialogListener | null = null;
  private queue: DialogState[] = [];

  subscribe(listener: DialogListener) {
    this.listener = listener;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) listener(next);
    }
    return () => {
      this.listener = null;
    };
  }

  show(state: Omit<DialogState, 'isOpen'>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const dialog: DialogState = {
        ...state,
        isOpen: true,
        resolve,
      };
      if (this.listener) {
        this.listener(dialog);
      } else {
        this.queue.push(dialog);
      }
    });
  }

  alert(message: string, title?: string, variant?: 'danger' | 'warning' | 'info' | 'success'): Promise<boolean> {
    return this.show({
      type: 'alert',
      message: String(message),
      title: title || 'تنبيه',
      confirmText: 'حسناً',
      variant: variant || 'info'
    });
  }

  confirm(message: string, options?: { title?: string; confirmText?: string; cancelText?: string; variant?: 'danger' | 'warning' | 'info' }): Promise<boolean> {
    const isDestructive = message.includes('حذف') || message.includes('تصفير') || message.includes('مسح') || message.includes('أرشفة');
    return this.show({
      type: 'confirm',
      message: String(message),
      title: options?.title || (isDestructive ? 'تأكيد الحذف' : 'تأكيد العملية'),
      confirmText: options?.confirmText || 'تأكيد',
      cancelText: options?.cancelText || 'إلغاء',
      variant: options?.variant || (isDestructive ? 'danger' : 'warning')
    });
  }
}

export const dialogService = new DialogManager();

export const showAlert = (msg: string, title?: string, variant?: 'danger' | 'warning' | 'info' | 'success') =>
  dialogService.alert(msg, title, variant);

export const showConfirm = (msg: string, options?: { title?: string; confirmText?: string; cancelText?: string; variant?: 'danger' | 'warning' | 'info' }) =>
  dialogService.confirm(msg, options);

// Intercept native window.alert globally across the whole application
if (typeof window !== 'undefined') {
  window.alert = (message?: any) => {
    dialogService.alert(message !== undefined ? String(message) : '');
  };
}
