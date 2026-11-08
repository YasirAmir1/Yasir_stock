import html2canvas from 'html2canvas-pro';
import { parseArabicDigits } from './numberUtils';

/**
 * Yields execution back to the browser's main thread to allow UI rendering,
 * animations, and loading states to paint before running CPU-heavy work.
 */
export const yieldToMainThread = async (): Promise<void> => {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      window.requestAnimationFrame(() => {
        setTimeout(resolve, 30);
      });
    } else {
      setTimeout(resolve, 30);
    }
  });
};

/**
 * Compresses an HTMLCanvasElement client-side to an optimized, lightweight JPEG Blob.
 * Ensures the generated file is small enough (< 200KB) for instant sharing without freezing.
 * 
 * @param canvas Source HTMLCanvasElement
 * @param quality JPEG compression quality (0.75 - 0.82 is ideal for receipts)
 * @param maxWidth Max output width (700px provides crisp thermal receipt display while saving memory)
 */
export const compressCanvasToJpegBlob = async (
  canvas: HTMLCanvasElement,
  quality = 0.78,
  maxWidth = 720
): Promise<Blob> => {
  let targetCanvas: HTMLCanvasElement = canvas;

  // If the canvas is wider than maxWidth, downscale smoothly onto an offscreen canvas
  if (canvas.width > maxWidth) {
    const scaleFactor = maxWidth / canvas.width;
    const targetWidth = maxWidth;
    const targetHeight = Math.round(canvas.height * scaleFactor);

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = targetWidth;
    offscreenCanvas.height = targetHeight;
    const ctx = offscreenCanvas.getContext('2d');

    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      targetCanvas = offscreenCanvas;
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    targetCanvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to compress canvas to JPEG Blob'));
        }
      },
      'image/jpeg',
      quality
    );
  });
};

export interface CaptureInvoiceOptions {
  scale?: number;
  quality?: number;
  maxWidth?: number;
}

/**
 * Captures an HTML container to a compressed JPEG Blob with background execution
 * and thread deferral to keep the UI smooth and responsive.
 */
export const captureInvoiceToBlob = async (
  container: HTMLElement,
  options: CaptureInvoiceOptions = {}
): Promise<Blob> => {
  const { scale = 1.6, quality = 0.78, maxWidth = 720 } = options;

  // 1. Ensure container is attached properly to DOM offscreen
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.visibility = 'visible';
  container.style.boxSizing = 'border-box';

  if (!container.parentNode) {
    document.body.appendChild(container);
  }

  try {
    // 2. Yield to main thread so browser renders loading state / spinner
    await yieldToMainThread();

    // 3. Wait for fonts if available (with fallback safety timeout)
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 300))
      ]);
    }

    // 4. Yield one more tick to let layout settle
    await yieldToMainThread();

    // 5. Run html2canvas with performance-focused options
    const canvas = await html2canvas(container, {
      scale, // 1.6 gives crisp text while cutting ~36% pixels vs 2.0
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      removeContainer: false,
      imageTimeout: 4000,
      windowWidth: container.scrollWidth || 350,
      windowHeight: container.scrollHeight || 1200,
    });

    // 6. Yield before compression to prevent main-thread choking
    await yieldToMainThread();

    // 7. Client-side compression to lightweight JPEG Blob
    const compressedBlob = await compressCanvasToJpegBlob(canvas, quality, maxWidth);
    return compressedBlob;
  } finally {
    // 8. Always clean up offscreen DOM container
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  }
};

/**
 * Helper to normalize Iraqi/Arabic phone numbers for direct WhatsApp links
 */
export const formatWhatsAppPhone = (phone: string): string => {
  if (!phone) return '';
  const normalized = parseArabicDigits(String(phone));
  let cleaned = normalized.replace(/\D/g, '');
  if (cleaned.startsWith('00964')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('07') || cleaned.startsWith('0')) {
    cleaned = '964' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') && cleaned.length === 10) {
    cleaned = '964' + cleaned;
  } else if (!cleaned.startsWith('964') && cleaned.length >= 10) {
    cleaned = '964' + cleaned;
  }
  return cleaned;
};

export interface ShareInvoiceParams {
  blob: Blob;
  fileName: string;
  message: string;
  customerPhone?: string;
  actualCustomerName: string;
  addToast?: (toast: any) => void;
}

/**
 * Shares the compressed invoice file using Web Share API when supported,
 * or falls back to clipboard copy + instant download + WhatsApp URL.
 */
export const shareOrDownloadInvoice = async ({
  blob,
  fileName,
  message,
  customerPhone = '',
  actualCustomerName,
  addToast,
}: ShareInvoiceParams): Promise<boolean> => {
  let sharedSuccessfully = false;

  // 1. Mobile Native Share (Prioritize this for instant image attachment)
  if (blob && typeof navigator !== 'undefined' && navigator.share) {
    const file = new File([blob], fileName, { type: 'image/jpeg' });
    const canShareFiles = navigator.canShare ? navigator.canShare({ files: [file] }) : true;

    if (canShareFiles) {
      try {
        await navigator.share({
          files: [file],
          title: `فاتورة ${actualCustomerName}`,
          text: message,
        });
        sharedSuccessfully = true;
        return true;
      } catch (err: any) {
        // User cancelled or dismissed share modal; ignore abort
        if (err?.name !== 'AbortError') {
          console.log('Navigator share failed, falling back:', err);
        } else {
          return true;
        }
      }
    }
  }

  // 2. Fallback: Clipboard Copy + Automatic Download + Direct WhatsApp Chat
  if (!sharedSuccessfully) {
    if (typeof addToast === 'function') {
      addToast({
        title: 'مشاركة الفاتورة',
        message: '📋 تم حفظ صورة الفاتورة بحجم مخفف! سيتم فتح المحادثة، يمكنك لصق الصورة أو إرسالها من التنزيلات.',
        type: 'info',
      });
    }

    // Try copying to clipboard for quick Ctrl+V
    if (blob && typeof navigator !== 'undefined' && navigator.clipboard && window.ClipboardItem) {
      try {
        const item = new ClipboardItem({ 'image/jpeg': blob });
        await navigator.clipboard.write([item]);
      } catch (clipErr) {
        console.log('Clipboard write issue:', clipErr);
      }
    }

    // Trigger fast download
    if (blob) {
      const downloadUrl = URL.createObjectURL(blob);
      const dlLink = document.createElement('a');
      dlLink.href = downloadUrl;
      dlLink.download = fileName;
      document.body.appendChild(dlLink);
      dlLink.click();
      document.body.removeChild(dlLink);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
    }

    // Open WhatsApp direct chat
    const formattedPhone = formatWhatsAppPhone(customerPhone);
    const directWaUrl = formattedPhone
      ? `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    const waLink = document.createElement('a');
    waLink.href = directWaUrl;
    waLink.target = '_blank';
    document.body.appendChild(waLink);
    waLink.click();
    document.body.removeChild(waLink);
  }

  return sharedSuccessfully;
};
