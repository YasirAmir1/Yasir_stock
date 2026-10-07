import React, { useState, useMemo, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas-pro';
import * as XLSX from 'xlsx';
import { useSales, DEFAULT_CATEGORIES_LIST } from '../context/SalesContext';
import { db } from '../lib/firebase';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, writeBatch, getDocs } from 'firebase/firestore';
import { formatWithCommas, parseArabicDigits } from '../utils/numberUtils';
import { Award, RotateCcw, AlertTriangle, Shield, Check, Filter, Calendar, TrendingUp, Pencil, Trash2, X, Package, Upload, Download, FileSpreadsheet, Crown, Coins, Store, PackagePlus, Users, ShoppingBag, CheckCircle2, ChevronDown, ChevronUp, Share2, MessageCircle } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PullToRefresh } from './PullToRefresh';
import { DailySalesCompletionBar } from './DailySalesCompletionBar';

export interface SpecificProductTarget {
  id?: string;
  delegateName: string;
  productName?: string;
  targetPieces?: number;
  salesPiecesOverride?: number;
  targetCartons: number;
  salesCartonsOverride?: number;
  targetShops: number;
  actualShopsOverride?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MonthlyItemTarget {
  id?: string;
  categoryName: string;
  delegateName: string;
  monthlyTarget: number;
  monthlySales: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DelegateIncentive {
  id?: string;
  delegateName: string;
  incentivesAmount: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DelegateMonthlyExtraTargets {
  id?: string;
  delegateName: string;
  // Card 1: Monetary
  monthlyIqdTarget: number;
  monthlyIqdSalesOverride?: number;
  // Card 2: Shops
  targetShopsCount: number;
  actualShopsCountOverride?: number;
  // Card 3: Extra Product
  extraProductName: string;
  extraProductCustomersTarget: number;
  extraProductCustomersActualOverride?: number;
  updatedAt?: string;
  updatedBy?: string;
}

const normalizeText = (str: string) => {
  if (!str) return '';
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/١/g, '1')
    .replace(/٢/g, '2')
    .replace(/٣/g, '3')
    .replace(/٤/g, '4')
    .replace(/٥/g, '5')
    .replace(/٦/g, '6')
    .replace(/٧/g, '7')
    .replace(/٨/g, '8')
    .replace(/٩/g, '9')
    .replace(/٠/g, '0')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
};

const sanitizeModernColors = (clonedDoc: Document, fallback: string = '#0f172a') => {
  // Remove external stylesheets that might contain unparseable oklab/oklch
  const links = clonedDoc.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => link.remove());

  try {
    for (let i = 0; i < clonedDoc.styleSheets.length; i++) {
      try {
        const sheet = clonedDoc.styleSheets[i];
        const rules = sheet.cssRules;
        if (rules) {
          for (let j = rules.length - 1; j >= 0; j--) {
            const ruleText = rules[j].cssText;
            if (ruleText && (ruleText.includes('oklch') || ruleText.includes('oklab') || ruleText.includes('color('))) {
              sheet.deleteRule(j);
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  const styleTags = clonedDoc.querySelectorAll('style');
  styleTags.forEach(style => {
    if (style.textContent) {
      style.textContent = style.textContent
        .replace(/oklch\([^)]+\)/g, fallback)
        .replace(/oklab\([^)]+\)/g, fallback)
        .replace(/color\([^)]+\)/g, fallback);
    }
  });

  const allEls = clonedDoc.querySelectorAll('*');
  allEls.forEach((el: any) => {
    if (el.style) {
      for (let i = 0; i < el.style.length; i++) {
        const prop = el.style[i];
        const val = el.style.getPropertyValue(prop);
        if (val && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
          el.style.setProperty(prop, fallback);
        }
      }
    }
  });

  // Monkey-patch getComputedStyle in the cloned document window to intercept oklab/oklch/color
  if (clonedDoc.defaultView) {
    const originalGetComputedStyle = clonedDoc.defaultView.getComputedStyle;
    clonedDoc.defaultView.getComputedStyle = function(elt: Element, pseudoElt?: string | null) {
      const style = originalGetComputedStyle.call(this, elt, pseudoElt);
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'getPropertyValue' || prop === 'item') {
            return function(propertyName: string) {
              const val = (target as any)[prop](propertyName);
              if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
                return fallback;
              }
              return val;
            };
          }
          const val = (target as any)[prop];
          if (typeof val === 'string' && (val.includes('oklch') || val.includes('oklab') || val.includes('color('))) {
            return fallback;
          }
          return typeof val === 'function' ? val.bind(target) : val;
        }
      });
    };
  }
};

// --- Daily Admin Report Component ---
const DailyAdminReport: React.FC<{ 
  salesEntries: any[], 
  productsList: any[], 
  currentUser: any, 
  delegatesList?: string[],
  reportRef?: React.RefObject<HTMLDivElement>,
  isDownloading: string | null,
  setIsDownloading: React.Dispatch<React.SetStateAction<string | null>>,
  completedDelegates: Record<string, boolean>
}> = ({ salesEntries, productsList, currentUser, delegatesList = [], reportRef, isDownloading, setIsDownloading, completedDelegates }) => {
  const { isDarkMode } = useSales();
  const today = new Date().toISOString().split('T')[0];
  const entriesToday = salesEntries.filter(e => e.dateString === today);
  const productsReportRef = useRef<HTMLDivElement>(null);
  const categorySummaryReportRef = useRef<HTMLDivElement>(null);
  const threeTablesCaptureRef = useRef<HTMLDivElement>(null);
  
  const [reportActionModal, setReportActionModal] = useState<{
    isOpen: boolean;
    target: 'main' | 'products';
    title: string;
  } | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState<'share' | 'download' | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const handleDownload = async (actionType: 'share' | 'download' = 'download') => {
    const targetElement = threeTablesCaptureRef.current;
    if (targetElement) {
      try {
        setIsDownloading('main');
        await document.fonts.ready;
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const canvas = await html2canvas(targetElement, {
          backgroundColor: '#f1f5f9', // Soft light gray (الرصاصي الخافت)
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          onclone: (clonedDoc) => {
            sanitizeModernColors(clonedDoc, '#f1f5f9');

            // Hide buttons & export controls
            const noExportEls = clonedDoc.querySelectorAll('.no-export');
            noExportEls.forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
            const buttons = clonedDoc.querySelectorAll('button');
            buttons.forEach(btn => {
              (btn as HTMLElement).style.display = 'none';
            });

            // Expand container to fixed width (1060px) so mobile screens don't clip the tables and large text fits comfortably
            const clonedContainer = clonedDoc.getElementById('daily-three-reports-container');
            if (clonedContainer) {
              clonedContainer.style.width = '1060px';
              clonedContainer.style.maxWidth = 'none';
              clonedContainer.style.padding = '32px';
              clonedContainer.style.boxSizing = 'border-box';
              clonedContainer.style.backgroundColor = '#f1f5f9'; // Soft light gray (الرصاصي الخافت)
              clonedContainer.style.borderRadius = '16px';
              clonedContainer.style.border = '2px solid #cbd5e1';
              clonedContainer.style.color = '#0f172a';

              // Header Card inside container
              const headerBox = clonedContainer.querySelector('.shadow-md');
              if (headerBox) {
                const hEl = headerBox as HTMLElement;
                hEl.style.backgroundColor = '#ffffff';
                hEl.style.borderColor = '#cbd5e1';
                hEl.style.borderRadius = '12px';
              }

              // Section Cards (Retail, Wholesale, All sales containers)
              const sectionCards = clonedContainer.querySelectorAll('.shadow-lg');
              sectionCards.forEach(card => {
                const cEl = card as HTMLElement;
                cEl.style.backgroundColor = '#ffffff';
                cEl.style.borderColor = '#cbd5e1';
                cEl.style.borderRadius = '12px';
                cEl.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05)';
              });

              const scrollContainers = clonedContainer.querySelectorAll('.overflow-x-auto');
              scrollContainers.forEach(sc => {
                (sc as HTMLElement).style.overflow = 'visible';
              });

              const tables = clonedContainer.querySelectorAll('table');
              tables.forEach(t => {
                const tableEl = t as HTMLTableElement;
                tableEl.style.width = '100%';
                tableEl.style.minWidth = '980px';
                tableEl.style.borderCollapse = 'collapse';
                tableEl.style.border = '2px solid #64748b';
                tableEl.style.textAlign = 'center';
                tableEl.style.backgroundColor = '#ffffff';
              });

              const rows = clonedContainer.querySelectorAll('tr');
              rows.forEach(r => {
                const rowEl = r as HTMLElement;
                rowEl.style.verticalAlign = 'middle';
              });

              // Style headers and total rows
              const theadRows = clonedContainer.querySelectorAll('thead tr, thead th');
              theadRows.forEach(el => {
                const htmlEl = el as HTMLElement;
                htmlEl.style.backgroundColor = '#e2e8f0';
                htmlEl.style.color = '#0f172a';
              });

              // Vertically center all text content and data within every table cell and apply enlarged typography
              const cells = clonedContainer.querySelectorAll('th, td');
              cells.forEach(c => {
                const cell = c as HTMLElement;
                cell.style.border = '1px solid #94a3b8';
                cell.style.textAlign = 'center';
                cell.style.verticalAlign = 'middle';
                cell.style.lineHeight = '1.25';
                cell.style.padding = '14px 10px';
                cell.style.boxSizing = 'border-box';
                cell.style.fontWeight = 'bold';
                // Further increased font size: th: 21px, td: 20px
                if (cell.tagName.toLowerCase() === 'th') {
                  cell.style.fontSize = '21px';
                  cell.style.backgroundColor = '#e2e8f0';
                  cell.style.color = '#0f172a';
                } else {
                  cell.style.fontSize = '20px';
                  if (cell.parentElement?.matches('.bg-slate-900, .bg-amber-950, tr:last-child')) {
                    cell.style.backgroundColor = '#e2e8f0';
                    cell.style.color = '#0f172a';
                  } else {
                    cell.style.backgroundColor = '#ffffff';
                    if (!cell.classList.contains('text-red-500') && !cell.classList.contains('text-red-400')) {
                      cell.style.color = '#0f172a';
                    }
                  }
                }
              });

              // Ensure all cell contents, data items, and numbers are vertically centered, bold, and inherit the large font size
              const cellContents = clonedContainer.querySelectorAll('th *, td *');
              cellContents.forEach(child => {
                const htmlChild = child as HTMLElement;
                htmlChild.style.verticalAlign = 'middle';
                htmlChild.style.fontSize = 'inherit';
                htmlChild.style.fontWeight = 'bold';
                htmlChild.style.lineHeight = 'inherit';
                htmlChild.style.margin = '0';
                if (!htmlChild.classList.contains('text-red-500') && !htmlChild.classList.contains('text-red-400')) {
                  htmlChild.style.color = '#0f172a';
                }
              });

              // Ensure all headings and text in the container are bold and enlarged
              const textEls = clonedContainer.querySelectorAll('h3, p, span, div');
              textEls.forEach(el => {
                const htmlEl = el as HTMLElement;
                htmlEl.style.fontWeight = 'bold';
                if (!htmlEl.classList.contains('text-red-500') && !htmlEl.classList.contains('text-red-400') && !htmlEl.classList.contains('text-yellow-400')) {
                  htmlEl.style.color = '#0f172a';
                }
              });

              const headings = clonedContainer.querySelectorAll('h3');
              headings.forEach(h => {
                const htmlH = h as HTMLElement;
                htmlH.style.fontWeight = 'bold';
                htmlH.style.fontSize = '25px';
                if (htmlH.innerText?.includes('المفرد')) {
                  htmlH.style.color = '#047857';
                } else if (htmlH.innerText?.includes('الجملة')) {
                  htmlH.style.color = '#4338ca';
                } else if (htmlH.innerText?.includes('الكل')) {
                  htmlH.style.color = '#b45309';
                } else {
                  htmlH.style.color = '#0f172a';
                }
              });

              const paragraphs = clonedContainer.querySelectorAll('p');
              paragraphs.forEach(p => {
                const htmlP = p as HTMLElement;
                htmlP.style.fontWeight = 'bold';
                htmlP.style.fontSize = '19px';
                htmlP.style.color = '#475569';
              });

              const spans = clonedContainer.querySelectorAll('span');
              spans.forEach(s => {
                const htmlS = s as HTMLElement;
                htmlS.style.fontWeight = 'bold';
                if (htmlS.classList.contains('bg-amber-500/10') || htmlS.innerText?.includes('مفرد + جملة + الكل')) {
                  htmlS.style.fontSize = '18px';
                  htmlS.style.color = '#b45309';
                  htmlS.style.backgroundColor = '#fef3c7';
                }
              });

              // Apply BOLD to ALL elements (numbers and text) within the generated report image
              const allEls = clonedContainer.querySelectorAll('*');
              allEls.forEach(el => {
                const htmlEl = el as HTMLElement;
                htmlEl.style.fontWeight = 'bold';
              });
            }
          }
        });

        const fileName = `تقرير-مبيعات-اليوم-(مفرد-وجملة-والكل)-${today}.jpg`;

        if (actionType === 'share') {
          let sharedSuccessfully = false;
          if (navigator.share && navigator.canShare) {
            try {
              const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
              if (blob) {
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                if (navigator.canShare({ files: [file] })) {
                  await navigator.share({
                    files: [file],
                    title: 'تقرير مبيعات اليوم الشامل',
                    text: `تقرير مبيعات اليوم (${today}) - جدول المفرد + جدول الجملة + جدول الكل`,
                  });
                  sharedSuccessfully = true;
                }
              }
            } catch (err: any) {
              if (err.name === 'AbortError') {
                sharedSuccessfully = true;
              } else {
                console.warn("navigator.share error:", err);
              }
            }
          }

          if (!sharedSuccessfully) {
            // Fallback for desktop or browsers without file share: download the image
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            const link = document.createElement('a');
            link.download = fileName;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setActionFeedback("تم تنزيل صورة التقرير بنجاح! يمكنك الآن مشاركتها عبر واتساب أو التطبيقات الأخرى.");
            setTimeout(() => setActionFeedback(null), 5000);
          }
        } else {
          // Direct Download as image
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const link = document.createElement('a');
          link.download = fileName;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setActionFeedback("تم تحميل صورة التقرير بنجاح ✅");
          setTimeout(() => setActionFeedback(null), 4000);
        }

      } catch (error) {
        console.error("html2canvas error:", error);
        setActionFeedback("حدث خطأ أثناء إنشاء صورة التقرير. يرجى المحاولة مرة أخرى.");
        setTimeout(() => setActionFeedback(null), 4000);
      } finally {
        setIsDownloading(null);
      }
    } else {
      setActionFeedback("عذراً، عنصر التقرير غير موجود.");
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };
  
  const combinedReportRef = useRef<HTMLDivElement>(null);
  
  const handleDownloadProducts = async (actionType: 'share' | 'download' = 'download') => {
    if (combinedReportRef.current) {
      try {
        setIsDownloading('products');
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 500));
        const canvas = await html2canvas(combinedReportRef.current, {
          backgroundColor: '#f1f5f9', // Soft light gray (الرصاصي الخافت)
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          onclone: (clonedDoc) => {
            sanitizeModernColors(clonedDoc, '#f1f5f9');
            const targetEl = clonedDoc.querySelector('.bg-slate-900') || clonedDoc.body;
            if (targetEl) {
              (targetEl as HTMLElement).style.backgroundColor = '#f1f5f9';
              (targetEl as HTMLElement).style.padding = '32px';
              (targetEl as HTMLElement).style.width = '1060px';
              (targetEl as HTMLElement).style.minWidth = '1060px';
            }
            const innerCard = clonedDoc.querySelector('.bg-indigo-900');
            if (innerCard) {
              (innerCard as HTMLElement).style.backgroundColor = '#ffffff';
              (innerCard as HTMLElement).style.color = '#0f172a';
              (innerCard as HTMLElement).style.border = '1px solid #cbd5e1';
            }
            const tables = clonedDoc.querySelectorAll('table');
            tables.forEach(t => {
              const tableEl = t as HTMLTableElement;
              tableEl.style.borderCollapse = 'collapse';
              tableEl.style.border = '2px solid #64748b';
              tableEl.style.textAlign = 'center';
              tableEl.style.backgroundColor = '#ffffff';
            });
            const theadRows = clonedDoc.querySelectorAll('thead tr, thead th');
            theadRows.forEach(el => {
              (el as HTMLElement).style.backgroundColor = '#e2e8f0';
              (el as HTMLElement).style.color = '#0f172a';
            });
            const rows = clonedDoc.querySelectorAll('tr');
            rows.forEach(r => {
              (r as HTMLElement).style.verticalAlign = 'middle';
            });
            const cells = clonedDoc.querySelectorAll('th, td');
            cells.forEach(c => {
              const cell = c as HTMLElement;
              cell.style.border = '1px solid #94a3b8';
              cell.style.textAlign = 'center';
              cell.style.verticalAlign = 'middle';
              cell.style.lineHeight = '1.25';
              cell.style.color = '#0f172a';
              cell.style.padding = '14px 10px';
              cell.style.fontWeight = 'bold';
              if (cell.tagName.toLowerCase() === 'th') {
                cell.style.fontSize = '21px';
                cell.style.backgroundColor = '#e2e8f0';
              } else {
                cell.style.fontSize = '20px';
                cell.style.backgroundColor = '#ffffff';
              }
            });
            const cellContents = clonedDoc.querySelectorAll('th *, td *');
            cellContents.forEach(child => {
              const htmlChild = child as HTMLElement;
              htmlChild.style.verticalAlign = 'middle';
              htmlChild.style.fontSize = 'inherit';
              htmlChild.style.fontWeight = 'bold';
              htmlChild.style.lineHeight = 'inherit';
              htmlChild.style.margin = '0';
              htmlChild.style.color = '#0f172a';
            });
            const textEls = clonedDoc.querySelectorAll('h3, p, span, div');
            textEls.forEach(el => {
              const htmlEl = el as HTMLElement;
              htmlEl.style.color = '#0f172a';
              htmlEl.style.fontWeight = 'bold';
            });
            const headings = clonedDoc.querySelectorAll('h3');
            headings.forEach(h => {
              const htmlH = h as HTMLElement;
              htmlH.style.fontSize = '25px';
              htmlH.style.fontWeight = 'bold';
              htmlH.style.color = '#4338ca';
            });
            const paragraphs = clonedDoc.querySelectorAll('p');
            paragraphs.forEach(p => {
              const htmlP = p as HTMLElement;
              htmlP.style.fontSize = '19px';
              htmlP.style.fontWeight = 'bold';
              htmlP.style.color = '#475569';
            });
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach(el => {
              (el as HTMLElement).style.fontWeight = 'bold';
            });
          }
        });
        const fileName = `مبيعات-أصناف-مختارة-${new Date().toLocaleDateString('ar-EG')}.jpg`;

        if (actionType === 'share') {
          let sharedSuccessfully = false;
          if (navigator.share && navigator.canShare) {
            try {
              const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
              if (blob) {
                const file = new File([blob], fileName, { type: 'image/jpeg' });
                if (navigator.canShare({ files: [file] })) {
                  await navigator.share({
                    files: [file],
                    title: 'تقرير مبيعات أصناف مختارة (المجمع)',
                    text: `تقرير مبيعات أصناف مختارة (المجمع) - تاريخ ${today}`,
                  });
                  sharedSuccessfully = true;
                }
              }
            } catch (err: any) {
              if (err.name === 'AbortError') {
                sharedSuccessfully = true;
              } else {
                console.warn("navigator.share error:", err);
              }
            }
          }

          if (!sharedSuccessfully) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
            const link = document.createElement('a');
            link.download = fileName;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setActionFeedback("تم تنزيل صورة التقرير بنجاح! يمكنك الآن مشاركتها عبر واتساب أو التطبيقات الأخرى.");
            setTimeout(() => setActionFeedback(null), 5000);
          }
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const link = document.createElement('a');
          link.download = fileName;
          link.href = dataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setActionFeedback("تم تحميل صورة التقرير بنجاح ✅");
          setTimeout(() => setActionFeedback(null), 4000);
        }

      } catch (error) {
        console.error("html2canvas error:", error);
        setActionFeedback("حدث خطأ أثناء تحميل التقرير كصورة. يرجى المحاولة مرة أخرى.");
        setTimeout(() => setActionFeedback(null), 4000);
      } finally {
        setIsDownloading(null);
      }
    } else {
      setActionFeedback("عذراً، عنصر التقرير غير موجود.");
      setTimeout(() => setActionFeedback(null), 4000);
    }
  };
  
  const handleDownloadCategorySummary = async () => {
    if (categorySummaryReportRef.current) {
      try {
        window.scrollTo(0, 0);
        const canvas = await html2canvas(categorySummaryReportRef.current, {
          backgroundColor: '#f1f5f9', // Soft light gray (الرصاصي الخافت)
          scale: 2,
          useCORS: true,
          onclone: (clonedDoc) => {
            sanitizeModernColors(clonedDoc, '#f1f5f9');
            const targetEl = clonedDoc.body;
            if (targetEl) {
              targetEl.style.backgroundColor = '#f1f5f9';
            }
            const tables = clonedDoc.querySelectorAll('table');
            tables.forEach(t => {
              const tableEl = t as HTMLTableElement;
              tableEl.style.borderCollapse = 'collapse';
              tableEl.style.border = '2px solid #64748b';
              tableEl.style.textAlign = 'center';
              tableEl.style.backgroundColor = '#ffffff';
            });
            const theadRows = clonedDoc.querySelectorAll('thead tr, thead th');
            theadRows.forEach(el => {
              (el as HTMLElement).style.backgroundColor = '#e2e8f0';
              (el as HTMLElement).style.color = '#0f172a';
            });
            const rows = clonedDoc.querySelectorAll('tr');
            rows.forEach(r => {
              (r as HTMLElement).style.verticalAlign = 'middle';
            });
            const cells = clonedDoc.querySelectorAll('th, td');
            cells.forEach(c => {
              const cell = c as HTMLElement;
              cell.style.border = '1px solid #94a3b8';
              cell.style.textAlign = 'center';
              cell.style.verticalAlign = 'middle';
              cell.style.lineHeight = '1.25';
              cell.style.color = '#0f172a';
              cell.style.padding = '14px 10px';
              cell.style.fontWeight = 'bold';
              if (cell.tagName.toLowerCase() === 'th') {
                cell.style.fontSize = '21px';
                cell.style.backgroundColor = '#e2e8f0';
              } else {
                cell.style.fontSize = '20px';
                cell.style.backgroundColor = '#ffffff';
              }
            });
            const cellContents = clonedDoc.querySelectorAll('th *, td *');
            cellContents.forEach(child => {
              const htmlChild = child as HTMLElement;
              htmlChild.style.verticalAlign = 'middle';
              htmlChild.style.fontSize = 'inherit';
              htmlChild.style.fontWeight = 'bold';
              htmlChild.style.lineHeight = 'inherit';
              htmlChild.style.margin = '0';
              htmlChild.style.color = '#0f172a';
            });
            const textEls = clonedDoc.querySelectorAll('h3, p, span, div');
            textEls.forEach(el => {
              const htmlEl = el as HTMLElement;
              htmlEl.style.color = '#0f172a';
              htmlEl.style.fontWeight = 'bold';
            });
            const headings = clonedDoc.querySelectorAll('h3');
            headings.forEach(h => {
              const htmlH = h as HTMLElement;
              htmlH.style.fontSize = '25px';
              htmlH.style.fontWeight = 'bold';
              htmlH.style.color = '#047857';
            });
            const paragraphs = clonedDoc.querySelectorAll('p');
            paragraphs.forEach(p => {
              const htmlP = p as HTMLElement;
              htmlP.style.fontSize = '19px';
              htmlP.style.fontWeight = 'bold';
              htmlP.style.color = '#475569';
            });
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach(el => {
              (el as HTMLElement).style.fontWeight = 'bold';
            });
          }
        });
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const link = document.createElement('a');
        link.download = `تقرير-مجموع-الأصناف-${new Date().toLocaleDateString('ar-EG')}.jpg`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        console.error("html2canvas error:", error);
      }
    }
  };
  
  // Removed handleDownload and reportRef definition from here
  const getDelegateSales = (priceMode: 'retail' | 'wholesale') => {
    const data: Record<string, { count: number, weight: number, amount: number }> = {};
    
    entriesToday.forEach(e => {
        if (e.priceMode !== priceMode) return;
        
        const prod = productsList.find(p => p.productName === e.productName);
        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
        
        if (!data[e.delegateName]) {
            data[e.delegateName] = { count: 0, weight: 0, amount: 0 };
        }
        
        // Simplified approach: just count entries for now as invoice grouping is complex.
    });
    return data;
  };

  // Re-thinking invoice counting:
  const getGroupedSales = (priceMode: 'retail' | 'wholesale') => {
      const grouped = entriesToday.filter(e => e.priceMode === priceMode);
      const delegates: Record<string, { invoices: Set<string>, weight: number, amount: number }> = {};
      
      const REQUIRED_DELEGATES = ["ناجي خلف", "خلدون جمال", "محمد جاسم", "بكر بدران", "فيصل فؤاد", "صباح فرحان"];
      REQUIRED_DELEGATES.forEach(name => {
          delegates[name] = { invoices: new Set(), weight: 0, amount: 0 };
      });

      grouped.forEach(e => {
          const name = e.delegateName.trim();
          if (!delegates[name]) {
              delegates[name] = { invoices: new Set(), weight: 0, amount: 0 };
          }
          const invKey = `${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`;
          delegates[name].invoices.add(invKey);
          delegates[name].weight += (e.totalWeightKg || 0);
          
          const prod = productsList.find(p => p.productName === e.productName);
          const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
          delegates[name].amount += (price * (e.quantity || 0));
      });
      
      return Object.entries(delegates).map(([name, data]) => ({
          name,
          count: data.invoices.size,
          weight: data.weight,
          amount: data.amount
      }));
  };

  const retailSales = useMemo(() => getGroupedSales('retail'), [entriesToday, productsList]);
  const wholesaleSales = useMemo(() => getGroupedSales('wholesale'), [entriesToday, productsList]);

  const getAllSales = () => {
      const delegates: Record<string, { invoices: Set<string>, weight: number, amount: number }> = {};
      
      const REQUIRED_DELEGATES = ["ناجي خلف", "خلدون جمال", "محمد جاسم", "بكر بدران", "فيصل فؤاد", "صباح فرحان"];
      REQUIRED_DELEGATES.forEach(name => {
          delegates[name] = { invoices: new Set(), weight: 0, amount: 0 };
      });

      entriesToday.forEach(e => {
          const name = e.delegateName.trim();
          if (!delegates[name]) {
              delegates[name] = { invoices: new Set(), weight: 0, amount: 0 };
          }
          const invKey = `${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`;
          delegates[name].invoices.add(invKey);
          delegates[name].weight += (e.totalWeightKg || 0);
          
          const prod = productsList.find(p => p.productName === e.productName);
          const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
          delegates[name].amount += (price * (e.quantity || 0));
      });
      
      return Object.entries(delegates).map(([name, data]) => ({
          name,
          count: data.invoices.size,
          weight: data.weight,
          amount: data.amount
      }));
  };

  const allSales = useMemo(() => getAllSales(), [entriesToday, productsList]);

  const totalRetail = useMemo(() => retailSales.reduce((acc, s) => ({ weight: acc.weight + s.weight, amount: acc.amount + s.amount }), { weight: 0, amount: 0 }), [retailSales]);
  const totalWholesale = useMemo(() => wholesaleSales.reduce((acc, s) => ({ weight: acc.weight + s.weight, amount: acc.amount + s.amount }), { weight: 0, amount: 0 }), [wholesaleSales]);

  return (
    <div className="space-y-3 sm:space-y-4 px-0 sm:px-2 py-1.5 sm:py-4 w-full max-w-5xl mx-auto">
        {/* Three Daily Sales Tables Container for Image Export (Retail + Wholesale + All) */}
        <div 
          ref={threeTablesCaptureRef} 
          id="daily-three-reports-container"
          className="space-y-3 sm:space-y-4 p-1 sm:p-5 bg-slate-900 rounded-xl sm:rounded-2xl border border-slate-800 shadow-xl w-full"
        >
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-3 bg-slate-800/90 p-2 sm:p-4 rounded-xl border border-slate-700 shadow-md">
                <div>
                    <h3 className="font-black text-white text-sm sm:text-lg flex items-center gap-1.5 sm:gap-2">
                        <span>📊 تقرير مبيعات اليوم الشامل</span>
                        <span className="text-xs sm:text-sm font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/30">
                            مفرد + جملة + الكل
                        </span>
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 font-bold mt-0.5 sm:mt-1">
                        التاريخ: {today}
                    </p>
                </div>
                <div className="no-export w-full sm:w-auto flex justify-end">
                    <button 
                      onClick={() => setReportActionModal({
                        isOpen: true,
                        target: 'main',
                        title: 'تقرير مبيعات اليوم الشامل (مفرد + جملة + الكل)'
                      })} 
                      disabled={isDownloading === 'main'} 
                      className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-1.5 px-3 sm:py-2 sm:px-4 rounded-xl shadow-lg transition-all text-xs cursor-pointer active:scale-95 disabled:opacity-60" 
                      title="خيارات تصدير ومشاركة تقرير المبيعات"
                    >
                        {isDownloading === 'main' ? (
                          <span className="animate-spin">⏳</span>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        )}
                        <span>{isDownloading === 'main' ? 'جاري تجهيز الصورة...' : 'تحميل التقرير'}</span>
                    </button>
                </div>
            </div>

            {/* 1. Retail Sales Table */}
            <div className="bg-slate-800 rounded-xl p-1.5 sm:p-4 text-white shadow-lg border border-slate-700/60 w-full">
            <h3 className="font-black mb-1.5 sm:mb-3 text-sm sm:text-base text-emerald-400 flex items-center gap-1.5">
                <span>🛒</span>
                <span>جدول مبيعات المفرد (لليوم)</span>
            </h3>
            <div className="overflow-x-auto w-full">
            <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                <thead>
                    <tr className="border-b border-white/30 text-white bg-slate-900/80 font-black">
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">المندوب</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">عدد الفواتير</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">الوزن (كجم)</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {retailSales.map(s => (
                        <tr key={s.name} className="border-b border-white/20 hover:bg-slate-700/50 font-bold">
                            <td className="py-2 px-1.5 sm:p-2.5 font-black border border-white/20">{s.name}</td>
                            <td className={`py-2 px-1.5 sm:p-2.5 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(1)), true)}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-white/40 bg-slate-900 font-black text-xs sm:text-sm">
                        <td className="py-2 px-1.5 sm:p-2.5 text-emerald-300 border border-white/30">إجمالي المفرد</td>
                        <td className={`py-2 px-1.5 sm:p-2.5 border border-white/30 ${retailSales.reduce((sum, s) => sum + s.count, 0) < 1 ? 'text-red-400' : ''}`}>{retailSales.reduce((sum, s) => sum + s.count, 0)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(Number(totalRetail.weight.toFixed(1)), true)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(totalRetail.amount, true)}</td>
                    </tr>
                </tbody>
            </table>
            </div>
        </div>

        {/* 2. Wholesale Sales Table */}
        <div className="bg-slate-800 rounded-xl p-1.5 sm:p-4 text-white shadow-lg border border-slate-700/60 w-full">
            <h3 className="font-black mb-1.5 sm:mb-3 text-sm sm:text-base text-indigo-400 flex items-center gap-1.5">
                <span>📦</span>
                <span>جدول مبيعات الجملة (لليوم)</span>
            </h3>
            <div className="overflow-x-auto w-full">
            <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                <thead>
                    <tr className="border-b border-white/30 text-white bg-slate-900/80 font-black">
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">المندوب</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">عدد الفواتير</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">الوزن (كجم)</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {wholesaleSales.map(s => (
                        <tr key={s.name} className="border-b border-white/20 hover:bg-slate-700/50 font-bold">
                            <td className="py-2 px-1.5 sm:p-2.5 font-black border border-white/20">{s.name}</td>
                            <td className={`py-2 px-1.5 sm:p-2.5 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(1)), true)}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-white/40 bg-slate-900 font-black text-xs sm:text-sm">
                        <td className="py-2 px-1.5 sm:p-2.5 text-indigo-300 border border-white/30">إجمالي الجملة</td>
                        <td className={`py-2 px-1.5 sm:p-2.5 border border-white/30 ${wholesaleSales.reduce((sum, s) => sum + s.count, 0) < 1 ? 'text-red-400' : ''}`}>{wholesaleSales.reduce((sum, s) => sum + s.count, 0)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(Number(totalWholesale.weight.toFixed(1)), true)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(totalWholesale.amount, true)}</td>
                    </tr>
                </tbody>
            </table>
            </div>
        </div>

        {/* 3. All Sales Summary Table */}
        <div className="bg-amber-950/70 border border-amber-600/60 rounded-xl p-1.5 sm:p-4 text-white shadow-lg w-full">
            <h3 className="font-black mb-1.5 sm:mb-3 text-sm sm:text-base text-amber-400 flex items-center gap-1.5">
                <span>🏆</span>
                <span>جدول مبيعات الكل (مفرد + جملة)</span>
            </h3>
            <div className="overflow-x-auto w-full">
            <table className="w-full min-w-full text-xs sm:text-sm font-bold text-center border-collapse border border-white/30">
                <thead>
                    <tr className="border-b border-white/30 text-amber-200 bg-amber-900/60 font-black">
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">المندوب</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">إجمالي الفواتير</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">إجمالي الوزن (كجم)</th>
                        <th className="py-1.5 px-1.5 sm:p-2.5 border border-white/30">إجمالي المبلغ</th>
                    </tr>
                </thead>
                <tbody>
                    {allSales.map(s => (
                        <tr key={s.name} className="border-b border-white/20 hover:bg-amber-800/40 font-bold">
                            <td className={`py-2 px-1.5 sm:p-2.5 font-black border border-white/20 ${completedDelegates[s.name] ? 'text-yellow-400' : ''}`}>{s.name}</td>
                            <td className={`py-2 px-1.5 sm:p-2.5 font-black border border-white/20 ${s.count < 1 ? 'text-red-400' : ''}`}>{s.count}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-bold border border-white/20">{formatWithCommas(Number(s.weight.toFixed(1)), true)}</td>
                            <td className="py-2 px-1.5 sm:p-2.5 font-black border border-white/20">{formatWithCommas(s.amount, true)}</td>
                        </tr>
                    ))}
                    <tr className="border-t-2 border-white/40 bg-amber-950 font-black text-amber-300 text-xs sm:text-sm">
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">الإجمالي الكلي</td>
                        <td className={`py-2 px-1.5 sm:p-2.5 border border-white/30 ${allSales.reduce((sum, s) => sum + s.count, 0) < 1 ? 'text-red-400' : ''}`}>{allSales.reduce((sum, s) => sum + s.count, 0)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(Number(allSales.reduce((sum, s) => sum + s.weight, 0).toFixed(1)), true)}</td>
                        <td className="py-2 px-1.5 sm:p-2.5 border border-white/30">{formatWithCommas(allSales.reduce((sum, s) => sum + s.amount, 0), true)}</td>
                    </tr>
                </tbody>
            </table>
            </div>
        </div>
        </div>
        
        {/* Specific Categories Sales Table & Summary */}
        {currentUser.isAdmin && (
        <div className="space-y-3 sm:space-y-4 w-full">
            {currentUser.isAdmin && (
            <button 
              onClick={() => setReportActionModal({
                isOpen: true,
                target: 'products',
                title: 'تقرير مبيعات أصناف مختارة (المجمع)'
              })} 
              disabled={isDownloading === 'products'} 
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 px-3 rounded-lg shadow-md transition-all text-xs cursor-pointer active:scale-95 disabled:opacity-60" 
              title="خيارات تصدير ومشاركة التقرير المجمع"
            >
                {isDownloading === 'products' ? (
                  <span className="animate-spin">⏳</span>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                )}
                <span>{isDownloading === 'products' ? 'جاري تجهيز الصورة...' : 'تحميل التقرير المجمع'}</span>
            </button>
            )}
            
            <div className="space-y-3 sm:space-y-4 bg-slate-900 p-1 sm:p-3 rounded-xl w-full" ref={combinedReportRef}>
                <div className="bg-indigo-900 rounded-xl p-1 sm:p-4 text-white w-full">
                    <h3 className="font-bold mb-2 text-xs sm:text-sm">مبيعات أصناف مختارة (مفرد/جملة)</h3>
                <div className="overflow-x-auto w-full">
                <table className="w-full min-w-[340px] sm:min-w-full text-[11px] sm:text-xs text-center border-collapse">
                    <thead>
                        <tr className="border-b border-indigo-700 text-indigo-300">
                            <th className="py-1 px-1 sm:p-2" rowSpan={2}>الصنف</th>
                            <th className="py-1 px-1 sm:p-2" colSpan={2}>مفرد</th>
                            <th className="py-1 px-1 sm:p-2" colSpan={2}>جملة</th>
                        </tr>
                        <tr className="border-b border-indigo-700 text-indigo-400">
                            <th className="py-1 px-0.5">وزن</th>
                            <th className="py-1 px-0.5">مبلغ</th>
                            <th className="py-1 px-0.5">وزن</th>
                            <th className="py-1 px-0.5">مبلغ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            const categories = ['صوصج', 'جبن بيتزا', 'بيتزا جاهز وبركر ومقرمش', 'خضراوات مجمدة و فنكر'];
                            const stats = categories.map(catName => {
                                const getStats = (mode: 'retail' | 'wholesale') => {
                                    const entries = entriesToday.filter(e => e.categoryName === catName && e.priceMode === mode);
                                    const weight = entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                                    const amount = entries.reduce((sum, e) => {
                                        const prod = productsList.find(p => p.productName === e.productName);
                                        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                                        return sum + (price * e.quantity);
                                    }, 0);
                                    return { weight, amount };
                                };
                                return { name: catName, retail: getStats('retail'), wholesale: getStats('wholesale') };
                            });

                            const totals = stats.reduce((acc, curr) => ({
                                retailWeight: acc.retailWeight + curr.retail.weight,
                                retailAmount: acc.retailAmount + curr.retail.amount,
                                wholesaleWeight: acc.wholesaleWeight + curr.wholesale.weight,
                                wholesaleAmount: acc.wholesaleAmount + curr.wholesale.amount
                            }), { retailWeight: 0, retailAmount: 0, wholesaleWeight: 0, wholesaleAmount: 0 });

                            return (
                                <>
                                    {stats.map(s => (
                                        <tr key={s.name} className="border-b border-indigo-800">
                                            <td className="py-1.5 px-1 sm:p-2 font-bold">{s.name}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(s.retail.weight.toFixed(1)), true)}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(s.retail.amount, true)}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(s.wholesale.weight.toFixed(1)), true)}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(s.wholesale.amount, true)}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-t-2 border-indigo-600 bg-indigo-950 font-black">
                                        <td className="py-1.5 px-1 sm:p-2">General</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(totals.retailWeight.toFixed(1)), true)}</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(totals.retailAmount, true)}</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(totals.wholesaleWeight.toFixed(1)), true)}</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(totals.wholesaleAmount, true)}</td>
                                    </tr>
                                </>
                            );
                        })()}
                    </tbody>
                </table>
                </div>
                </div>

                {/* Category Summary Table (Combined) */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-1 sm:p-4 text-white w-full">
                    <h3 className="font-bold mb-2 text-xs sm:text-sm">مجموع (مفرد + جملة) لكل صنف</h3>
                <div className="overflow-x-auto w-full">
                <table className="w-full min-w-full text-[11px] sm:text-xs text-center border-collapse">
                    <thead>
                        <tr className="border-b border-slate-700 text-slate-300">
                            <th className="py-1 px-1 sm:p-2">الصنف</th>
                            <th className="py-1 px-1 sm:p-2">إجمالي الوزن (كجم)</th>
                            <th className="py-1 px-1 sm:p-2">إجمالي المبلغ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(() => {
                            const categories = ['صوصج', 'جبن بيتزا', 'بيتزا جاهز وبركر ومقرمش', 'خضراوات مجمدة و فنكر'];
                            const stats = categories.map(catName => {
                                const getStats = (mode: 'retail' | 'wholesale') => {
                                    const entries = entriesToday.filter(e => e.categoryName === catName && e.priceMode === mode);
                                    const weight = entries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                                    const amount = entries.reduce((sum, e) => {
                                        const prod = productsList.find(p => p.productName === e.productName);
                                        const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                                        return sum + (price * e.quantity);
                                    }, 0);
                                    return { weight, amount };
                                };
                                const retail = getStats('retail');
                                const wholesale = getStats('wholesale');
                                return { name: catName, totalWeight: retail.weight + wholesale.weight, totalAmount: retail.amount + wholesale.amount };
                            });
                            
                            const grandTotal = stats.reduce((acc, curr) => ({
                                weight: acc.weight + curr.totalWeight,
                                amount: acc.amount + curr.totalAmount
                            }), { weight: 0, amount: 0 });

                            return (
                                <>
                                    {stats.map(s => (
                                        <tr key={s.name} className="border-b border-slate-700">
                                            <td className="py-1.5 px-1 sm:p-2 font-bold">{s.name}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(s.totalWeight.toFixed(1)), true)}</td>
                                            <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(s.totalAmount, true)}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-t-2 border-slate-600 bg-slate-950 font-black">
                                        <td className="py-1.5 px-1 sm:p-2">General</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(Number(grandTotal.weight.toFixed(1)), true)}</td>
                                        <td className="py-1.5 px-1 sm:p-2">{formatWithCommas(grandTotal.amount, true)}</td>
                                    </tr>
                                </>
                            );
                        })()}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
        </div>
        )}

      {/* Floating Action Feedback */}
      {actionFeedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5 rounded-2xl bg-slate-900/95 text-white border border-emerald-500/60 shadow-2xl flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-3 duration-200 backdrop-blur-sm">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Report Action Modal (Share or Download Image) */}
      {reportActionModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => {
            if (!isProcessingAction) setReportActionModal(null);
          }}
        >
          <div 
            className={`p-5 sm:p-6 rounded-3xl shadow-2xl w-full max-w-md border text-right space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-white">
                    خيارات تصدير ومشاركة التقرير
                  </h3>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">
                    {reportActionModal.title}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setReportActionModal(null)} 
                disabled={!!isProcessingAction}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                title="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
              اختر الإجراء المطلوب للتقرير:
            </p>

            {/* The Two Options */}
            <div className="space-y-3">
              {/* Option 1: Share report to social media apps (including WhatsApp) */}
              <button
                type="button"
                disabled={!!isProcessingAction}
                onClick={async () => {
                  setIsProcessingAction('share');
                  if (reportActionModal.target === 'main') {
                    await handleDownload('share');
                  } else {
                    await handleDownloadProducts('share');
                  }
                  setIsProcessingAction(null);
                  setReportActionModal(null);
                }}
                className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 text-right cursor-pointer group active:scale-[0.98] ${
                  isProcessingAction === 'share'
                    ? 'bg-emerald-500/15 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'border-emerald-500/30 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                    {isProcessingAction === 'share' ? (
                      <span className="animate-spin text-base">⏳</span>
                    ) : (
                      <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="font-black text-xs sm:text-sm text-emerald-900 dark:text-emerald-300">
                      مشاركة التقرير إلى برامج التواصل الاجتماعي (منها واتساب)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                      إرسال صورة التقرير مباشرة إلى واتساب، التليجرام أو التطبيقات الأخرى
                    </div>
                  </div>
                </div>
                <span className="text-emerald-600 dark:text-emerald-400 font-black text-base shrink-0">←</span>
              </button>

              {/* Option 2: Download report as image */}
              <button
                type="button"
                disabled={!!isProcessingAction}
                onClick={async () => {
                  setIsProcessingAction('download');
                  if (reportActionModal.target === 'main') {
                    await handleDownload('download');
                  } else {
                    await handleDownloadProducts('download');
                  }
                  setIsProcessingAction(null);
                  setReportActionModal(null);
                }}
                className={`w-full p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 text-right cursor-pointer group active:scale-[0.98] ${
                  isProcessingAction === 'download'
                    ? 'bg-blue-500/15 border-blue-500 ring-2 ring-blue-500/20'
                    : 'border-blue-500/30 hover:border-blue-500 bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/20 dark:hover:bg-blue-950/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                    {isProcessingAction === 'download' ? (
                      <span className="animate-spin text-base">⏳</span>
                    ) : (
                      <Download className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="font-black text-xs sm:text-sm text-blue-900 dark:text-blue-300">
                      تحميل التقرير كصورة
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">
                      تنزيل وحفظ ملف صورة التقرير بجودة عالية على جهازك
                    </div>
                  </div>
                </div>
                <span className="text-blue-600 dark:text-blue-400 font-black text-base shrink-0">←</span>
              </button>
            </div>

            {/* Cancel button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={!!isProcessingAction}
                onClick={() => setReportActionModal(null)}
                className="w-full py-2.5 px-4 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const ReportsScreen: React.FC = () => {
  // Added state for Sales History move
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const reportRef = useRef<HTMLDivElement>(null);

  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  
  const handleDownload = async () => {
    if (reportRef.current) {
      try {
        setIsDownloading('main');
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 500));
        const canvas = await html2canvas(reportRef.current, {
          backgroundColor: '#f1f5f9', // Soft light gray (الرصاصي الخافت)
          scale: 2,
          useCORS: true,
          onclone: (clonedDoc) => {
            sanitizeModernColors(clonedDoc, '#f1f5f9');
            const tables = clonedDoc.querySelectorAll('table');
            tables.forEach(t => {
              const tableEl = t as HTMLTableElement;
              tableEl.style.borderCollapse = 'collapse';
              tableEl.style.border = '2px solid #64748b';
              tableEl.style.textAlign = 'center';
              tableEl.style.backgroundColor = '#ffffff';
            });
            const theadRows = clonedDoc.querySelectorAll('thead tr, thead th');
            theadRows.forEach(el => {
              (el as HTMLElement).style.backgroundColor = '#e2e8f0';
              (el as HTMLElement).style.color = '#0f172a';
            });
            const rows = clonedDoc.querySelectorAll('tr');
            rows.forEach(r => {
              (r as HTMLElement).style.verticalAlign = 'middle';
            });
            const cells = clonedDoc.querySelectorAll('th, td');
            cells.forEach(c => {
              const cell = c as HTMLElement;
              cell.style.border = '1px solid #94a3b8';
              cell.style.textAlign = 'center';
              cell.style.verticalAlign = 'middle';
              cell.style.lineHeight = '1.25';
              cell.style.color = '#0f172a';
              cell.style.padding = '14px 10px';
              cell.style.fontWeight = 'bold';
              if (cell.tagName.toLowerCase() === 'th') {
                cell.style.fontSize = '21px';
                cell.style.backgroundColor = '#e2e8f0';
              } else {
                cell.style.fontSize = '20px';
                cell.style.backgroundColor = '#ffffff';
              }
            });
            const cellContents = clonedDoc.querySelectorAll('th *, td *');
            cellContents.forEach(child => {
              const htmlChild = child as HTMLElement;
              htmlChild.style.verticalAlign = 'middle';
              htmlChild.style.fontSize = 'inherit';
              htmlChild.style.fontWeight = 'bold';
              htmlChild.style.lineHeight = 'inherit';
              htmlChild.style.margin = '0';
              htmlChild.style.color = '#0f172a';
            });
            const textEls = clonedDoc.querySelectorAll('h3, p, span, div');
            textEls.forEach(el => {
              const htmlEl = el as HTMLElement;
              htmlEl.style.color = '#0f172a';
              htmlEl.style.fontWeight = 'bold';
            });
            const headings = clonedDoc.querySelectorAll('h3');
            headings.forEach(h => {
              const htmlH = h as HTMLElement;
              htmlH.style.fontSize = '25px';
              htmlH.style.fontWeight = 'bold';
            });
            const paragraphs = clonedDoc.querySelectorAll('p');
            paragraphs.forEach(p => {
              const htmlP = p as HTMLElement;
              htmlP.style.fontSize = '19px';
              htmlP.style.fontWeight = 'bold';
            });
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach(el => {
              (el as HTMLElement).style.fontWeight = 'bold';
            });
          }
        });
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const link = document.createElement('a');
        link.download = `تقرير-شامل-${new Date().toLocaleDateString('ar-EG')}.jpg`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        console.error("html2canvas error:", error);
      } finally {
        setIsDownloading(null);
      }
    }
  };
  const [savedEntriesFilterDelegate, setSavedEntriesFilterDelegate] = useState<string>('الكل');
  const [savedEntriesFilterPriceMode, setSavedEntriesFilterPriceMode] = useState<'الكل' | 'retail' | 'wholesale'>('الكل');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    productName: string;
    categoryName: string;
    quantity: string;
    pieceWeightKg: string;
  }>({
    productName: '',
    categoryName: '',
    quantity: '0',
    pieceWeightKg: '0',
  });

  const {
    currentUser,
    selectedDelegate,
    setSelectedDelegate,
    categoryReports,
    delegatesList,
    selectedDate,
    setSelectedDate,
    dailyEvaluationsHistory,
    salesEntries,
    delegateTargets,
    syncData,
    updateSalesEntry,
    deleteSalesEntry,
    setUserMessage,
    isDarkMode, // Added
    productsList, // Added
    allSalesEntries, // Added for carton & shop calculations
  } = useSales();

  const [completedDelegates, setCompletedDelegates] = useState<Record<string, boolean>>({});
  const [completedDelegatesList, setCompletedDelegatesList] = useState<{ delegate: string, completedAt: string }[]>([]);
  const [showCompletionConfirmModal, setShowCompletionConfirmModal] = useState(false);

  // Auto-lock closing time (default 15:00 / 3:00 PM) & real-time clock tick
  const [targetAutoLockTime, setTargetAutoLockTime] = useState<string>('15:00');
  const [timeTick, setTimeTick] = useState<number>(Date.now());

  // Real-time listener for configurable auto_lock_time setting
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'auto_lock_time'),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data()?.time) {
          setTargetAutoLockTime(docSnap.data().time);
        }
      },
      (err) => {
        console.error('Error listening to auto_lock_time in ReportsScreen:', err);
      }
    );
    return () => unsub();
  }, []);

  // Timer tick every 10 seconds to update closing time trigger in real-time
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Format targetAutoLockTime for Arabic display (e.g. 15:00 -> 03:00 م)
  const formattedTargetTime = useMemo(() => {
    try {
      const [hStr, mStr] = targetAutoLockTime.split(':');
      let h = parseInt(hStr || '15', 10);
      const m = mStr || '00';
      const ampm = h >= 12 ? 'م' : 'ص';
      h = h % 12;
      h = h ? h : 12;
      return `${h.toString().padStart(2, '0')}:${m} ${ampm}`;
    } catch {
      return '03:00 م';
    }
  }, [targetAutoLockTime]);

  // Current Baghdad date info & whether official closing time has been reached
  const isPastClosing = useMemo(() => {
    try {
      const now = new Date();
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baghdad',
        hour12: false,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
      const parts = timeFormatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);

      const currentSeconds = hour * 3600 + minute * 60 + second;

      const [hStr, mStr] = targetAutoLockTime.split(':');
      const targetHours = parseInt(hStr || '15', 10);
      const targetMinutes = parseInt(mStr || '00', 10);
      const targetSeconds = targetHours * 3600 + targetMinutes * 60;

      return currentSeconds >= targetSeconds;
    } catch {
      return false;
    }
  }, [targetAutoLockTime, timeTick]);

  const [showActivationModal, setShowActivationModal] = useState(false);
  const [selectedActivationDelegates, setSelectedActivationDelegates] = useState<Record<string, boolean>>({});

  // Monthly Item Targets & Sales State from Admin Excel Upload
  const [monthlyItemTargets, setMonthlyItemTargets] = useState<MonthlyItemTarget[]>([]);
  const [delegateIncentives, setDelegateIncentives] = useState<DelegateIncentive[]>([]);
  const [extraTargetsList, setExtraTargetsList] = useState<DelegateMonthlyExtraTargets[]>([]);
  const [showEditExtraTargetsModal, setShowEditExtraTargetsModal] = useState(false);
  const [editExtraTargetDelegate, setEditExtraTargetDelegate] = useState('');
  const [editMonthlyIqdTarget, setEditMonthlyIqdTarget] = useState('');
  const [editTargetShopsCount, setEditTargetShopsCount] = useState('');
  const [editExtraProductName, setEditExtraProductName] = useState('');
  const [editExtraProductCustomersTarget, setEditExtraProductCustomersTarget] = useState('');
  const [isSavingExtraTargets, setIsSavingExtraTargets] = useState(false);
  const [isUploadingMonthlyExcel, setIsUploadingMonthlyExcel] = useState(false);
  const [monthlyUploadMessage, setMonthlyUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const monthlyExcelInputRef = useRef<HTMLInputElement>(null);

  // Specific Product Tracking State (Before Total Incentives)
  const [specificProductName, setSpecificProductName] = useState<string>('جبن اماه 200 غم');
  const [tempSpecificProductName, setTempSpecificProductName] = useState<string>('جبن اماه 200 غم');
  const [isEditingSpecificProductName, setIsEditingSpecificProductName] = useState<boolean>(false);
  const [isSavingSpecificProductName, setIsSavingSpecificProductName] = useState<boolean>(false);
  const [specificProductTargets, setSpecificProductTargets] = useState<SpecificProductTarget[]>([]);
  const [isUploadingSpecificProductExcel, setIsUploadingSpecificProductExcel] = useState<boolean>(false);
  const [specificProductUploadMessage, setSpecificProductUploadMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const specificProductExcelInputRef = useRef<HTMLInputElement>(null);
  const [showAdminSpecificBreakdown, setShowAdminSpecificBreakdown] = useState<boolean>(false);

  // Manual Edit Modal State for Specific Product
  const [showEditSpecificProductModal, setShowEditSpecificProductModal] = useState<boolean>(false);
  const [editSpecificProductDelegate, setEditSpecificProductDelegate] = useState<string>('');
  const [editSpecificTargetPieces, setEditSpecificTargetPieces] = useState<string>('');
  const [editSpecificSalesPieces, setEditSpecificSalesPieces] = useState<string>('');
  const [editSpecificTargetCartons, setEditSpecificTargetCartons] = useState<string>('');
  const [editSpecificSalesCartons, setEditSpecificSalesCartons] = useState<string>('');
  const [editSpecificTargetShops, setEditSpecificTargetShops] = useState<string>('');
  const [editSpecificActualShops, setEditSpecificActualShops] = useState<string>('');
  const [isSavingSpecificProductModal, setIsSavingSpecificProductModal] = useState<boolean>(false);

  // Subscribe to monthly_item_targets collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'monthly_item_targets'),
      (snapshot) => {
        const list: MonthlyItemTarget[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as MonthlyItemTarget;
          if (data) {
            list.push({ ...data, id: docSnap.id });
          }
        });
        setMonthlyItemTargets(list);
      },
      (err) => {
        console.error('Error fetching monthly_item_targets:', err);
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to delegate_incentives collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'delegate_incentives'),
      (snapshot) => {
        const list: DelegateIncentive[] = [];
        const myNorm = normalizeText(currentUser.name || '');
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as DelegateIncentive;
          if (data) {
            // For admin, load all delegates. For delegate, strictly load ONLY their own incentives!
            if (currentUser.isAdmin) {
              list.push({ ...data, id: docSnap.id });
            } else {
              const dNorm = normalizeText(data.delegateName || '');
              if (
                dNorm === myNorm ||
                data.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()
              ) {
                list.push({ ...data, id: docSnap.id });
              }
            }
          }
        });
        setDelegateIncentives(list);
      },
      (err) => {
        console.error('Error fetching delegate_incentives:', err);
      }
    );
    return () => unsub();
  }, [currentUser.isAdmin, currentUser.name]);

  // Subscribe to delegate_monthly_extra_targets collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'delegate_monthly_extra_targets'),
      (snapshot) => {
        const list: DelegateMonthlyExtraTargets[] = [];
        const myNorm = normalizeText(currentUser.name || '');
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as DelegateMonthlyExtraTargets;
          if (data) {
            if (currentUser.isAdmin) {
              list.push({ ...data, id: docSnap.id });
            } else {
              const dNorm = normalizeText(data.delegateName || '');
              if (
                dNorm === myNorm ||
                data.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()
              ) {
                list.push({ ...data, id: docSnap.id });
              }
            }
          }
        });
        setExtraTargetsList(list);
      },
      (err) => {
        console.error('Error fetching delegate_monthly_extra_targets:', err);
      }
    );
    return () => unsub();
  }, [currentUser.isAdmin, currentUser.name]);

  // Subscribe to specific_product_config in app_settings (Admin product specification)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'app_settings', 'specific_product_config'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data?.productName) {
            setSpecificProductName(data.productName);
            setTempSpecificProductName(data.productName);
          }
        }
      },
      (err) => {
        console.error('Error fetching specific_product_config:', err);
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to specific_product_targets collection in Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'specific_product_targets'),
      (snapshot) => {
        const list: SpecificProductTarget[] = [];
        const myNorm = normalizeText(currentUser.name || '');
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as SpecificProductTarget;
          if (data) {
            if (currentUser.isAdmin) {
              list.push({ ...data, id: docSnap.id });
            } else {
              const dNorm = normalizeText(data.delegateName || '');
              if (
                dNorm === myNorm ||
                data.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()
              ) {
                list.push({ ...data, id: docSnap.id });
              }
            }
          }
        });
        setSpecificProductTargets(list);
      },
      (err) => {
        console.error('Error fetching specific_product_targets:', err);
      }
    );
    return () => unsub();
  }, [currentUser.isAdmin, currentUser.name]);

  // Helper function to resolve category monthly targets and sales
  // Takes into account Representative View vs Admin View
  const getMonthlyCategoryStats = (categoryName: string) => {
    const trimmedCat = (categoryName || '').trim();
    const normCat = normalizeText(trimmedCat);

    // Filter relevant targets based on category
    const catMatches = monthlyItemTargets.filter((t) => {
      const tNorm = normalizeText(t.categoryName || '');
      return tNorm === normCat || (t.categoryName || '').trim().toLowerCase() === trimmedCat.toLowerCase();
    });

    // 1. Representative View:
    // When a representative logs into their account, display their specific targets & sales
    if (!currentUser.isAdmin) {
      const repNorm = normalizeText(currentUser.name || '');
      const match = catMatches.find((t) => {
        const dNorm = normalizeText(t.delegateName || '');
        return dNorm === repNorm || (t.delegateName || '').trim().toLowerCase() === (currentUser.name || '').trim().toLowerCase();
      });
      const monthlyTarget = match ? Number(match.monthlyTarget) || 0 : 0;
      const monthlySales = match ? Number(match.monthlySales) || 0 : 0;
      const percentage = monthlyTarget > 0 ? (monthlySales / monthlyTarget) * 100 : 0;
      const remaining = monthlyTarget > monthlySales ? monthlyTarget - monthlySales : 0;
      return { monthlyTarget, monthlySales, percentage, remaining, hasData: !!match };
    }

    // 2. Admin View with specific representative selected in the filter:
    if (selectedDelegate && selectedDelegate !== 'الكل' && selectedDelegate !== 'الأدمن') {
      const selNorm = normalizeText(selectedDelegate);
      const match = catMatches.find((t) => {
        const dNorm = normalizeText(t.delegateName || '');
        return dNorm === selNorm || (t.delegateName || '').trim().toLowerCase() === selectedDelegate.trim().toLowerCase();
      });
      const monthlyTarget = match ? Number(match.monthlyTarget) || 0 : 0;
      const monthlySales = match ? Number(match.monthlySales) || 0 : 0;
      const percentage = monthlyTarget > 0 ? (monthlySales / monthlyTarget) * 100 : 0;
      const remaining = monthlyTarget > monthlySales ? monthlyTarget - monthlySales : 0;
      return { monthlyTarget, monthlySales, percentage, remaining, hasData: !!match };
    }

    // 3. Admin View (default):
    // Aggregate and sum up both the total monthly targets and total monthly sales across ALL representatives for each item
    const monthlyTarget = catMatches.reduce((sum, item) => sum + (Number(item.monthlyTarget) || 0), 0);
    const monthlySales = catMatches.reduce((sum, item) => sum + (Number(item.monthlySales) || 0), 0);
    const percentage = monthlyTarget > 0 ? (monthlySales / monthlyTarget) * 100 : 0;
    const remaining = monthlyTarget > monthlySales ? monthlyTarget - monthlySales : 0;
    return { monthlyTarget, monthlySales, percentage, remaining, hasData: catMatches.length > 0 };
  };

  // Admin Excel Upload Functionality for Monthly Item Targets
  const handleMonthlyExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingMonthlyExcel(true);
      setMonthlyUploadMessage(null);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });

      if (!jsonData || jsonData.length === 0) {
        setMonthlyUploadMessage({ text: 'ملف الإكسل فارغ أو غير صالح!', type: 'error' });
        return;
      }

      const batch = writeBatch(db);
      let count = 0;
      const delegateIncentiveMap: Record<string, number> = {};
      const delegateExtraTargetsMap: Record<string, Partial<DelegateMonthlyExtraTargets>> = {};

      jsonData.forEach((row: any) => {
        const rawCategory = (
          row['الصنف'] ||
          row['اسم الصنف'] ||
          row['المادة'] ||
          row['المنتج'] ||
          row['Category'] ||
          row['category'] ||
          row['categoryName'] ||
          row['Item'] ||
          row['itemName'] ||
          row['Item Name'] ||
          ''
        ).toString().trim();

        const rawDelegate = (
          row['اسم المندوب'] ||
          row['المندوب'] ||
          row['مندوب'] ||
          row['Representative'] ||
          row['delegate'] ||
          row['delegateName'] ||
          row['Rep'] ||
          ''
        ).toString().trim();

        const rawTarget =
          row['التاركت الشهري'] ??
          row['الهدف الشهري'] ??
          row['تاركت شهري'] ??
          row['التارجت الشهري'] ??
          row['التاركت'] ??
          row['Monthly Target'] ??
          row['MonthlyTarget'] ??
          row['monthlyTarget'] ??
          row['target'] ??
          0;

        const rawSales =
          row['المبيعات لحد الآن'] ??
          row['المبيعات الشهرية'] ??
          row['مبيعات الشهر'] ??
          row['المبيعات'] ??
          row['Monthly Sales'] ??
          row['MonthlySales'] ??
          row['monthlySales'] ??
          row['sales'] ??
          0;

        // Check for incentives in the row
        const rawIncentive =
          row['الحوافز لحد الان'] ??
          row['الحوافز لحد الآن'] ??
          row['الحوافز الكلية لحد الان'] ??
          row['الحوافز الكلية لحد الآن'] ??
          row['الحوافز الكلية'] ??
          row['الحوافز'] ??
          row['حوافز'] ??
          row['حوافز المندوب'] ??
          row['Incentives'] ??
          row['Incentive'] ??
          row['incentives'] ??
          null;

        // Extra monthly targets
        const rawIqdTarget =
          row['تاركت ديناري شهري'] ??
          row['تاركت ديناري'] ??
          row['الهدف الديناري'] ??
          null;
        const rawIqdSales =
          row['مبيعات ديناري شهري'] ??
          row['مبيعات ديناري'] ??
          row['المبيعات النقدية'] ??
          row['المبيعات الدينارية'] ??
          null;
        const rawShopsTarget =
          row['مطلوب تبيع لعدد محلات'] ??
          row['تاركت المحلات'] ??
          row['تاركت محلات'] ??
          null;
        const rawShopsActual =
          row['تم بيع لعدد محلات'] ??
          row['محلات تم البيع لها'] ??
          row['عدد المحلات الفعلي'] ??
          null;
        const rawExtraProdName =
          row['اسم المنتج الاضافي'] ??
          row['المنتج الاضافي'] ??
          row['اسم المنتج الإضافي'] ??
          null;
        const rawExtraCustTarget =
          row['تاركت زبائن شهري'] ??
          row['تاركت زبائن المنتج الاضافي'] ??
          row['تاركت زبائن المنتج الإضافي'] ??
          null;
        const rawExtraCustActual =
          row['تم بيع لهم'] ??
          row['زبائن تم البيع لهم'] ??
          row['تم بيع لهم (زبائن)'] ??
          null;

        if (!rawDelegate) return;

        // Normalize delegate against delegatesList if possible
        const normDel = normalizeText(rawDelegate);
        const matchedDel = delegatesList.find(
          (d) => normalizeText(d) === normDel || d.trim().toLowerCase() === rawDelegate.toLowerCase()
        ) || rawDelegate;

        if (rawIncentive !== null && rawIncentive !== undefined && String(rawIncentive).trim() !== '') {
          const incVal = parseFloat(String(rawIncentive).replace(/,/g, '').trim());
          if (!isNaN(incVal)) {
            delegateIncentiveMap[matchedDel] = incVal;
          }
        }

        if (
          rawIqdTarget !== null ||
          rawIqdSales !== null ||
          rawShopsTarget !== null ||
          rawShopsActual !== null ||
          rawExtraProdName !== null ||
          rawExtraCustTarget !== null ||
          rawExtraCustActual !== null
        ) {
          if (!delegateExtraTargetsMap[matchedDel]) {
            delegateExtraTargetsMap[matchedDel] = {};
          }
          const existingExtra = extraTargetsList.find(
            (t) => normalizeText(t.delegateName || '') === normDel || (t.delegateName || '').trim().toLowerCase() === matchedDel.toLowerCase()
          );

          if (rawIqdTarget !== null && String(rawIqdTarget).trim() !== '') {
            const v = parseFloat(String(rawIqdTarget).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].monthlyIqdTarget = v;
          } else if (existingExtra?.monthlyIqdTarget !== undefined) {
            delegateExtraTargetsMap[matchedDel].monthlyIqdTarget = existingExtra.monthlyIqdTarget;
          }

          if (rawIqdSales !== null && String(rawIqdSales).trim() !== '') {
            const v = parseFloat(String(rawIqdSales).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].monthlyIqdSalesOverride = v;
          } else if (existingExtra?.monthlyIqdSalesOverride !== undefined) {
            delegateExtraTargetsMap[matchedDel].monthlyIqdSalesOverride = existingExtra.monthlyIqdSalesOverride;
          }

          if (rawShopsTarget !== null && String(rawShopsTarget).trim() !== '') {
            const v = parseFloat(String(rawShopsTarget).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].targetShopsCount = v;
          } else if (existingExtra?.targetShopsCount !== undefined) {
            delegateExtraTargetsMap[matchedDel].targetShopsCount = existingExtra.targetShopsCount;
          }

          if (rawShopsActual !== null && String(rawShopsActual).trim() !== '') {
            const v = parseFloat(String(rawShopsActual).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].actualShopsCountOverride = v;
          } else if (existingExtra?.actualShopsCountOverride !== undefined) {
            delegateExtraTargetsMap[matchedDel].actualShopsCountOverride = existingExtra.actualShopsCountOverride;
          }

          if (rawExtraProdName !== null && String(rawExtraProdName).trim() !== '') {
            delegateExtraTargetsMap[matchedDel].extraProductName = String(rawExtraProdName).trim();
          } else if (existingExtra?.extraProductName !== undefined) {
            delegateExtraTargetsMap[matchedDel].extraProductName = existingExtra.extraProductName;
          }

          if (rawExtraCustTarget !== null && String(rawExtraCustTarget).trim() !== '') {
            const v = parseFloat(String(rawExtraCustTarget).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].extraProductCustomersTarget = v;
          } else if (existingExtra?.extraProductCustomersTarget !== undefined) {
            delegateExtraTargetsMap[matchedDel].extraProductCustomersTarget = existingExtra.extraProductCustomersTarget;
          }

          if (rawExtraCustActual !== null && String(rawExtraCustActual).trim() !== '') {
            const v = parseFloat(String(rawExtraCustActual).replace(/,/g, '').trim());
            if (!isNaN(v)) delegateExtraTargetsMap[matchedDel].extraProductCustomersActualOverride = v;
          } else if (existingExtra?.extraProductCustomersActualOverride !== undefined) {
            delegateExtraTargetsMap[matchedDel].extraProductCustomersActualOverride = existingExtra.extraProductCustomersActualOverride;
          }
        }

        if (!rawCategory) return;

        // Normalize category against DEFAULT_CATEGORIES_LIST if possible
        const normCat = normalizeText(rawCategory);
        const matchedCat = DEFAULT_CATEGORIES_LIST.find(
          (c) => normalizeText(c) === normCat || c.trim().toLowerCase() === rawCategory.toLowerCase()
        ) || rawCategory;

        // Look up existing saved target for this delegate and category to preserve values if missing in new file
        const existingTargetObj = monthlyItemTargets.find(
          (t) =>
            (normalizeText(t.delegateName || '') === normDel || (t.delegateName || '').trim().toLowerCase() === matchedDel.toLowerCase()) &&
            (normalizeText(t.categoryName || '') === normCat || (t.categoryName || '').trim().toLowerCase() === matchedCat.toLowerCase())
        );

        let monthlyTarget: number;
        if (rawTarget !== null && rawTarget !== undefined && String(rawTarget).trim() !== '') {
          const parsed = parseFloat(String(rawTarget).replace(/,/g, '').trim());
          monthlyTarget = !isNaN(parsed) ? parsed : (existingTargetObj ? existingTargetObj.monthlyTarget : 0);
        } else {
          monthlyTarget = existingTargetObj ? existingTargetObj.monthlyTarget : 0;
        }

        let monthlySales: number;
        if (rawSales !== null && rawSales !== undefined && String(rawSales).trim() !== '') {
          const parsed = parseFloat(String(rawSales).replace(/,/g, '').trim());
          monthlySales = !isNaN(parsed) ? parsed : (existingTargetObj ? existingTargetObj.monthlySales : 0);
        } else {
          monthlySales = existingTargetObj ? existingTargetObj.monthlySales : 0;
        }

        const docKey = `${matchedDel}_${matchedCat}`.replace(/[\/\s#$[\]]/g, '_');
        const docRef = doc(db, 'monthly_item_targets', docKey);

        batch.set(
          docRef,
          {
            categoryName: matchedCat,
            delegateName: matchedDel,
            monthlyTarget,
            monthlySales,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.name || 'الأدمن',
          },
          { merge: true }
        );
        count++;
      });

      // Also check other sheets in workbook for delegate incentives
      workbook.SheetNames.forEach((sheetName) => {
        try {
          const ws = workbook.Sheets[sheetName];
          const sheetRows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
          sheetRows.forEach((r: any) => {
            const rDel = (
              r['اسم المندوب'] ||
              r['المندوب'] ||
              r['مندوب'] ||
              r['Representative'] ||
              r['delegate'] ||
              ''
            ).toString().trim();
            const rInc =
              r['الحوافز لحد الان'] ??
              r['الحوافز لحد الآن'] ??
              r['الحوافز الكلية لحد الان'] ??
              r['الحوافز الكلية لحد الآن'] ??
              r['الحوافز الكلية'] ??
              r['الحوافز'] ??
              r['حوافز'] ??
              r['Incentives'] ??
              null;
            if (rDel && rInc !== null && rInc !== undefined && String(rInc).trim() !== '') {
              const normD = normalizeText(rDel);
              const matchedD = delegatesList.find(
                (d) => normalizeText(d) === normD || d.trim().toLowerCase() === rDel.toLowerCase()
              ) || rDel;
              const incVal = parseFloat(String(rInc).replace(/,/g, '').trim());
              if (!isNaN(incVal)) {
                delegateIncentiveMap[matchedD] = incVal;
              }
            }
          });
        } catch (e) {}
      });

      // Save delegate incentives to Firestore
      let incentivesCount = 0;
      Object.entries(delegateIncentiveMap).forEach(([delName, amount]) => {
        const incDocKey = `del_${delName}`.replace(/[\/\s#$[\]]/g, '_');
        const incDocRef = doc(db, 'delegate_incentives', incDocKey);
        batch.set(
          incDocRef,
          {
            delegateName: delName,
            incentivesAmount: amount,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.name || 'الأدمن',
          },
          { merge: true }
        );
        incentivesCount++;
      });

      // Save delegate extra targets to Firestore
      Object.entries(delegateExtraTargetsMap).forEach(([delName, extraData]) => {
        const extraDocKey = `del_${delName}`.replace(/[\/\s#$[\]]/g, '_');
        const extraDocRef = doc(db, 'delegate_monthly_extra_targets', extraDocKey);
        batch.set(
          extraDocRef,
          {
            delegateName: delName,
            ...extraData,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.name || 'الأدمن',
          },
          { merge: true }
        );
      });

      if (count === 0 && incentivesCount === 0) {
        setMonthlyUploadMessage({
          text: 'لم يتم العثور على سجلات صالحة. تأكد من توفر الأعمدة: (اسم الصنف، اسم المندوب، التاركت الشهري، المبيعات لحد الآن، أو الحوافز لحد الان)',
          type: 'error',
        });
        return;
      }

      await batch.commit();
      let successMsg = `تم تحديث بيانات التاركت والمبيعات الشهرية بنجاح (${count} سجل)`;
      if (incentivesCount > 0) {
        successMsg += ` مع حوافز (${incentivesCount}) من المندوبين ✅`;
      } else {
        successMsg += ` ✅`;
      }
      setMonthlyUploadMessage({
        text: successMsg,
        type: 'success',
      });

      setTimeout(() => {
        setMonthlyUploadMessage(null);
      }, 7000);
    } catch (err: any) {
      console.error('Error uploading monthly targets excel:', err);
      setMonthlyUploadMessage({
        text: `حدث خطأ أثناء معالجة ملف الإكسل: ${err.message || 'خطأ غير معروف'}`,
        type: 'error',
      });
    } finally {
      setIsUploadingMonthlyExcel(false);
      if (e.target) e.target.value = '';
    }
  };

  // Helper to download Excel template for all delegates and categories
  const handleDownloadMonthlyTemplate = () => {
    try {
      const rows: any[] = [];
      const validDelegates = delegatesList.filter((d) => d !== 'الكل' && d !== 'الأدمن');

      validDelegates.forEach((del) => {
        const normDel = normalizeText(del);
        const existingIncentive = delegateIncentives.find(
          (inc) =>
            normalizeText(inc.delegateName || '') === normDel || inc.delegateName === del
        )?.incentivesAmount || 0;

        const existingExtra = extraTargetsList.find(
          (t) => normalizeText(t.delegateName || '') === normDel || t.delegateName === del
        );

        DEFAULT_CATEGORIES_LIST.forEach((cat) => {
          const normCat = normalizeText(cat);
          const existing = monthlyItemTargets.find(
            (m) =>
              (normalizeText(m.delegateName || '') === normDel || m.delegateName === del) &&
              (normalizeText(m.categoryName || '') === normCat || m.categoryName === cat)
          );

          rows.push({
            'اسم المندوب': del,
            'الصنف': cat,
            'التاركت الشهري': existing ? existing.monthlyTarget : 0,
            'المبيعات لحد الآن': existing ? existing.monthlySales : 0,
            'الحوافز الكلية لحد الان': existingIncentive,
            'تاركت ديناري شهري': existingExtra?.monthlyIqdTarget || 0,
            'مبيعات ديناري شهري': existingExtra?.monthlyIqdSalesOverride || 0,
            'مطلوب تبيع لعدد محلات': existingExtra?.targetShopsCount || 0,
            'تم بيع لعدد محلات': existingExtra?.actualShopsCountOverride || 0,
            'اسم المنتج الاضافي': existingExtra?.extraProductName || 'جبن مثلثات',
            'تاركت زبائن شهري': existingExtra?.extraProductCustomersTarget || 0,
            'تم بيع لهم': existingExtra?.extraProductCustomersActualOverride || 0,
          });
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'تاركت_وحوافز_المندوبين');
      XLSX.writeFile(
        workbook,
        `نموذج_تاركت_وحوافز_المندوبين_${new Date().toISOString().split('T')[0]}.xlsx`
      );
    } catch (err) {
      console.error('Error downloading template:', err);
    }
  };

  const handleOpenActivationModal = () => {
    const initial: Record<string, boolean> = {};
    delegatesList.forEach(del => {
      initial[del] = !!completedDelegates[del];
    });
    setSelectedActivationDelegates(initial);
    setShowActivationModal(true);
  };

  const handleSaveActivation = async () => {
    const today = new Date().toISOString().split('T')[0];
    try {
      for (const del of delegatesList) {
        const docRef = doc(db, 'daily_sales_completion', del);
        if (selectedActivationDelegates[del]) {
          await setDoc(docRef, {
            delegate: del,
            date: today,
            completedAt: new Date().toISOString(),
          }, { merge: true });
        } else {
          await deleteDoc(docRef);
        }
      }
      setUserMessage('تم تحديث حالة تفعيل مبيعات المندوبين بنجاح ✅');
      setShowActivationModal(false);
    } catch (err) {
      console.error("Error updating activation:", err);
      setUserMessage('حدث خطأ أثناء حفظ حالة التفعيل.');
    }
  };

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'daily_sales_completion'), where('date', '==', today));
    const unsub = onSnapshot(q, (snap) => {
      const completed: Record<string, boolean> = {};
      const list: { delegate: string, completedAt: string }[] = [];
      snap.forEach(d => {
        completed[d.id] = true;
        const data = d.data();
        if (data.delegate && data.completedAt) {
          list.push({ delegate: data.delegate, completedAt: data.completedAt });
        }
      });
      list.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
      setCompletedDelegates(completed);
      setCompletedDelegatesList(list);
    });
    return () => unsub();
  }, []);

  // Active representative for extra targets (Delegate view or Admin selection)
  const activeExtraRep = currentUser.isAdmin
    ? (selectedDelegate === 'الكل' || selectedDelegate === 'الأدمن' ? '' : selectedDelegate)
    : currentUser.name;

  // Current month string (YYYY-MM)
  const currentMonthStr = selectedDate ? selectedDate.substring(0, 7) : new Date().toISOString().substring(0, 7);

  // Valid delegates list excluding 'الكل' and 'الأدمن'
  const validDelegatesList = useMemo(
    () => delegatesList.filter((d) => d !== 'الكل' && d !== 'الأدمن'),
    [delegatesList]
  );

  // Extra Targets Stats Calculation: Single delegate for rep, Total sum of all delegates for admin
  const extraTargetsStats = useMemo(() => {
    // 1. Single Delegate View (Representative view OR Admin viewing a specific delegate)
    if (activeExtraRep) {
      const repNorm = normalizeText(activeExtraRep);
      const targetRecord = extraTargetsList.find(
        (t) => normalizeText(t.delegateName || '') === repNorm || t.delegateName === activeExtraRep
      );

      const repSales = salesEntries.filter((s) => {
        const sMonth = (s.dateString || '').substring(0, 7);
        if (sMonth !== currentMonthStr) return false;
        const sNorm = normalizeText(s.delegateName || '');
        return sNorm === repNorm || s.delegateName === activeExtraRep;
      });

      // Target IQD
      const iqdTarget = targetRecord?.monthlyIqdTarget || 0;
      const calcIqd = repSales.reduce((acc, s) => {
        const prod = productsList.find((p) => p.productName === s.productName);
        const price = prod ? (s.priceMode === 'wholesale' ? prod.wholesalePrice || 0 : prod.retailPrice || 0) : 0;
        return acc + price * s.quantity;
      }, 0);
      const iqdSales =
        targetRecord?.monthlyIqdSalesOverride !== undefined && targetRecord.monthlyIqdSalesOverride > 0
          ? targetRecord.monthlyIqdSalesOverride
          : calcIqd;
      const iqdPct = iqdTarget > 0 ? (iqdSales / iqdTarget) * 100 : 0;

      // Shops
      const shopsTarget = targetRecord?.targetShopsCount || 0;
      const uniqueShops = new Set(
        repSales
          .map((s) => (s.customerName || s.customerCode || '').trim())
          .filter((name) => name.length > 0)
      );
      const shopsActual =
        targetRecord?.actualShopsCountOverride !== undefined && targetRecord.actualShopsCountOverride > 0
          ? targetRecord.actualShopsCountOverride
          : uniqueShops.size;
      const shopsPct = shopsTarget > 0 ? (shopsActual / shopsTarget) * 100 : 0;

      // Extra Product
      const extraProdName = targetRecord?.extraProductName || 'جبن مثلثات';
      const extraCustTarget = targetRecord?.extraProductCustomersTarget || 0;
      const extraCustSet = new Set(
        repSales
          .filter((s) => {
            const pNorm = normalizeText(s.productName || '');
            const cNorm = normalizeText(s.categoryName || '');
            const targetNorm = normalizeText(extraProdName);
            return (
              pNorm === targetNorm ||
              cNorm === targetNorm ||
              s.productName?.trim().toLowerCase() === extraProdName.trim().toLowerCase() ||
              s.categoryName?.trim().toLowerCase() === extraProdName.trim().toLowerCase()
            );
          })
          .map((s) => (s.customerName || s.customerCode || '').trim())
          .filter((name) => name.length > 0)
      );
      const extraCustActual =
        targetRecord?.extraProductCustomersActualOverride !== undefined &&
        targetRecord.extraProductCustomersActualOverride > 0
          ? targetRecord.extraProductCustomersActualOverride
          : extraCustSet.size;
      const extraCustPct = extraCustTarget > 0 ? (extraCustActual / extraCustTarget) * 100 : 0;

      return {
        title: `الأهداف والمبيعات التراكمية الإضافية (${activeExtraRep})`,
        isTotal: false,
        iqdTarget,
        iqdSales,
        iqdPct,
        shopsTarget,
        shopsActual,
        shopsPct,
        extraProdName,
        extraCustTarget,
        extraCustActual,
        extraCustPct,
      };
    }

    // 2. Admin Total View (مجموع جميع المندوبين)
    let sumIqdTarget = 0;
    let sumIqdSales = 0;
    let sumShopsTarget = 0;
    let sumShopsActual = 0;
    let sumExtraCustTarget = 0;
    let sumExtraCustActual = 0;
    let commonExtraProdName = 'جبن مثلثات';

    const configured = extraTargetsList.find((t) => t.extraProductName)?.extraProductName;
    if (configured) commonExtraProdName = configured;

    validDelegatesList.forEach((del) => {
      const dNorm = normalizeText(del);
      const targetRecord = extraTargetsList.find(
        (t) => normalizeText(t.delegateName || '') === dNorm || t.delegateName === del
      );

      const delSales = salesEntries.filter((s) => {
        const sMonth = (s.dateString || '').substring(0, 7);
        if (sMonth !== currentMonthStr) return false;
        const sNorm = normalizeText(s.delegateName || '');
        return sNorm === dNorm || s.delegateName === del;
      });

      // Target IQD
      sumIqdTarget += targetRecord?.monthlyIqdTarget || 0;
      const calcIqd = delSales.reduce((acc, s) => {
        const prod = productsList.find((p) => p.productName === s.productName);
        const price = prod ? (s.priceMode === 'wholesale' ? prod.wholesalePrice || 0 : prod.retailPrice || 0) : 0;
        return acc + price * s.quantity;
      }, 0);
      const iqdSales =
        targetRecord?.monthlyIqdSalesOverride !== undefined && targetRecord.monthlyIqdSalesOverride > 0
          ? targetRecord.monthlyIqdSalesOverride
          : calcIqd;
      sumIqdSales += iqdSales;

      // Shops
      sumShopsTarget += targetRecord?.targetShopsCount || 0;
      const uniqueShops = new Set(
        delSales
          .map((s) => (s.customerName || s.customerCode || '').trim())
          .filter((name) => name.length > 0)
      );
      const shopsActual =
        targetRecord?.actualShopsCountOverride !== undefined && targetRecord.actualShopsCountOverride > 0
          ? targetRecord.actualShopsCountOverride
          : uniqueShops.size;
      sumShopsActual += shopsActual;

      // Extra Product
      const prodName = targetRecord?.extraProductName || commonExtraProdName;
      sumExtraCustTarget += targetRecord?.extraProductCustomersTarget || 0;
      const extraCustSet = new Set(
        delSales
          .filter((s) => {
            const pNorm = normalizeText(s.productName || '');
            const cNorm = normalizeText(s.categoryName || '');
            const targetNorm = normalizeText(prodName);
            return (
              pNorm === targetNorm ||
              cNorm === targetNorm ||
              s.productName?.trim().toLowerCase() === prodName.trim().toLowerCase() ||
              s.categoryName?.trim().toLowerCase() === prodName.trim().toLowerCase()
            );
          })
          .map((s) => (s.customerName || s.customerCode || '').trim())
          .filter((name) => name.length > 0)
      );
      const extraCustActual =
        targetRecord?.extraProductCustomersActualOverride !== undefined &&
        targetRecord.extraProductCustomersActualOverride > 0
          ? targetRecord.extraProductCustomersActualOverride
          : extraCustSet.size;
      sumExtraCustActual += extraCustActual;
    });

    const iqdPct = sumIqdTarget > 0 ? (sumIqdSales / sumIqdTarget) * 100 : 0;
    const shopsPct = sumShopsTarget > 0 ? (sumShopsActual / sumShopsTarget) * 100 : 0;
    const extraCustPct = sumExtraCustTarget > 0 ? (sumExtraCustActual / sumExtraCustTarget) * 100 : 0;

    return {
      title: 'الأهداف والمبيعات التراكمية الإضافية (الإجمالي العام)',
      isTotal: true,
      iqdTarget: sumIqdTarget,
      iqdSales: sumIqdSales,
      iqdPct,
      shopsTarget: sumShopsTarget,
      shopsActual: sumShopsActual,
      shopsPct,
      extraProdName: commonExtraProdName,
      extraCustTarget: sumExtraCustTarget,
      extraCustActual: sumExtraCustActual,
      extraCustPct,
    };
  }, [
    activeExtraRep,
    extraTargetsList,
    salesEntries,
    currentMonthStr,
    validDelegatesList,
    productsList,
  ]);

  // Save extra targets from Admin modal
  const handleSaveExtraTargets = async () => {
    if (!editExtraTargetDelegate) return;
    try {
      setIsSavingExtraTargets(true);
      const docKey = `del_${editExtraTargetDelegate}`.replace(/[\/\s#$[\]]/g, '_');
      await setDoc(
        doc(db, 'delegate_monthly_extra_targets', docKey),
        {
          delegateName: editExtraTargetDelegate,
          monthlyIqdTarget: parseFloat(editMonthlyIqdTarget.replace(/,/g, '')) || 0,
          targetShopsCount: parseFloat(editTargetShopsCount.replace(/,/g, '')) || 0,
          extraProductName: editExtraProductName.trim() || 'جبن مثلثات',
          extraProductCustomersTarget: parseFloat(editExtraProductCustomersTarget.replace(/,/g, '')) || 0,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name || 'الأدمن',
        },
        { merge: true }
      );
      setShowEditExtraTargetsModal(false);
      setUserMessage('تم حفظ أهداف المندوب الشهرية بنجاح ✅');
    } catch (err) {
      console.error('Error saving extra targets:', err);
      setUserMessage('حدث خطأ أثناء حفظ الأهداف.');
    } finally {
      setIsSavingExtraTargets(false);
    }
  };

  // --- Specific Product Tracking Handlers & Calculations ---

  // Admin save specified product name
  const handleSaveSpecificProductName = async () => {
    const cleanName = tempSpecificProductName.trim();
    if (!cleanName) return;
    try {
      setIsSavingSpecificProductName(true);
      await setDoc(
        doc(db, 'app_settings', 'specific_product_config'),
        {
          productName: cleanName,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name || 'الأدمن',
        },
        { merge: true }
      );
      setSpecificProductName(cleanName);
      setIsEditingSpecificProductName(false);
      setUserMessage(`تم تعيين وحفظ المنتج المخصص (${cleanName}) بنجاح لكافة المندوبين ✅`);
    } catch (e) {
      console.error('Error saving specific product name:', e);
      setUserMessage('حدث خطأ أثناء حفظ اسم المنتج المخصص.');
    } finally {
      setIsSavingSpecificProductName(false);
    }
  };

  // Dedicated Excel upload for Specific Product Section
  // Replaces all previous data with the newly uploaded file's data (no accumulation or merging with previous files)
  const handleSpecificProductExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingSpecificProductExcel(true);
      setSpecificProductUploadMessage(null);
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });

      if (!jsonData || jsonData.length === 0) {
        setSpecificProductUploadMessage({ text: 'ملف الإكسل فارغ أو غير صالح!', type: 'error' });
        return;
      }

      // 1. Wipe out all previous records so only the newly uploaded file data is kept & displayed
      const existingSnap = await getDocs(collection(db, 'specific_product_targets'));
      if (!existingSnap.empty) {
        const deleteBatch = writeBatch(db);
        existingSnap.forEach((docSnap) => {
          deleteBatch.delete(docSnap.ref);
        });
        await deleteBatch.commit();
      }

      // Check if file specifies a product name in any of the rows
      let detectedProductName = '';
      for (const row of jsonData) {
        const rawP = (row['اسم المنتج'] || row['اسم الصنف'] || row['الصنف'] || row['المنتج'] || row['Product'] || row['Item'] || '').toString().trim();
        if (rawP) {
          detectedProductName = rawP;
          break;
        }
      }

      const activeProdName = detectedProductName || specificProductName;

      if (detectedProductName && detectedProductName !== specificProductName) {
        setSpecificProductName(detectedProductName);
        setTempSpecificProductName(detectedProductName);
        await setDoc(
          doc(db, 'specific_product_config', 'current'),
          {
            productName: detectedProductName,
            updatedAt: new Date().toISOString(),
            updatedBy: currentUser.name || 'الأدمن',
          },
          { merge: true }
        );
      }

      const matchedProd = productsList.find(
        (p) => normalizeText(p.productName) === normalizeText(activeProdName) || p.productName === activeProdName
      );
      const cartonQty = matchedProd?.cartonQuantity ? Number(matchedProd.cartonQuantity) : 0;

      const batch = writeBatch(db);
      let count = 0;
      const seenDelegates = new Set<string>();

      jsonData.forEach((row: any) => {
        const rawDelegate = (
          row['اسم المندوب'] ||
          row['المندوب'] ||
          row['مندوب'] ||
          row['Representative'] ||
          row['delegate'] ||
          row['delegateName'] ||
          row['اسم الموظف'] ||
          row['الموظف'] ||
          ''
        ).toString().trim();

        if (!rawDelegate) return;

        const normDel = normalizeText(rawDelegate);
        const matchedDel = delegatesList.find(
          (d) => normalizeText(d) === normDel || d.trim().toLowerCase() === rawDelegate.toLowerCase()
        ) || rawDelegate;

        if (seenDelegates.has(matchedDel)) return;
        seenDelegates.add(matchedDel);

        const rawProd = (row['اسم المنتج'] || row['اسم الصنف'] || row['الصنف'] || row['المنتج'] || row['Product'] || '').toString().trim();
        const rowProdName = rawProd || activeProdName;

        const rawTargetPieces =
          row['تاركت الصنف (قطعة)'] ??
          row['تاركت الصنف (قطع)'] ??
          row['تاركت المنتج (قطعة)'] ??
          row['تاركت القطعة'] ??
          row['تاركت القطع'] ??
          row['التاركت بالقطعة'] ??
          row['تاركت قطعة'] ??
          row['تاركت قطع'] ??
          row['هدف القطع'] ??
          row['هدف الصنف (قطعة)'] ??
          row['Target Pieces'] ??
          row['targetPieces'] ??
          null;

        const rawSalesPieces =
          row['مبيعات الصنف (قطعة)'] ??
          row['مبيعات الصنف (قطع)'] ??
          row['مبيعات المنتج (قطعة)'] ??
          row['مبيعات القطعة'] ??
          row['مبيعات القطع'] ??
          row['المبيعات بالقطعة'] ??
          row['مبيعات قطعة'] ??
          row['مبيعات قطع'] ??
          row['المبيعات قطعة'] ??
          row['مبيعات الصنف'] ??
          row['Sales Pieces'] ??
          row['salesPieces'] ??
          null;

        const rawTargetCartons =
          row['تاركت المنتج (كارتون)'] ??
          row['تاركت الصنف (كارتون)'] ??
          row['تاركت الكارتون'] ??
          row['التاركت بالكارتون'] ??
          row['تاركت المنتج'] ??
          row['تاركت كارتون'] ??
          row['تاركت الكراتين'] ??
          row['هدف الكراتين'] ??
          row['التاركت'] ??
          row['Target Cartons'] ??
          null;

        const rawSalesCartons =
          row['مبيعات المنتج (كارتون)'] ??
          row['مبيعات الصنف (كارتون)'] ??
          row['مبيعات الكارتون'] ??
          row['المبيعات بالكارتون'] ??
          row['مبيعات المنتج'] ??
          row['مبيعات كارتون'] ??
          row['مبيعات الكراتين'] ??
          row['المبيعات'] ??
          row['Sales Cartons'] ??
          null;

        const rawTargetShops =
          row['مطلوب تبيع لعدد محلات'] ??
          row['تاركت المحلات'] ??
          row['هدف المحلات'] ??
          row['تاركت تغطية المحلات'] ??
          row['مطلوب محلات'] ??
          row['عدد المحلات المستهدفة'] ??
          row['محلات مستهدفة'] ??
          row['تاركت محلات'] ??
          row['Target Shops'] ??
          null;

        const rawActualShops =
          row['تم بيع لعدد محلات'] ??
          row['محلات تم البيع لها'] ??
          row['عدد المحلات المباع لها'] ??
          row['عدد المحلات'] ??
          row['المحلات المباع لها'] ??
          row['تم البيع لمحلات'] ??
          row['محلات مباع لها'] ??
          row['تغطية المحلات'] ??
          row['Actual Shops'] ??
          null;

        let targetPieces: number = 0;
        let targetCartons: number = 0;

        if (rawTargetPieces !== null && String(rawTargetPieces).trim() !== '') {
          const v = parseFloat(String(rawTargetPieces).replace(/,/g, '').trim());
          targetPieces = !isNaN(v) ? v : 0;
        }
        if (rawTargetCartons !== null && String(rawTargetCartons).trim() !== '') {
          const v = parseFloat(String(rawTargetCartons).replace(/,/g, '').trim());
          targetCartons = !isNaN(v) ? v : 0;
        }

        if (targetPieces > 0 && targetCartons === 0 && cartonQty > 0) {
          targetCartons = parseFloat((targetPieces / cartonQty).toFixed(1));
        } else if (targetCartons > 0 && targetPieces === 0 && cartonQty > 0) {
          targetPieces = Math.round(targetCartons * cartonQty);
        }

        let salesPiecesOverride: number = 0;
        let salesCartonsOverride: number = 0;

        if (rawSalesPieces !== null && String(rawSalesPieces).trim() !== '') {
          const v = parseFloat(String(rawSalesPieces).replace(/,/g, '').trim());
          salesPiecesOverride = !isNaN(v) ? v : 0;
        }
        if (rawSalesCartons !== null && String(rawSalesCartons).trim() !== '') {
          const v = parseFloat(String(rawSalesCartons).replace(/,/g, '').trim());
          salesCartonsOverride = !isNaN(v) ? v : 0;
        }

        if (salesPiecesOverride > 0 && salesCartonsOverride === 0 && cartonQty > 0) {
          salesCartonsOverride = parseFloat((salesPiecesOverride / cartonQty).toFixed(1));
        } else if (salesCartonsOverride > 0 && salesPiecesOverride === 0 && cartonQty > 0) {
          salesPiecesOverride = Math.round(salesCartonsOverride * cartonQty);
        }

        let targetShops: number = 0;
        if (rawTargetShops !== null && String(rawTargetShops).trim() !== '') {
          const v = parseFloat(String(rawTargetShops).replace(/,/g, '').trim());
          targetShops = !isNaN(v) ? v : 0;
        }

        let actualShopsOverride: number = 0;
        if (rawActualShops !== null && String(rawActualShops).trim() !== '') {
          const v = parseFloat(String(rawActualShops).replace(/,/g, '').trim());
          actualShopsOverride = !isNaN(v) ? v : 0;
        }

        const docKey = `del_${matchedDel}`.replace(/[\/\s#$[\]]/g, '_');
        const docRef = doc(db, 'specific_product_targets', docKey);

        // Save fresh document without merging old file values
        batch.set(docRef, {
          delegateName: matchedDel,
          productName: rowProdName,
          targetPieces,
          salesPiecesOverride,
          targetCartons,
          salesCartonsOverride,
          targetShops,
          actualShopsOverride,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name || 'الأدمن',
        });
        count++;
      });

      if (count === 0) {
        setSpecificProductUploadMessage({
          text: 'لم يتم العثور على سجلات صالحة في ملف الإكسل.',
          type: 'error',
        });
        return;
      }

      await batch.commit();
      setSpecificProductUploadMessage({
        text: `تم استبدال وعرض بيانات الملف الجديد بنجاح لـ (${count}) مندوب ✅ (دون دمج أو تجميع من الملفات السابقة)`,
        type: 'success',
      });
      setUserMessage(`تم عرض بيانات ملف الإكسل الجديد لـ (${count}) مندوب بنجاح ✅`);

      setTimeout(() => {
        setSpecificProductUploadMessage(null);
      }, 7000);
    } catch (err: any) {
      console.error('Error uploading specific product excel:', err);
      setSpecificProductUploadMessage({
        text: `حدث خطأ أثناء معالجة ملف الإكسل: ${err.message || 'خطأ غير معروف'}`,
        type: 'error',
      });
    } finally {
      setIsUploadingSpecificProductExcel(false);
      if (e.target) e.target.value = '';
    }
  };

  // Clear / Reset all specific product targets from Firestore
  const handleClearSpecificProductData = async () => {
    if (!window.confirm('هل أنت متأكد من مسح وتفريغ كافة بيانات ملف الإكسل للصنف المحدد؟')) return;
    try {
      const existingSnap = await getDocs(collection(db, 'specific_product_targets'));
      if (!existingSnap.empty) {
        const deleteBatch = writeBatch(db);
        existingSnap.forEach((docSnap) => {
          deleteBatch.delete(docSnap.ref);
        });
        await deleteBatch.commit();
      }
      setSpecificProductTargets([]);
      setUserMessage('تم مسح وتفريغ بيانات الصنف المحدد بنجاح ✅');
    } catch (err: any) {
      console.error('Error clearing specific product targets:', err);
      setUserMessage('حدث خطأ أثناء مسح البيانات.');
    }
  };

  // Dedicated template download for Specific Product Section
  const handleDownloadSpecificProductTemplate = () => {
    try {
      const validDelegates = delegatesList.filter((d) => d !== 'الكل' && d !== 'الأدمن');
      const rows: any[] = [];
      const matchedProd = productsList.find(
        (p) => normalizeText(p.productName) === normalizeText(specificProductName) || p.productName === specificProductName
      );
      const cartonQty = matchedProd?.cartonQuantity ? Number(matchedProd.cartonQuantity) : 0;

      validDelegates.forEach((del) => {
        const normDel = normalizeText(del);
        const existingRecord = specificProductTargets.find(
          (t) => normalizeText(t.delegateName || '') === normDel || t.delegateName === del
        );

        const currentTargetPieces = existingRecord?.targetPieces ?? (existingRecord?.targetCartons && cartonQty > 0 ? Math.round(existingRecord.targetCartons * cartonQty) : 0);
        const currentSalesPieces = existingRecord?.salesPiecesOverride ?? (existingRecord?.salesCartonsOverride && cartonQty > 0 ? Math.round(existingRecord.salesCartonsOverride * cartonQty) : 0);

        rows.push({
          'اسم المندوب': del,
          'اسم المنتج': existingRecord?.productName || specificProductName,
          'تاركت الصنف (قطعة)': currentTargetPieces,
          'مبيعات الصنف (قطعة)': currentSalesPieces,
          'تاركت المنتج (كارتون)': existingRecord ? existingRecord.targetCartons : 0,
          'مبيعات المنتج (كارتون)': existingRecord?.salesCartonsOverride || 0,
          'مطلوب تبيع لعدد محلات': existingRecord ? existingRecord.targetShops : 0,
          'تم بيع لعدد محلات': existingRecord?.actualShopsOverride || 0,
        });
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'متابعة_المنتج_المخصص');
      XLSX.writeFile(
        workbook,
        `نموذج_المنتج_المخصص_${specificProductName}_${new Date().toISOString().split('T')[0]}.xlsx`
      );
    } catch (err) {
      console.error('Error downloading specific product template:', err);
    }
  };

  // Manual save for Admin modal
  const handleSaveSpecificProductModal = async () => {
    if (!editSpecificProductDelegate) return;
    try {
      setIsSavingSpecificProductModal(true);
      const docKey = `del_${editSpecificProductDelegate}`.replace(/[\/\s#$[\]]/g, '_');
      const targetPiecesVal = parseFloat(editSpecificTargetPieces.replace(/,/g, '')) || 0;
      const salesPiecesVal = parseFloat(editSpecificSalesPieces.replace(/,/g, '')) || 0;
      const targetCartonsVal = parseFloat(editSpecificTargetCartons.replace(/,/g, '')) || 0;
      const salesCartonsVal = parseFloat(editSpecificSalesCartons.replace(/,/g, '')) || 0;

      await setDoc(
        doc(db, 'specific_product_targets', docKey),
        {
          delegateName: editSpecificProductDelegate,
          productName: specificProductName,
          targetPieces: targetPiecesVal,
          salesPiecesOverride: salesPiecesVal,
          targetCartons: targetCartonsVal,
          salesCartonsOverride: salesCartonsVal,
          targetShops: parseFloat(editSpecificTargetShops.replace(/,/g, '')) || 0,
          actualShopsOverride: parseFloat(editSpecificActualShops.replace(/,/g, '')) || 0,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.name || 'الأدمن',
        },
        { merge: true }
      );
      setShowEditSpecificProductModal(false);
      setUserMessage(`تم حفظ أهداف ومبيعات المنتج المخصص للمندوب (${editSpecificProductDelegate}) بنجاح ✅`);
    } catch (err) {
      console.error('Error saving specific product modal:', err);
      setUserMessage('حدث خطأ أثناء حفظ أهداف المنتج المخصص.');
    } finally {
      setIsSavingSpecificProductModal(false);
    }
  };

  const openEditSpecificProduct = (delegateName: string) => {
    setEditSpecificProductDelegate(delegateName);
    const existing = specificProductTargets.find(
      (t) => normalizeText(t.delegateName || '') === normalizeText(delegateName) || t.delegateName === delegateName
    );
    const matchedProd = productsList.find(
      (p) => normalizeText(p.productName) === normalizeText(specificProductName) || p.productName === specificProductName
    );
    const cQty = matchedProd?.cartonQuantity ? Number(matchedProd.cartonQuantity) : 0;

    const tPieces = existing?.targetPieces ?? (existing?.targetCartons && cQty > 0 ? Math.round(existing.targetCartons * cQty) : '');
    const sPieces = existing?.salesPiecesOverride ?? (existing?.salesCartonsOverride && cQty > 0 ? Math.round(existing.salesCartonsOverride * cQty) : '');

    setEditSpecificTargetPieces(tPieces ? String(tPieces) : '');
    setEditSpecificSalesPieces(sPieces ? String(sPieces) : '');
    setEditSpecificTargetCartons(existing ? String(existing.targetCartons || '') : '');
    setEditSpecificSalesCartons(
      existing && existing.salesCartonsOverride !== undefined ? String(existing.salesCartonsOverride) : ''
    );
    setEditSpecificTargetShops(existing ? String(existing.targetShops || '') : '');
    setEditSpecificActualShops(
      existing && existing.actualShopsOverride !== undefined ? String(existing.actualShopsOverride) : ''
    );
    setShowEditSpecificProductModal(true);
  };

  // Metrics Tracked Per Representative & Admin Aggregation (Specific Product)
  // Strictly takes targets, sales, and shops from Excel uploads and Admin records (NOT from app sales entries)
  const specificProductStats = useMemo(() => {
    const normTargetProd = normalizeText(specificProductName);
    const validDelegates = delegatesList.filter((d) => d !== 'الكل' && d !== 'الأدمن');
    const matchedProd = productsList.find(
      (p) => normalizeText(p.productName) === normTargetProd || p.productName === specificProductName
    );
    const cartonQty = matchedProd?.cartonQuantity ? Number(matchedProd.cartonQuantity) : 0;

    const resolveMetrics = (del: string) => {
      const dNorm = normalizeText(del);
      const record = specificProductTargets.find(
        (t) => normalizeText(t.delegateName || '') === dNorm || t.delegateName === del
      );

      // 1. Targets (strictly from Excel / record):
      let targetPieces = record?.targetPieces || 0;
      let targetCartons = record?.targetCartons || 0;

      if (targetPieces === 0 && targetCartons > 0 && cartonQty > 0) {
        targetPieces = Math.round(targetCartons * cartonQty);
      } else if (targetPieces > 0 && targetCartons === 0 && cartonQty > 0) {
        targetCartons = parseFloat((targetPieces / cartonQty).toFixed(1));
      }

      // 2. Sales (strictly from Excel uploaded data - NOT from app sales entries):
      let salesPieces = 0;
      if (record?.salesPiecesOverride !== undefined && record.salesPiecesOverride !== null) {
        salesPieces = record.salesPiecesOverride;
      } else if (record?.salesCartonsOverride !== undefined && record.salesCartonsOverride !== null && cartonQty > 0) {
        salesPieces = Math.round(record.salesCartonsOverride * cartonQty);
      }

      let salesCartons = 0;
      if (record?.salesCartonsOverride !== undefined && record.salesCartonsOverride !== null) {
        salesCartons = record.salesCartonsOverride;
      } else if (cartonQty > 0 && salesPieces > 0) {
        salesCartons = parseFloat((salesPieces / cartonQty).toFixed(1));
      }

      const salesPct = targetPieces > 0 
        ? (salesPieces / targetPieces) * 100 
        : (targetCartons > 0 ? (salesCartons / targetCartons) * 100 : 0);

      // 3. Shops (strictly from Excel uploaded data):
      const targetShops = record?.targetShops || 0;
      const actualShops = record?.actualShopsOverride !== undefined && record.actualShopsOverride !== null
        ? record.actualShopsOverride
        : 0;

      const shopsPct = targetShops > 0 ? (actualShops / targetShops) * 100 : 0;

      return {
        delegateName: del,
        productName: record?.productName || specificProductName,
        targetPieces,
        salesPieces,
        targetCartons,
        salesCartons,
        salesPct,
        targetShops,
        actualShops,
        shopsPct,
      };
    };

    // 1. Representative View (Or Admin filtering a single delegate)
    if (!currentUser.isAdmin || (selectedDelegate !== 'الكل' && selectedDelegate !== 'الأدمن')) {
      const activeRep = !currentUser.isAdmin ? currentUser.name : selectedDelegate;
      const m = resolveMetrics(activeRep);

      return {
        isAggregated: false,
        ...m,
        delegateBreakdown: [],
      };
    }

    // 2. Admin Grand Total View (Aggregated ONLY from records present in the uploaded Excel file)
    let totalTargetPieces = 0;
    let totalSalesPieces = 0;
    let totalTargetCartons = 0;
    let totalSalesCartons = 0;
    let totalTargetShops = 0;
    let totalActualShops = 0;

    // Display and sum ONLY delegates from the uploaded file (no ghost delegates or old files)
    const activeRecords = specificProductTargets;
    const breakdown = activeRecords.map((record) => {
      const m = resolveMetrics(record.delegateName);
      totalTargetPieces += m.targetPieces;
      totalSalesPieces += m.salesPieces;
      totalTargetCartons += m.targetCartons;
      totalSalesCartons += m.salesCartons;
      totalTargetShops += m.targetShops;
      totalActualShops += m.actualShops;
      return m;
    });

    // Sort delegates by sales pieces descending (المندوب أعلى مبيعات بالقطع في أعلى الجدول)
    breakdown.sort((a, b) => {
      if (b.salesPieces !== a.salesPieces) {
        return b.salesPieces - a.salesPieces;
      }
      return b.salesPct - a.salesPct;
    });

    const totalSalesPct = totalTargetPieces > 0 
      ? (totalSalesPieces / totalTargetPieces) * 100 
      : (totalTargetCartons > 0 ? (totalSalesCartons / totalTargetCartons) * 100 : 0);
    const totalShopsPct = totalTargetShops > 0 ? (totalActualShops / totalTargetShops) * 100 : 0;

    return {
      isAggregated: true,
      delegateName: 'الإجمالي العام لكافة المندوبين',
      productName: specificProductName,
      targetPieces: totalTargetPieces,
      salesPieces: totalSalesPieces,
      targetCartons: totalTargetCartons,
      salesCartons: totalSalesCartons,
      salesPct: totalSalesPct,
      targetShops: totalTargetShops,
      actualShops: totalActualShops,
      shopsPct: totalShopsPct,
      delegateBreakdown: breakdown,
    };
  }, [
    currentUser.isAdmin,
    currentUser.name,
    selectedDelegate,
    specificProductName,
    specificProductTargets,
    delegatesList,
    productsList,
  ]);

  const getProductCode = (productName: string) => {
    const p = productsList.find(p => p.productName === productName);
    return p ? p.productCode : '000';
  };

  const handleStartEdit = (entry: any) => {
    setEditingEntryId(entry.id);
    setEditFormData({
      productName: entry.productName,
      categoryName: entry.categoryName,
      quantity: String(entry.quantity),
      pieceWeightKg: String(Math.round(entry.pieceWeightKg * 1000)),
    });
  };

  const handleSaveEdit = (id: string) => {
    const q = parseInt(parseArabicDigits(editFormData.quantity), 10) || 0;
    const wGrams = parseFloat(parseArabicDigits(editFormData.pieceWeightKg)) || 0;
    
    updateSalesEntry(id, {
      productName: editFormData.productName.trim(),
      categoryName: editFormData.categoryName,
      quantity: q,
      pieceWeightKg: wGrams / 1000,
      totalWeightKg: (q * wGrams) / 1000,
    });
    setEditingEntryId(null);
  };

  // Date Range state for custom period reports
  const [startDate, setStartDate] = useState<string>(selectedDate);
  const [endDate, setEndDate] = useState<string>(selectedDate);
  const [useRange, setUseRange] = useState<boolean>(false);

  // Filter saved entries for today
  const todayStr = new Date().toISOString().split('T')[0];
  const todaysEntries = salesEntries.filter(e => e.dateString === todayStr);
  const uniqueCustomerNames = Array.from(new Set(todaysEntries.map(e => e.customerName).filter(Boolean))).sort();
  const achievedCategories = useMemo(() => {
    return categoryReports.filter((r) => r.isAchieved && r.dailyTargetWeightKg > 0);
  }, [categoryReports]);

  // Overall totals
  const activeDelegateName = currentUser.isAdmin ? selectedDelegate : currentUser.name;

  const { modalTotalWeight, modalTotalPrice } = useMemo(() => {
    const delegateEntries = salesEntries.filter(e => e.delegateName === activeDelegateName && e.dateString === new Date().toISOString().split('T')[0]);
    const weight = delegateEntries.reduce((sum, e) => sum + e.totalWeightKg, 0);
    const price = delegateEntries.reduce((sum, e) => {
      const prod = productsList.find(p => p.productName === e.productName);
      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
      return sum + (price * e.quantity);
    }, 0);
    return { modalTotalWeight: weight, modalTotalPrice: price };
  }, [salesEntries, activeDelegateName, productsList]);

  const handleConfirmCompletion = async () => {
    const today = new Date().toISOString().split('T')[0];
    await setDoc(doc(db, 'daily_sales_completion', activeDelegateName || 'عام'), {
      delegate: activeDelegateName,
      date: today,
      completedAt: new Date().toISOString(),
    });

    // Archive delegate's today invoices into sales_entries_archive
    try {
      const delegateEntries = salesEntries.filter(
        (e) =>
          (e.delegateName === activeDelegateName || (e as any).delegateCode === activeDelegateName) &&
          e.dateString === today
      );
      if (delegateEntries.length > 0) {
        const batch = writeBatch(db);
        delegateEntries.forEach((entry) => {
          if (entry.id) {
            const archiveRef = doc(db, 'sales_entries_archive', entry.id);
            batch.set(
              archiveRef,
              { ...entry, archivedAt: new Date().toISOString(), archiveReason: 'delegate_completed_sales' },
              { merge: true }
            );
          }
        });
        await batch.commit();
      }
    } catch (archiveErr) {
      console.error('Error auto-archiving entries in ReportsScreen completion:', archiveErr);
    }

    setUserMessage('تم إكمال مبيعات اليوم بنجاح! ✅');
    setShowCompletionConfirmModal(false);
  };

  // Filter sales entries and evaluations for Date Range if enabled
  const rangeFilteredSales = useMemo(() => {
    if (!useRange) {
      return salesEntries.filter((e) => e.dateString === selectedDate);
    }
    return salesEntries.filter((e) => e.dateString && e.dateString >= startDate && e.dateString <= endDate);
  }, [salesEntries, useRange, selectedDate, startDate, endDate]);

  const rangeFilteredDailyEvals = useMemo(() => {
    if (!useRange) {
      return dailyEvaluationsHistory.filter((r) => r.dateString === selectedDate);
    }
    return dailyEvaluationsHistory.filter((r) => r.dateString && r.dateString >= startDate && r.dateString <= endDate);
  }, [dailyEvaluationsHistory, useRange, selectedDate, startDate, endDate]);

  const { totalSalesWeight, totalDailyInvoicesCount } = useMemo(() => {
    const relevant = activeDelegateName === 'الكل'
      ? rangeFilteredSales
      : rangeFilteredSales.filter((e) => e.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase());
      
    const weight = relevant.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
    const uniqueInvoices = new Set<string>();
    relevant.forEach((e) => {
      const invKey = `${e.delegateName?.trim()}_${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`;
      uniqueInvoices.add(invKey);
    });

    return { 
      totalSalesWeight: weight,
      totalDailyInvoicesCount: uniqueInvoices.size
    };
  }, [rangeFilteredSales, activeDelegateName]);

  const totalTargetWeight = useMemo(() => {
    if (useRange) {
      // Calculate active days count in range
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const targets = activeDelegateName === 'الكل'
        ? delegatesList.reduce((sum, del) => {
            return sum + DEFAULT_CATEGORIES_LIST.reduce((catSum, cat) => {
              const found = delegateTargets.find(t => 
                t.delegateName?.trim().toLowerCase() === del.trim().toLowerCase() &&
                t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
              );
              return catSum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
            }, 0);
          }, 0)
        : DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
            const found = delegateTargets.find(t => 
              t.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase() &&
              t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
            );
            return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
          }, 0);
      return targets * diffDays;
    }
    return categoryReports.reduce((sum, r) => sum + r.dailyTargetWeightKg, 0);
  }, [useRange, startDate, endDate, activeDelegateName, delegateTargets, categoryReports, delegatesList]);

  const totalPct = totalTargetWeight > 0 ? (totalSalesWeight / totalTargetWeight) * 100 : 0;

  // Admin Comparison data across delegates in range or selected date
  const adminComparisonData = useMemo(() => {
    if (!currentUser.isAdmin) return [];
    return delegatesList.map((del) => {
      const delSales = rangeFilteredSales.filter((e) => e.delegateName?.trim().toLowerCase() === del.trim().toLowerCase());
      const delKg = delSales.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
      const delPieces = delSales.reduce((sum, e) => sum + (e.quantity || 0), 0);

      const delEvals = rangeFilteredDailyEvals.filter((r) => r.delegateName.trim().toLowerCase() === del.trim().toLowerCase());
      const avgScore = delEvals.length > 0
        ? Math.round(delEvals.reduce((s, r) => s + r.totalScore, 0) / delEvals.length)
        : delKg > 0 ? Math.min(100, Math.round((delKg / 800) * 80 + 20)) : 0;

      return {
        delegateName: del,
        totalKg: Number(delKg.toFixed(1)),
        totalPieces: delPieces,
        score: avgScore,
        entriesCount: delSales.length,
      };
    }).sort((a, b) => b.totalKg - a.totalKg);
  }, [currentUser.isAdmin, delegatesList, rangeFilteredSales, rangeFilteredDailyEvals]);

  // Compute weekly sales progress data (last 7 days up to selectedDate)
  const weeklyChartData = useMemo(() => {
    const dates: string[] = [];
    const baseDate = new Date(selectedDate || new Date().toISOString().slice(0, 10));
    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    return dates.map((dateStr) => {
      const savedForDate = dailyEvaluationsHistory.filter(
        (r) => r.dateString === dateStr && (activeDelegateName === 'الكل' || r.delegateName.trim().toLowerCase() === activeDelegateName.trim().toLowerCase())
      );

      let totalKg = 0;
      let totalScore = 0;

      if (savedForDate.length > 0) {
        totalKg = savedForDate.reduce((sum, r) => sum + (r.totalWeightKg || 0), 0);
        totalScore = Math.round(savedForDate.reduce((sum, r) => sum + (r.totalScore || 0), 0) / savedForDate.length);
      } else {
        const entriesForDate = salesEntries.filter(
          (e) => e.dateString === dateStr && (activeDelegateName === 'الكل' || e.delegateName?.trim().toLowerCase() === activeDelegateName.trim().toLowerCase())
        );
        totalKg = entriesForDate.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
        totalScore = totalKg > 0 ? Math.min(100, Math.round((totalKg / 800) * 80 + 20)) : 0;
      }

      const dateObj = new Date(dateStr);
      const dayLabel = dateObj.toLocaleDateString('ar-IQ', { weekday: 'short', month: 'numeric', day: 'numeric' });

      return {
        date: dayLabel,
        fullDate: dateStr,
        mabayatKg: Number(totalKg.toFixed(1)),
        score: totalScore,
      };
    });
  }, [selectedDate, activeDelegateName, dailyEvaluationsHistory, salesEntries]);



  // Helper to format ISO completion timestamp into friendly 12-hour Arabic time
  const formatCompletionTime = (isoStr?: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  // Resilient delegate matching
  const isDelMatch = (nameA?: string, nameB?: string) => {
    if (!nameA || !nameB) return false;
    const a = nameA.trim().toLowerCase();
    const b = nameB.trim().toLowerCase();
    if (a === b) return true;
    const norm = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim().toLowerCase();
    return norm(a) === norm(b);
  };

  // Compute delegates to display in the priority table:
  // - Before closing time: Only representatives who manually completed today's sales (chronological order)
  // - After official closing time: ALL representatives across the entire system with complete details!
  //   (Earliest manual completers maintain priority 1, 2, 3..., followed by all remaining delegates)
  const priorityTableDelegates = useMemo(() => {
    // 1. Before official closing time: Only delegates who completed
    if (!isPastClosing) {
      return completedDelegatesList.map((item, idx) => ({
        delegate: item.delegate,
        completedAt: item.completedAt,
        hasManuallyCompleted: true,
        displayRank: idx + 1,
      }));
    }

    // 2. Once official closing time is reached: Display ALL representatives in the system!
    const completedMap = new Map<string, { completedAt: string; priorityOrder: number }>();
    completedDelegatesList.forEach((item, idx) => {
      completedMap.set(item.delegate.trim().toLowerCase(), {
        completedAt: item.completedAt,
        priorityOrder: idx + 1,
      });
    });

    // Gather all distinct delegate names in system
    const allNamesSet = new Set<string>();
    delegatesList.forEach((d) => { if (d && d.trim()) allNamesSet.add(d.trim()); });
    todaysEntries.forEach((e) => { if (e.delegateName && e.delegateName.trim()) allNamesSet.add(e.delegateName.trim()); });
    completedDelegatesList.forEach((c) => { if (c.delegate && c.delegate.trim()) allNamesSet.add(c.delegate.trim()); });

    const allDelegates = Array.from(allNamesSet);

    const completedItems: Array<{
      delegate: string;
      completedAt: string;
      hasManuallyCompleted: boolean;
      totalWeight: number;
    }> = [];

    const remainingItems: Array<{
      delegate: string;
      completedAt?: string;
      hasManuallyCompleted: boolean;
      totalWeight: number;
    }> = [];

    allDelegates.forEach((delName) => {
      const lower = delName.toLowerCase();
      // Calculate today's sales weight for sorting remaining items
      const delEntries = todaysEntries.filter((e) => isDelMatch(e.delegateName, delName));
      const totalWeight = delEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);

      // Check if found in completedMap
      let foundCompleted: { completedAt: string; priorityOrder: number } | undefined;
      for (const [key, val] of completedMap.entries()) {
        if (isDelMatch(key, lower)) {
          foundCompleted = val;
          break;
        }
      }

      if (foundCompleted) {
        completedItems.push({
          delegate: delName,
          completedAt: foundCompleted.completedAt,
          hasManuallyCompleted: true,
          totalWeight,
        });
      } else {
        remainingItems.push({
          delegate: delName,
          hasManuallyCompleted: false,
          totalWeight,
        });
      }
    });

    // Chronological order for delegates who completed manually
    completedItems.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());

    // Sort remaining delegates by total weight descending
    remainingItems.sort((a, b) => b.totalWeight - a.totalWeight);

    // Combine completed delegates first, then remaining delegates
    const combined = [...completedItems, ...remainingItems];

    return combined.map((item, idx) => ({
      ...item,
      displayRank: idx + 1,
    }));
  }, [isPastClosing, completedDelegatesList, delegatesList, todaysEntries]);

  return (
    <PullToRefresh onRefresh={async () => { await syncData(); await new Promise(r => setTimeout(r, 500)); }}>
      <div className="px-0 sm:px-3 py-2 sm:p-4 max-w-5xl mx-auto space-y-3 sm:space-y-4 dir-rtl text-slate-900 bg-white dark:bg-slate-900 w-full">
        
        {/* Daily Sales Completion Bar (Split into two halves: Button + 3:00 PM Countdown) */}
        <DailySalesCompletionBar />

        {/* Admin Completed Delegates Priority Table */}
        {currentUser.isAdmin && (isPastClosing ? priorityTableDelegates.length > 0 : completedDelegatesList.length > 0) && (
          <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl p-1.5 sm:p-4 text-white shadow-xl space-y-3 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-black text-amber-400">
                  📊 جدول المندوبين الذين أكملوا مبيعات اليوم (حسب التسلسل الزمني للأسبقية):
                </h3>
                {isPastClosing && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black">
                    ✓ بعد الإغلاق الرسمي ({formattedTargetTime}) — عرض كافة المندوبين ({priorityTableDelegates.length})
                  </span>
                )}
              </div>
              <button
                onClick={handleOpenActivationModal}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
              >
                <span>⚙️ إدارة وتفعيل المبيعات</span>
              </button>
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full min-w-[540px] text-xs text-center border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-300">
                    <th className="p-2">التسلسل</th>
                    <th className="p-2">اسم المندوب</th>
                    <th className="p-2">عدد الفواتير الكلية</th>
                    <th className="p-2">الهدف اليومي للمندوب</th>
                    <th className="p-2">وزن المبيعات اليومي</th>
                    <th className="p-2">النسبة المئوية بين الهدف والمبيعات</th>
                    <th className="p-2">المبلغ الكلي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {priorityTableDelegates.map((item, idx) => {
                    const delName = item.delegate;
                    const delEntries = todaysEntries.filter(e => isDelMatch(e.delegateName, delName));
                    const invoiceCount = new Set(delEntries.map(e => `${e.dateString || ''}_${e.customerCode || e.customerName || e.invoiceId || e.id}`)).size;
                    const totalWeight = delEntries.reduce((sum, e) => sum + (e.totalWeightKg || 0), 0);
                    const totalAmount = delEntries.reduce((sum, e) => {
                      const prod = productsList.find(p => p.productName === e.productName);
                      const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                      return sum + (price * e.quantity);
                    }, 0);
                    const targetWeight = DEFAULT_CATEGORIES_LIST.reduce((sum, cat) => {
                      const found = delegateTargets.find(t => 
                        isDelMatch(t.delegateName, delName) &&
                        t.categoryName?.trim().toLowerCase() === cat.trim().toLowerCase()
                      );
                      return sum + (found ? (Number(found.dailyTargetWeightKg) || 0) : 0);
                    }, 0);
                    const pct = targetWeight > 0 ? (totalWeight / targetWeight) * 100 : 0;

                    return (
                      <tr key={delName} className="hover:bg-slate-800/50">
                        <td className="p-2 font-bold text-amber-400">{item.displayRank || (idx + 1)}</td>
                        <td className="p-2 font-bold text-white">
                          <div className="flex flex-col items-center justify-center">
                            <span>{delName}</span>
                            {item.hasManuallyCompleted && item.completedAt ? (
                              <span className="text-[9px] text-emerald-400 font-bold mt-0.5">
                                أتم المبيعات: {formatCompletionTime(item.completedAt)}
                              </span>
                            ) : isPastClosing ? (
                              <span className="text-[9px] text-slate-400 font-normal mt-0.5">
                                إغلاق رسمي ({formattedTargetTime})
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="p-2 font-bold">{formatWithCommas(invoiceCount)}</td>
                        <td className="p-2 font-bold">{formatWithCommas(parseFloat(targetWeight.toFixed(1)), true)} كجم</td>
                        <td className="p-2 font-bold text-emerald-300">{formatWithCommas(parseFloat(totalWeight.toFixed(1)), true)} كجم</td>
                        <td className={`p-2 font-extrabold ${pct < 100 ? 'text-red-500' : 'text-emerald-400'}`}>{pct.toFixed(1)}%</td>
                        <td className="p-2 font-extrabold text-indigo-300">{formatWithCommas(totalAmount, true)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <div className="space-y-3 sm:space-y-4 p-0 sm:p-2 w-full">
        {currentUser.isAdmin && <DailyAdminReport salesEntries={salesEntries} productsList={productsList} currentUser={currentUser} isDownloading={isDownloading} setIsDownloading={setIsDownloading} completedDelegates={completedDelegates} />}
      </div>
      {/* 100% Achievement Notification Banner */}
      {achievedCategories.length > 0 && (
        <div className="bg-amber-400 border-2 border-amber-500 rounded-2xl p-4 shadow-xl text-slate-950 space-y-2 animate-bounce-short print:hidden">
          <div className="flex items-center gap-2 font-extrabold text-base sm:text-lg">
            <Award className="w-6 h-6 text-slate-950" />
            <span>🏆 إشعار إنجاز الهدف (100%) - تهانينا!</span>
          </div>

          <p className="text-[10px] sm:text-xs font-bold text-slate-900">
            قام المندوب ({activeDelegateName}) بتجاوز أو تحقيق الهدف 100% في الأصناف التالية:
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {achievedCategories.map((c) => (
              <span
                key={c.categoryName}
                className="px-3 py-1 bg-slate-950 text-amber-300 font-extrabold text-xs rounded-full shadow"
              >
                {c.categoryName} ({c.percentage.toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Admin Delegate Switcher */}
      {currentUser.isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white space-y-2 shadow-md print:hidden">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <Filter className="w-4 h-4" />
            <span>عرض تقرير المندوب (لوحة الأدمن):</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedDelegate('الكل')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedDelegate === 'الكل'
                  ? 'bg-amber-400 text-slate-950 shadow-md scale-105'
                  : 'bg-slate-900/60 text-slate-200 hover:bg-slate-800'
              }`}
            >
              جميع المندوبين (إجمالي)
            </button>

            {delegatesList.map((del) => (
              <button
                key={del}
                onClick={() => setSelectedDelegate(del)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedDelegate === del
                    ? 'bg-slate-500 text-slate-950 shadow-md scale-105'
                    : 'bg-slate-900/60 text-slate-200 hover:bg-slate-800'
                }`}
              >
                {del}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date Filter & Range Picker Bar [HIDDEN]
      <div className="bg-emerald-900/60 border border-emerald-500/40 rounded-2xl p-4 shadow-lg text-white space-y-3 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <span>نظام نطاق التواريخ والتقارير:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseRange(!useRange)}
              className={`px-3 py-1 rounded-xl text-xs font-black transition-all ${
                useRange ? 'bg-amber-400 text-slate-950 shadow-md' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {useRange ? '✓ تفعيل نطاق زمني مخصص' : 'تفعيل نطاق زمني مخصص'}
            </button>
          </div>
        </div>

        {useRange ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-800/80">
            <div className="space-y-1">
              <label className="text-[11px] text-emerald-300 font-bold">من تاريخ:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-emerald-300 font-bold">إلى تاريخ:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-2 border-t border-emerald-800/80">
            <span className="text-xs text-emerald-300 font-bold">التاريخ المختار:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-900 border border-emerald-500/50 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
        )}
      </div>
      */}



      {/* Summary Metrics Banner */}
      <div className="bg-slate-950 border-2 border-slate-500 rounded-2xl p-2.5 sm:p-4 text-white shadow-xl space-y-3 print:hidden w-full">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base sm:text-lg font-black text-white">
            تقرير مبيعات ({activeDelegateName})
          </h2>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-slate-500 text-slate-950 font-black text-xs rounded-full">
              نسبة الإنجاز الكلية: {totalPct.toFixed(1)}%
            </span>
          </div>
        </div>

        <hr className="border-slate-800" />

        <div className="grid grid-cols-2 gap-2 sm:gap-3 text-center">
          <div className="bg-slate-900/50 p-2 sm:p-3 rounded-xl border border-slate-800">
            <div className="text-xs font-bold text-slate-300">إجمالي المبيعات اليوم</div>
            <div className="text-lg sm:text-2xl font-black text-slate-300 mt-1">
              {formatWithCommas(parseFloat(totalSalesWeight.toFixed(1)), true)} كجم
            </div>
          </div>

          <div className="bg-slate-900/50 p-2 sm:p-3 rounded-xl border border-slate-800">
            <div className="text-xs font-bold text-slate-300">إجمالي التاركت المطلوب</div>
            <div className="text-lg sm:text-2xl font-black text-white mt-1">
              {formatWithCommas(parseFloat(totalTargetWeight.toFixed(1)), true)} كجم
            </div>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="space-y-1">
          <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
            <div
              className="bg-slate-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, totalPct))}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Total Saved Weight Summary Card */}
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-2.5 sm:p-4 shadow-md text-center space-y-3 w-full">
        <h2 className="font-extrabold text-slate-900 text-base flex items-center justify-center gap-2">
          {activeDelegateName === 'الكل' ? 'التقرير الكلي للمندوبين اليوم' : `مجموع وزن إدخالات (${activeDelegateName})`}
        </h2>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-12">
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">
              {activeDelegateName === 'الكل' ? 'عدد الفواتير الكلي اليومي للمندوبين' : 'عدد الفواتير الكلي اليومي'}
            </span>
            <div className="text-3xl font-black text-indigo-600">
              {formatWithCommas(Math.round(totalDailyInvoicesCount), false)}
            </div>
          </div>
          
          <div className="hidden sm:block w-px h-12 bg-slate-200"></div>
          <div className="block sm:hidden w-full h-px bg-slate-200"></div>

          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">الوزن الكلي</span>
            <div className="text-3xl font-black text-slate-900">
              {formatWithCommas(parseFloat(totalSalesWeight.toFixed(2)), true)} كجم
            </div>
          </div>
          
          <div className="hidden sm:block w-px h-12 bg-slate-200"></div>
          <div className="block sm:hidden w-full h-px bg-slate-200"></div>
          
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs font-bold text-slate-500 mb-1">المبلغ الكلي</span>
            <div className="text-3xl font-black text-emerald-600">
              {formatWithCommas(rangeFilteredSales.reduce((sum, e) => {
                const prod = productsList.find(p => p.productName === e.productName);
                const price = prod ? (e.priceMode === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
                return sum + (price * e.quantity);
              }, 0), true)} د.ع
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Sales Progress Interactive Chart (Recharts) [HIDDEN]
      <div className="bg-emerald-950 border-2 border-emerald-500 rounded-2xl p-4 text-white shadow-xl space-y-4 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-800/80 rounded-xl text-emerald-300">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-white text-sm sm:text-base">
                تطور المبيعات الأسبوعي للمندوب ({activeDelegateName})
              </h3>
              <p className="text-[11px] text-emerald-300/80 font-bold">
                عرض تفاعلي لأداء مبيعات الكيلوجرامات خلال الأيام الـ 7 الأخيرة
              </p>
            </div>
          </div>
          <span className="text-xs font-bold bg-emerald-800 text-emerald-200 px-3 py-1 rounded-full border border-emerald-600">
            مخطط Recharts التفاعلي
          </span>
        </div>

        <div className="w-full h-64 bg-slate-900/90 rounded-2xl p-3 border border-emerald-800/80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weeklyChartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mabayatGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#059669',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                  direction: 'rtl',
                }}
                formatter={(value: any) => [`${value} كجم`, 'مبيعات الكيلوجرامات']}
                labelStyle={{ fontWeight: 'bold', color: '#34d399', marginBottom: '4px' }}
              />
              <Area
                type="monotone"
                dataKey="mabayatKg"
                name="مبيعات الكيلو"
                stroke="#34d399"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#mabayatGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      */}

      {/* Category Reports Table */}
      <div className="bg-white border-2 border-slate-600 rounded-2xl overflow-hidden shadow-xl space-y-0 w-full">
        <div className="bg-slate-950 p-2.5 sm:p-3.5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-white text-xs sm:text-base">
                تفاصيل المبيعات والتاركت حسب الأصناف (16 صنف)
              </h3>
              <span className={`text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                currentUser.isAdmin
                  ? 'bg-blue-900/60 text-blue-300 border-blue-700/50'
                  : 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'
              }`}>
                {currentUser.isAdmin
                  ? (selectedDelegate && selectedDelegate !== 'الكل' && selectedDelegate !== 'الأدمن'
                      ? `عرض خاص بالمندوب: ${selectedDelegate}`
                      : 'عرض الإدارة: الإجمالي التراكمي لكافة المندوبين')
                  : `عرض التاركت والمبيعات الخاصة بك (${currentUser.name})`}
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-emerald-300/90 font-bold mt-0.5">
              مرتبة تصاعدياً من الأصناف الأقل تحقيقاً (0%) إلى الأعلى إنجازاً (100%) - مع صف فرعي شهري لكل مادة
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-emerald-400 bg-emerald-900/60 px-2 sm:px-2.5 py-1 rounded-lg border border-emerald-700/50">
              {achievedCategories.length} أصناف محققة
            </span>

            {/* Admin Upload Control & Functionality (Exclusively to Admin) */}
            {currentUser.isAdmin && (
              <div className="flex items-center gap-1.5">
                <input
                  ref={monthlyExcelInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleMonthlyExcelUpload}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => monthlyExcelInputRef.current?.click()}
                  disabled={isUploadingMonthlyExcel}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all disabled:opacity-50"
                  title="رفع ملف إكسل لتحديث التاركت والمبيعات وحوافز المندوبين"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isUploadingMonthlyExcel ? 'جاري الرفع...' : 'رفع إكسل التاركت والمبيعات والحوافز'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadMonthlyTemplate}
                  className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                  title="تحميل نموذج الإكسل الشامل"
                >
                  <Download className="w-4 h-4" />
                  <span>تحميل النموذج</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Upload Status Banner */}
        {monthlyUploadMessage && (
          <div
            className={`p-2.5 text-xs font-bold flex items-center justify-between border-b ${
              monthlyUploadMessage.type === 'success'
                ? 'bg-emerald-900/90 text-emerald-100 border-emerald-700'
                : 'bg-rose-900/90 text-rose-100 border-rose-700'
            }`}
          >
            <span>{monthlyUploadMessage.text}</span>
            <button
              onClick={() => setMonthlyUploadMessage(null)}
              className="text-white hover:opacity-75 p-0.5 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[340px] sm:min-w-full text-right border-collapse text-xs">
            <thead className={`font-black text-xs uppercase tracking-wider ${isDarkMode ? 'bg-slate-800/95 text-slate-200 border-b-2 border-slate-700' : 'bg-slate-100 text-slate-700 border-b-2 border-slate-300'}`}>
              <tr>
                <th className="py-3 px-2 sm:px-3.5 w-[33%] text-right font-black">الصنف</th>
                <th className="py-3 px-1 sm:px-3 text-center w-[20%] font-black">المبيعات (كجم)</th>
                <th className="py-3 px-1 sm:px-3 text-center w-[20%] font-black">التاركت (كجم)</th>
                <th className="py-3 px-1.5 sm:px-3 text-center w-[27%] font-black">نسبة الإنجاز %</th>
              </tr>
            </thead>
            <tbody className={isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-white text-slate-700'}>
              {categoryReports.map((item, idx) => {
                const monthlyStats = getMonthlyCategoryStats(item.categoryName);
                const isMonthlyAchieved = monthlyStats.monthlyTarget > 0 && monthlyStats.percentage >= 100;
                return (
                  <React.Fragment key={item.categoryName}>
                    {/* Primary Day Row */}
                    <tr
                      className={`border-b border-dashed transition-all duration-300 ${
                        isMonthlyAchieved
                          ? 'bg-lime-400/20 dark:bg-lime-400/20 hover:bg-lime-400/25 border-lime-400/60 dark:border-[#39ff14]/60 shadow-[0_0_15px_rgba(163,230,53,0.35)] dark:shadow-[0_0_20px_rgba(57,255,20,0.45)]'
                          : isDarkMode
                            ? 'bg-slate-900/90 hover:bg-slate-800/70 border-slate-800'
                            : 'bg-white hover:bg-slate-50 border-slate-300/80'
                      }`}
                    >
                      <td className={`py-2.5 sm:py-3 px-2 sm:px-3.5 ${
                        isMonthlyAchieved
                          ? 'border-r-2 border-t-2 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20'
                          : 'font-extrabold'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          {isMonthlyAchieved && (
                            <Crown className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400 fill-amber-400 shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse" />
                          )}
                          <span className={isMonthlyAchieved ? 'text-lime-700 dark:text-[#39ff14] font-black drop-shadow-[0_0_8px_rgba(57,255,20,0.5)] text-xs sm:text-sm' : 'font-extrabold'}>
                            {item.categoryName}
                          </span>
                          {item.isAchieved && (
                            <span className="px-1.5 py-0.5 bg-amber-400 text-slate-950 font-black text-[9px] sm:text-[10px] rounded-full shadow-sm">
                              🏆 100%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`py-2.5 sm:py-3 px-1 sm:px-3 text-center text-xs sm:text-sm ${
                        isMonthlyAchieved
                          ? 'border-t-2 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20 text-lime-700 dark:text-[#39ff14] font-black drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]'
                          : 'font-extrabold'
                      }`}>
                        {formatWithCommas(parseFloat(item.dailySalesWeightKg.toFixed(1)), true)}
                      </td>
                      <td className={`py-2.5 sm:py-3 px-1 sm:px-3 text-center text-xs sm:text-sm ${
                        isMonthlyAchieved
                          ? 'border-t-2 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20 text-lime-700 dark:text-[#39ff14] font-black drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]'
                          : 'font-bold'
                      }`}>
                        {formatWithCommas(parseFloat(item.dailyTargetWeightKg.toFixed(1)), true)}
                      </td>
                      <td className={`py-2.5 sm:py-3 px-1.5 sm:px-3 text-center ${
                        isMonthlyAchieved
                          ? 'border-l-2 border-t-2 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20'
                          : ''
                      }`}>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-bold">
                            <span className={isMonthlyAchieved ? 'text-lime-700 dark:text-[#39ff14] font-black drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]' : ''}>
                              {item.percentage.toFixed(0)}%
                            </span>
                            {item.isAchieved && (
                              <span className="text-emerald-500 flex items-center gap-0.5">
                                <Check className="w-3 h-3 inline" /> مكتمل
                              </span>
                            )}
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all duration-300 ${
                                isMonthlyAchieved
                                  ? 'bg-lime-500 dark:bg-[#39ff14] shadow-[0_0_10px_rgba(57,255,20,0.9)]'
                                  : item.isAchieved
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-600'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, item.percentage))}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Sub-Row: Monthly Target, Monthly Sales, and Achievement Percentage with Thick Distinct Separator Line Between Items */}
                    <tr
                      className={`transition-all duration-300 ${
                        isMonthlyAchieved
                          ? 'bg-lime-400/20 dark:bg-lime-400/20 hover:bg-lime-400/25 shadow-[0_4px_15px_rgba(163,230,53,0.35)] dark:shadow-[0_4px_20px_rgba(57,255,20,0.45)]'
                          : isDarkMode
                            ? 'bg-slate-900/40 hover:bg-slate-900/60'
                            : 'bg-slate-50/70 hover:bg-slate-100/70'
                      }`}
                    >
                      <td className={`py-1.5 px-2 sm:px-3.5 font-normal ${
                        isMonthlyAchieved
                          ? 'border-r-2 border-b-4 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20'
                          : 'border-b-4 border-slate-300 dark:border-slate-700'
                      }`}>
                        <div className="flex items-center gap-1 pr-2 sm:pr-4">
                          <span className={`font-black text-[8px] sm:text-[9px] flex items-center gap-1.5 ${
                            isMonthlyAchieved
                              ? 'text-lime-700 dark:text-[#39ff14] drop-shadow-[0_0_6px_rgba(57,255,20,0.4)]'
                              : 'text-slate-400 dark:text-slate-400 font-semibold'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                              isMonthlyAchieved
                                ? 'bg-lime-500 dark:bg-[#39ff14] shadow-[0_0_6px_rgba(57,255,20,0.8)]'
                                : 'bg-slate-400'
                            }`}></span>
                            الشهري:
                          </span>
                        </div>
                      </td>
                      {/* Sub-row: Monthly Sales (Prominent Phosphor Green when achieved, Light Gray otherwise) */}
                      <td className={`py-1.5 px-1 sm:px-3 text-center ${
                        isMonthlyAchieved
                          ? 'border-b-4 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20'
                          : 'border-b-4 border-slate-300 dark:border-slate-700'
                      }`}>
                        <span className={`text-[9px] sm:text-[10px] ${
                          isMonthlyAchieved
                            ? 'font-black text-lime-700 dark:text-[#39ff14] drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]'
                            : 'font-semibold text-slate-400 dark:text-slate-400'
                        }`}>
                          {formatWithCommas(parseFloat(monthlyStats.monthlySales.toFixed(1)), true)}
                        </span>
                        <span className={`text-[7px] sm:text-[8px] mr-0.5 ${
                          isMonthlyAchieved ? 'text-lime-700/80 dark:text-[#39ff14]/80 font-bold' : 'text-slate-400/80'
                        }`}>كجم</span>
                      </td>
                      {/* Sub-row: Monthly Target (Prominent Phosphor Green when achieved, Light Gray otherwise) */}
                      <td className={`py-1.5 px-1 sm:px-3 text-center ${
                        isMonthlyAchieved
                          ? 'border-b-4 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/20 dark:bg-lime-400/20'
                          : 'border-b-4 border-slate-300 dark:border-slate-700'
                      }`}>
                        <span className={`text-[9px] sm:text-[10px] ${
                          isMonthlyAchieved
                            ? 'font-black text-lime-700 dark:text-[#39ff14] drop-shadow-[0_0_8px_rgba(57,255,20,0.5)]'
                            : 'font-semibold text-slate-400 dark:text-slate-400'
                        }`}>
                          {formatWithCommas(parseFloat(monthlyStats.monthlyTarget.toFixed(1)), true)}
                        </span>
                        <span className={`text-[7px] sm:text-[8px] mr-0.5 ${
                          isMonthlyAchieved ? 'text-lime-700/80 dark:text-[#39ff14]/80 font-bold' : 'text-slate-400/80'
                        }`}>كجم</span>
                      </td>
                      {/* Sub-row: Monthly Achievement Percentage with Phosphor Green Highlight & Coronation Icon */}
                      <td
                        className={`py-1.5 px-1.5 sm:px-3 text-center transition-all ${
                          isMonthlyAchieved
                            ? 'border-l-2 border-b-4 border-lime-400/90 dark:border-[#39ff14]/90 bg-lime-400/25 dark:bg-lime-400/25 ring-1 ring-inset ring-lime-400/60'
                            : 'border-b-4 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between text-[8px] sm:text-[9px]">
                            <span
                              className={`flex items-center gap-1 font-black ${
                                isMonthlyAchieved
                                  ? 'text-lime-700 dark:text-[#39ff14] drop-shadow-[0_0_8px_rgba(57,255,20,0.6)] text-[9px] sm:text-[10px]'
                                  : 'text-slate-400 dark:text-slate-400'
                              }`}
                            >
                              {isMonthlyAchieved && (
                                <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400 inline shrink-0 drop-shadow-sm" />
                              )}
                              <span>{monthlyStats.percentage.toFixed(1)}%</span>
                            </span>

                            {isMonthlyAchieved ? (
                              <span className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-lime-400 dark:bg-[#39ff14] text-slate-950 font-black text-[7px] sm:text-[8px] shadow-sm">
                                👑 تتويج
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[7px] sm:text-[8px]">
                                {monthlyStats.monthlyTarget > 0
                                  ? `متبقي: ${formatWithCommas(parseFloat(monthlyStats.remaining.toFixed(1)), true)}`
                                  : '-'}
                              </span>
                            )}
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-700/60 rounded-full h-1 overflow-hidden">
                            <div
                              className={`h-1 rounded-full transition-all duration-300 ${
                                isMonthlyAchieved
                                  ? 'bg-lime-500 dark:bg-[#39ff14] shadow-[0_0_10px_rgba(57,255,20,0.9)]'
                                  : 'bg-slate-400 dark:bg-slate-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, monthlyStats.percentage))}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Specific Product Tracking & Performance Section (Before Total Representative Incentives) */}
        <div className={`p-4 sm:p-5 border-t-2 ${
          isDarkMode 
            ? 'bg-gradient-to-b from-slate-900/90 to-slate-950/90 border-slate-700/80 text-white' 
            : 'bg-gradient-to-b from-slate-50/95 to-white border-slate-300 text-slate-900'
        }`}>
          {/* Representative Notice & Instruction Banner for Amah Cheese 200g */}
          <div className="mb-4 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-2 border-amber-500/40 shadow-sm text-slate-800 dark:text-slate-100 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500 text-white shrink-0 shadow-sm mt-0.5">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-black bg-amber-500 text-white shadow-xs">
                  تنبيه وتوجيهات مهمة للمندوبين 📢
                </span>
                <span className="text-xs font-black text-amber-700 dark:text-amber-400">
                  {specificProductStats.productName || specificProductName || 'جبن اماه 200 غم'}
                </span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed">
                المنتج محمي من قبل البزنس بنسبة <span className="font-black text-amber-700 dark:text-amber-400 underline decoration-amber-500/50">50%</span> ولكن هذا مشروط بتحقيق مبيعات <span className="font-black text-emerald-700 dark:text-emerald-400 underline decoration-emerald-500/50">8 قطع للزبون الواحد</span>، وفي حال بيع 8 قطع للزبون يقوم البزنس بحماية <span className="font-black text-amber-700 dark:text-amber-400 underline decoration-amber-500/50">4 قطع</span> في حال اكسبايرها.
              </p>
            </div>
          </div>

          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-black shadow-md shrink-0">
                <Package className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-black text-sm sm:text-base flex items-center gap-2">
                    <span>تاركت اضافي للمنتج :</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-bold">
                      {specificProductStats.productName || specificProductName}
                    </span>
                  </h3>
                  {specificProductStats.isAggregated ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                      مجموع كافة المندوبين
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                      المندوب: {specificProductStats.delegateName}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 shadow-sm">
                    <span className="text-amber-500 text-sm">💡</span>
                    <span>بيع هذه الكمية لهذه المحلات يتم حساب نصف كارتون للتغطية</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Admin Controls Toolbar: Product Specification & Dedicated Excel Upload */}
            {currentUser.isAdmin && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
                {/* 1. Admin Product Specification Input */}
                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-300 dark:border-slate-700">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap px-1">
                    اسم المنتج:
                  </span>
                  <input
                    type="text"
                    list="specific-products-datalist"
                    value={tempSpecificProductName}
                    onChange={(e) => setTempSpecificProductName(e.target.value)}
                    placeholder="اكتب اسم المنتج..."
                    className="px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500 w-36 sm:w-44"
                  />
                  <datalist id="specific-products-datalist">
                    {productsList.map((p) => (
                      <option key={p.id} value={p.productName} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={handleSaveSpecificProductName}
                    disabled={isSavingSpecificProductName || !tempSpecificProductName.trim()}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-lg shadow transition-all disabled:opacity-50 flex items-center gap-1"
                    title="حفظ وتحديد الصنف المخصص لكافة المندوبين"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingSpecificProductName ? '...' : 'حفظ'}</span>
                  </button>
                </div>

                {/* 2. Dedicated Excel Upload & Template Buttons */}
                <div className="flex items-center gap-1.5 justify-end flex-wrap">
                  <input
                    type="file"
                    ref={specificProductExcelInputRef}
                    onChange={handleSpecificProductExcelUpload}
                    accept=".xlsx, .xls"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => specificProductExcelInputRef.current?.click()}
                    disabled={isUploadingSpecificProductExcel}
                    className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all disabled:opacity-50"
                    title="رفع ملف إكسل مخصص لتحديث مبيعات وتاركت ومحلات المنتج المحدد واستبدال البيانات السابقة"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isUploadingSpecificProductExcel ? 'جاري الرفع...' : 'رفع إكسل المنتج المحدد'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadSpecificProductTemplate}
                    className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                    title="تحميل نموذج الإكسل الخاص بالصنف المحدد"
                  >
                    <Download className="w-4 h-4" />
                    <span>نموذج الإكسل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const firstDel = delegatesList.find((d) => d !== 'الكل' && d !== 'الأدمن') || '';
                      openEditSpecificProduct(firstDel);
                    }}
                    className="flex items-center gap-1 px-2.5 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                    title="تعديل يدوي لأهداف ومبيعات المندوبين"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>تعديل يدوي</span>
                  </button>

                  {specificProductTargets.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearSpecificProductData}
                      className="flex items-center gap-1 px-2.5 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                      title="مسح وتفريغ كافة بيانات ملف الإكسل المرفوع للصنف المحدد"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>مسح بيانات الملف</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Upload Message Banner */}
          {specificProductUploadMessage && (
            <div
              className={`mb-4 p-3 rounded-xl text-xs font-bold flex items-center justify-between border ${
                specificProductUploadMessage.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              <span>{specificProductUploadMessage.text}</span>
              <button
                type="button"
                onClick={() => setSpecificProductUploadMessage(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Dynamic Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-4">
            {/* Card 1: Product Sales (in pieces) vs Target (in pieces) & Achievement % */}
            <div
              className={`p-4 sm:p-5 rounded-2xl border transition-all duration-300 ${
                specificProductStats.salesPct >= 100
                  ? 'bg-lime-400/20 dark:bg-lime-400/20 border-2 border-lime-400 shadow-[0_0_25px_rgba(163,230,53,0.35)] ring-2 ring-lime-400/40 text-lime-900 dark:text-[#39ff14]'
                  : isDarkMode
                  ? 'bg-slate-900/70 border-slate-800 text-white'
                  : 'bg-white border-slate-200 shadow-sm text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      specificProductStats.salesPct >= 100
                        ? 'bg-lime-400/30 text-lime-700 dark:text-[#39ff14] shadow-[0_0_12px_rgba(163,230,53,0.5)]'
                        : 'bg-indigo-500/20 text-indigo-400'
                    }`}
                  >
                    <Package className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div>
                    <h4 className={`font-black text-xs sm:text-base flex items-center gap-1.5 ${
                      specificProductStats.salesPct >= 100 ? 'text-lime-800 dark:text-[#39ff14]' : ''
                    }`}>
                      <span>مبيعات لحد الان</span>
                      {specificProductStats.salesPct >= 100 && (
                        <Crown className="w-5 h-5 fill-amber-400 text-amber-400 drop-shadow-md animate-bounce inline shrink-0" />
                      )}
                    </h4>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      المنتج المحدد: {specificProductStats.productName || specificProductName}
                    </span>
                  </div>
                </div>

                <div
                  className={`px-3 py-1.5 rounded-xl font-mono font-black text-base sm:text-lg flex items-center gap-1.5 shadow-sm ${
                    specificProductStats.salesPct >= 100
                      ? 'bg-lime-400/30 text-lime-900 dark:text-[#39ff14] border-2 border-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.4)]'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {specificProductStats.salesPct >= 100 && (
                    <Crown className="w-4 h-4 fill-amber-400 text-amber-400 inline" />
                  )}
                  <span>{specificProductStats.salesPct.toFixed(1)}%</span>
                  {specificProductStats.salesPct >= 100 && (
                    <span className="text-xs">🏆</span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    specificProductStats.salesPct >= 100
                      ? 'bg-gradient-to-r from-lime-400 via-lime-300 to-[#39ff14] shadow-[0_0_15px_rgba(57,255,20,0.9)]'
                      : 'bg-gradient-to-r from-indigo-500 to-purple-600'
                  }`}
                  style={{ width: `${Math.min(specificProductStats.salesPct, 100)}%` }}
                />
              </div>

              {/* 100% Achievement Banner when achieved */}
              {specificProductStats.salesPct >= 100 && (
                <div className="mb-3 p-2 rounded-xl bg-lime-400/30 border border-lime-500 flex items-center justify-between text-xs font-black text-lime-900 dark:text-[#39ff14]">
                  <span className="flex items-center gap-1.5">
                    <Crown className="w-4 h-4 fill-amber-400 text-amber-400" />
                    تم الوصول إلى 100% من الهدف الشهري وتجاوزه بنجاح! 👑
                  </span>
                  <span className="font-mono text-sm font-black">
                    +{formatWithCommas(Math.max(0, specificProductStats.salesPieces - specificProductStats.targetPieces))} قطعة فائض
                  </span>
                </div>
              )}

              {/* Numerical breakdown */}
              <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-200/60 dark:border-slate-800/80">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">مبيعات الصنف (قطعة)</div>
                  <div className={`font-mono font-black text-xs sm:text-base ${
                    specificProductStats.salesPct >= 100 ? 'text-lime-700 dark:text-[#39ff14]' : 'text-indigo-600 dark:text-indigo-400'
                  }`}>
                    {formatWithCommas(specificProductStats.salesPieces)}
                    <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                  </div>
                  {specificProductStats.salesCartons > 0 && (
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      ≈ {formatWithCommas(specificProductStats.salesCartons)} كارتون
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">تاركت الصنف (قطعة)</div>
                  <div className="font-mono font-black text-xs sm:text-base text-slate-700 dark:text-slate-300">
                    {formatWithCommas(specificProductStats.targetPieces)}
                    <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                  </div>
                  {specificProductStats.targetCartons > 0 && (
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      ≈ {formatWithCommas(specificProductStats.targetCartons)} كارتون
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                    {specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                      ? 'الفائض عن التاركت'
                      : 'المتبقي للتاركت'}
                  </div>
                  <div
                    className={`font-mono font-black text-xs sm:text-base ${
                      specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                        ? 'text-lime-700 dark:text-[#39ff14]'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0
                      ? `+${formatWithCommas(specificProductStats.salesPieces - specificProductStats.targetPieces)}`
                      : formatWithCommas(Math.max(0, specificProductStats.targetPieces - specificProductStats.salesPieces))}
                    <span className="text-[10px] text-slate-400 mr-1">قطعة</span>
                  </div>
                  {specificProductStats.salesPieces >= specificProductStats.targetPieces && specificProductStats.targetPieces > 0 && (
                    <div className="text-[10px] text-lime-600 dark:text-[#39ff14] font-black mt-0.5 flex items-center justify-center gap-1">
                      <Crown className="w-3 h-3 fill-amber-400 text-amber-400 inline" /> محقق 100%
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: Number of Shops Sold To vs Target Shops & Achievement % */}
            <div
              className={`p-4 rounded-2xl border transition-all ${
                specificProductStats.shopsPct >= 100
                  ? 'bg-lime-400/10 dark:bg-lime-400/15 border-lime-500/50 shadow-[0_0_15px_rgba(132,204,22,0.15)] ring-1 ring-lime-500/30'
                  : isDarkMode
                  ? 'bg-slate-900/70 border-slate-800'
                  : 'bg-white border-slate-200 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      specificProductStats.shopsPct >= 100
                        ? 'bg-lime-500/20 text-lime-600 dark:text-[#39ff14]'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>تغطية عدد المحلات (الانتشار)</span>
                      {specificProductStats.shopsPct >= 100 && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-[#39ff14] inline" />
                      )}
                    </h4>
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold block">
                      بيع هذه الكمية لهذه المحلات يتم حساب نصف كارتون للتغطية
                    </span>
                  </div>
                </div>

                <div
                  className={`px-3 py-1 rounded-xl font-mono font-black text-sm sm:text-base flex items-center gap-1 ${
                    specificProductStats.shopsPct >= 100
                      ? 'bg-lime-400/25 text-lime-700 dark:text-[#39ff14] border border-lime-500/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>{specificProductStats.shopsPct.toFixed(1)}%</span>
                  {specificProductStats.shopsPct >= 100 && (
                    <span className="text-xs">⭐</span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    specificProductStats.shopsPct >= 100
                      ? 'bg-gradient-to-r from-lime-500 to-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.6)]'
                      : 'bg-gradient-to-r from-emerald-500 to-teal-500'
                  }`}
                  style={{ width: `${Math.min(specificProductStats.shopsPct, 100)}%` }}
                />
              </div>

              {/* Numerical breakdown */}
              <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-100 dark:border-slate-800/80">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">تم بيع لعدد محلات</div>
                  <div className="font-mono font-black text-xs sm:text-sm text-emerald-600 dark:text-emerald-400">
                    {specificProductStats.actualShops}
                    <span className="text-[9px] text-slate-400 mr-1">محل</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">تاركت تغطية المحلات</div>
                  <div className="font-mono font-black text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                    {specificProductStats.targetShops}
                    <span className="text-[9px] text-slate-400 mr-1">محل مطلوب</span>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-2 rounded-xl">
                  <div className="text-[10px] text-slate-400 font-bold mb-0.5">
                    {specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                      ? 'تغطية مكتملة'
                      : 'متبقي للتغطية'}
                  </div>
                  <div
                    className={`font-mono font-black text-xs sm:text-sm ${
                      specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                        ? 'text-lime-600 dark:text-[#39ff14]'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {specificProductStats.actualShops >= specificProductStats.targetShops && specificProductStats.targetShops > 0
                      ? `+${specificProductStats.actualShops - specificProductStats.targetShops}`
                      : Math.max(0, specificProductStats.targetShops - specificProductStats.actualShops)}
                    <span className="text-[9px] text-slate-400 mr-1">محل</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Admin Aggregation: Representatives Breakdown Accordion / Grid */}
          {currentUser.isAdmin && specificProductStats.isAggregated && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => setShowAdminSpecificBreakdown(!showAdminSpecificBreakdown)}
                  className="flex items-center gap-1.5 text-xs font-black text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {showAdminSpecificBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <span>
                    {showAdminSpecificBreakdown ? 'إخفاء' : 'عرض'} مبيعات منتج محدد ({specificProductStats.productName || specificProductName}) ({specificProductStats.delegateBreakdown.length})
                  </span>
                </button>
              </div>

              {showAdminSpecificBreakdown && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-inner">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black text-[11px] border-b border-slate-200 dark:border-slate-700">
                        <th className="p-2.5">المندوب</th>
                        <th className="p-2.5 text-center">مبيعات (قطعة)</th>
                        <th className="p-2.5 text-center">تاركت (قطعة)</th>
                        <th className="p-2.5 text-center">نسبة الإنجاز %</th>
                        <th className="p-2.5 text-center">مبيعات (كارتون)</th>
                        <th className="p-2.5 text-center">تم بيع لمحلات</th>
                        <th className="p-2.5 text-center">تاركت المحلات</th>
                        <th className="p-2.5 text-center">نسبة المحلات</th>
                        <th className="p-2.5 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {specificProductStats.delegateBreakdown.map((del, idx) => {
                        const isSalesAchieved = del.salesPct >= 100;
                        const isShopsAchieved = del.shopsPct >= 100;
                        const isTopSeller = idx === 0 && del.salesPieces > 0;
                        return (
                          <tr
                            key={del.delegateName}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                              isTopSeller
                                ? 'bg-amber-500/10 dark:bg-amber-500/10 font-black ring-1 ring-amber-500/30'
                                : isSalesAchieved
                                ? 'bg-lime-400/20 text-lime-900 dark:text-[#39ff14] font-black'
                                : ''
                            }`}
                          >
                            <td className="p-2.5 font-extrabold flex items-center gap-1.5 flex-wrap">
                              {isTopSeller && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-500/25 text-amber-700 dark:text-amber-300 text-[10px] font-black border border-amber-500/40 inline-flex items-center gap-0.5 shadow-sm">
                                  <span>🥇</span>
                                  <span>الأعلى مبيعاً</span>
                                </span>
                              )}
                              <span>{del.delegateName}</span>
                              {isSalesAchieved && (
                                <Crown className="w-4 h-4 fill-amber-400 text-amber-400 inline" />
                              )}
                            </td>
                            <td className={`p-2.5 text-center font-mono font-black ${
                              isTopSeller
                                ? 'text-amber-600 dark:text-amber-400 font-black'
                                : isSalesAchieved
                                ? 'text-lime-700 dark:text-[#39ff14]'
                                : 'text-indigo-600 dark:text-indigo-400'
                            }`}>
                              {formatWithCommas(del.salesPieces)}
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                              {formatWithCommas(del.targetPieces)}
                            </td>
                            <td className="p-2.5 text-center font-mono font-black">
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[11px] inline-flex items-center gap-1 ${
                                  isSalesAchieved
                                    ? 'bg-lime-400/30 text-lime-900 dark:text-[#39ff14] border border-lime-500'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {isSalesAchieved && (
                                  <Crown className="w-3 h-3 fill-amber-400 text-amber-400 inline" />
                                )}
                                {del.salesPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-500 dark:text-slate-400">
                              {formatWithCommas(del.salesCartons)}
                            </td>
                            <td className="p-2.5 text-center font-mono font-black text-emerald-600 dark:text-emerald-400">
                              {del.actualShops}
                            </td>
                            <td className="p-2.5 text-center font-mono font-bold text-slate-600 dark:text-slate-300">
                              {del.targetShops}
                            </td>
                            <td className="p-2.5 text-center font-mono font-black">
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[11px] ${
                                  isShopsAchieved
                                    ? 'bg-lime-400/20 text-lime-700 dark:text-[#39ff14] border border-lime-500/30'
                                    : 'text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {del.shopsPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => openEditSpecificProduct(del.delegateName)}
                                className="p-1 rounded-lg bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 transition-all"
                                title="تعديل أهداف ومبيعات هذا المندوب"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wide Box: Total Incentives So Far at Bottom of Table */}
        <div className={`p-3.5 sm:p-5 border-t-2 ${
          isDarkMode 
            ? 'bg-slate-950/90 border-slate-700/80 text-white' 
            : 'bg-slate-50/95 border-slate-300 text-slate-900'
        }`}>
          {!currentUser.isAdmin ? (
            /* Representative View: Only shows their personal incentives */
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3.5">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-emerald-500 text-slate-950 flex items-center justify-center font-black shadow-md shrink-0">
                  <Award className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm sm:text-base">
                      الحوافز الكلية لحد الان ({currentUser.name})
                    </h4>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    إجمالي مبالغ الحوافز والعمولات المكتسبة للشهر الحالي بناءً على الأداء والمبيعات المعتمدة
                  </p>
                </div>
              </div>

              <div className="w-full sm:w-auto bg-white dark:bg-slate-900 px-5 py-2.5 rounded-2xl border-2 border-emerald-500/50 shadow-sm flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <span className="text-xs text-slate-400 font-bold">المبلغ المستحق:</span>
                <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
                  {formatWithCommas(
                    delegateIncentives.find(
                      (inc) =>
                        normalizeText(inc.delegateName || '') === normalizeText(currentUser.name || '') ||
                        inc.delegateName?.trim().toLowerCase() === currentUser.name?.trim().toLowerCase()
                    )?.incentivesAmount || 0,
                    true
                  )}
                  <span className="text-xs font-bold text-slate-500 mr-1.5">د.ع</span>
                </span>
              </div>
            </div>
          ) : (
            /* Admin View: Management control and delegates incentives list (no incentives for admin) */
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm sm:text-base text-slate-800 dark:text-white flex items-center gap-1.5">
                      <Award className="w-5 h-5 text-amber-500" />
                      إدارة حوافز المندوبين الكلية لحد الآن
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                      لوحة تحكم الإدارة (لا تظهر حوافز للإدارة)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold mt-0.5">
                    تظهر الحوافز لكل مندوب على حدة في حسابه الخاص. يمكن تحديث مبالغ الحوافز من خلال رفع ملف الإكسل أدناه:
                  </p>
                </div>

                {/* Upload Button at bottom of table */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
                  <button
                    type="button"
                    onClick={() => monthlyExcelInputRef.current?.click()}
                    disabled={isUploadingMonthlyExcel}
                    className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all disabled:opacity-50"
                    title="رفع ملف إكسل لتحديث التاركت والمبيعات وحوافز المندوبين"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isUploadingMonthlyExcel ? 'جاري الرفع...' : 'رفع إكسل التاركت والمبيعات والحوافز'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadMonthlyTemplate}
                    className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                    title="تحميل نموذج الإكسل الشامل"
                  >
                    <Download className="w-4 h-4" />
                    <span>تحميل النموذج</span>
                  </button>
                </div>
              </div>

              {/* List of representatives and their incentives so far */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80">
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between">
                  <span>أسماء المندوبين والحوافز المسجلة لكل مندوب لحد الآن:</span>
                  <span className="text-[10px] text-slate-400">تظهر هذه المبالغ في حساب كل مندوب على حدة</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {delegatesList.filter(d => d !== 'الكل' && d !== 'الأدمن').map((del) => {
                    const incVal = delegateIncentives.find(
                      (inc) =>
                        normalizeText(inc.delegateName || '') === normalizeText(del) ||
                        inc.delegateName?.trim().toLowerCase() === del.trim().toLowerCase()
                    )?.incentivesAmount || 0;
                    const isSelected = selectedDelegate === del;
                    return (
                      <div
                        key={del}
                        className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                          isSelected
                            ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/10'
                            : isDarkMode
                            ? 'bg-slate-900/60 border-slate-800 text-slate-200'
                            : 'bg-white border-slate-200 text-slate-800 shadow-sm'
                        }`}
                      >
                        <span className="font-extrabold truncate">{del}</span>
                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          {formatWithCommas(incVal, true)} <span className="text-[9px] text-slate-400">د.ع</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section Below Incentives: Monthly IQD, Shops Reach, and Extra Product Targets */}
        <div className={`p-4 sm:p-5 border-t-2 ${
          isDarkMode 
            ? 'bg-slate-900/90 border-slate-700/80 text-white' 
            : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold shrink-0">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-black text-sm sm:text-base flex items-center gap-2 flex-wrap">
                  <span>{extraTargetsStats.title}</span>
                  {extraTargetsStats.isTotal && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-700/40">
                      مجموع كافة المندوبين
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                  {extraTargetsStats.isTotal
                    ? 'إجمالي ومجموع أداء المبيعات والتاركت الإضافي لكافة المندوبين للشهر الحالي'
                    : 'متابعة التاركت الديناري، تغطية المحلات، وأداء زبائن الصنف الإضافي للشهر الحالي'}
                </p>
              </div>
            </div>

            {currentUser.isAdmin && (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => monthlyExcelInputRef.current?.click()}
                  disabled={isUploadingMonthlyExcel}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md transition-all disabled:opacity-50"
                  title="رفع ملف إكسل لتحديث التاركت والمبيعات وحوافز المندوبين والأهداف الإضافية"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isUploadingMonthlyExcel ? 'جاري الرفع...' : 'رفع إكسل التاركت والمبيعات والحوافز'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadMonthlyTemplate}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                  title="تحميل نموذج الإكسل الشامل"
                >
                  <Download className="w-4 h-4" />
                  <span>تحميل النموذج</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const targetDel = activeExtraRep || (delegatesList.find(d => d !== 'الكل' && d !== 'الأدمن') || '');
                    setEditExtraTargetDelegate(targetDel);
                    const existing = extraTargetsList.find(t => t.delegateName === targetDel);
                    setEditMonthlyIqdTarget(existing ? String(existing.monthlyIqdTarget || '') : '');
                    setEditTargetShopsCount(existing ? String(existing.targetShopsCount || '') : '');
                    setEditExtraProductName(existing?.extraProductName || 'جبن مثلثات');
                    setEditExtraProductCustomersTarget(existing ? String(existing.extraProductCustomersTarget || '') : '');
                    setShowEditExtraTargetsModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>تعديل الأهداف الإضافية</span>
                </button>
              </div>
            )}
          </div>

          {/* 3 Grid Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Card 1: تاركت ديناري شهري ومبيعات ديناري شهري */}
            <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
              extraTargetsStats.iqdPct >= 100
                ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
                : isDarkMode
                ? 'bg-slate-950/80 border-slate-800'
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0">
                    <Coins className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs sm:text-sm">التاركت الديناري الشهري</h4>
                    <span className="text-[10px] text-slate-400 font-bold">المبيعات النقدية بالدينار</span>
                  </div>
                </div>
                {extraTargetsStats.iqdPct >= 100 && (
                  <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                    👑 100%+
                  </span>
                )}
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">تاركت ديناري شهري:</span>
                  <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                    {formatWithCommas(extraTargetsStats.iqdTarget, true)} <span className="text-[9px] text-slate-400 font-normal">د.ع</span>
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">مبيعات ديناري شهري:</span>
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                    {formatWithCommas(extraTargetsStats.iqdSales, true)} <span className="text-[9px] text-slate-400 font-normal">د.ع</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                  <span className={`font-mono font-black text-sm ${extraTargetsStats.iqdPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-blue-600 dark:text-blue-400'}`}>
                    {extraTargetsStats.iqdPct.toFixed(1)}%
                  </span>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      extraTargetsStats.iqdPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.iqdPct))}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Card 2: مطلوب تبيع لعدد محلات وتم بيع لعدد محلات */}
            <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
              extraTargetsStats.shopsPct >= 100
                ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
                : isDarkMode
                ? 'bg-slate-950/80 border-slate-800'
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-blue-500/20 text-blue-500 shrink-0">
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs sm:text-sm">تغطية عدد المحلات</h4>
                    <span className="text-[10px] text-slate-400 font-bold">الانتشار وعدد المحلات</span>
                  </div>
                </div>
                {extraTargetsStats.shopsPct >= 100 && (
                  <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                    👑 100%+
                  </span>
                )}
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">مطلوب تبيع لعدد محلات:</span>
                  <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                    {extraTargetsStats.shopsTarget} <span className="text-[9px] text-slate-400 font-normal">محل</span>
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">تم بيع لعدد محلات:</span>
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                    {extraTargetsStats.shopsActual} <span className="text-[9px] text-slate-400 font-normal">محل</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                  <span className={`font-mono font-black text-sm ${extraTargetsStats.shopsPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-blue-600 dark:text-blue-400'}`}>
                    {extraTargetsStats.shopsPct.toFixed(1)}%
                  </span>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      extraTargetsStats.shopsPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.shopsPct))}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Card 3: اسم المنتج الإضافي، تاركت زبائن شهري، تم بيع لهم */}
            <div className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
              extraTargetsStats.extraCustPct >= 100
                ? 'bg-lime-400/10 border-lime-400/50 ring-1 ring-lime-400/40 shadow-sm'
                : isDarkMode
                ? 'bg-slate-950/80 border-slate-800'
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-500/20 text-purple-500 shrink-0">
                    <PackagePlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-xs sm:text-sm">المنتج الإضافي وزبائنه</h4>
                    <span className="text-[10px] text-slate-400 font-bold">هدف الصنف الترويجي</span>
                  </div>
                </div>
                {extraTargetsStats.extraCustPct >= 100 && (
                  <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-lime-400 text-slate-950 font-black text-[9px] shadow-sm">
                    👑 100%+
                  </span>
                )}
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">اسم المنتج الاضافي:</span>
                  <span className="font-black text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20 truncate max-w-[130px]">
                    {extraTargetsStats.extraProdName}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">تاركت زبائن شهري:</span>
                  <span className="font-mono font-black text-slate-800 dark:text-slate-200">
                    {extraTargetsStats.extraCustTarget} <span className="text-[9px] text-slate-400 font-normal">زبون</span>
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">تم بيع لهم:</span>
                  <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                    {extraTargetsStats.extraCustActual} <span className="text-[9px] text-slate-400 font-normal">زبون</span>
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 dark:text-slate-400 font-extrabold">النسبة %:</span>
                  <span className={`font-mono font-black text-sm ${extraTargetsStats.extraCustPct >= 100 ? 'text-lime-500 dark:text-[#39ff14]' : 'text-purple-600 dark:text-purple-400'}`}>
                    {extraTargetsStats.extraCustPct.toFixed(1)}%
                  </span>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden mt-1">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      extraTargetsStats.extraCustPct >= 100 ? 'bg-lime-400 dark:bg-[#39ff14] shadow-[0_0_8px_rgba(57,255,20,0.8)]' : 'bg-purple-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, extraTargetsStats.extraCustPct))}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Extra Targets Modal for Admin */}
      {showEditExtraTargetsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowEditExtraTargetsModal(false)}
        >
          <div
            className={`p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-black text-base text-emerald-400 flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                تعديل الأهداف التراكمية الشهرية للمندوب
              </h3>
              <button
                onClick={() => setShowEditExtraTargetsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-slate-400">المندوب:</label>
                <select
                  value={editExtraTargetDelegate}
                  onChange={(e) => {
                    const del = e.target.value;
                    setEditExtraTargetDelegate(del);
                    const existing = extraTargetsList.find((t) => t.delegateName === del);
                    setEditMonthlyIqdTarget(existing ? String(existing.monthlyIqdTarget || '') : '');
                    setEditTargetShopsCount(existing ? String(existing.targetShopsCount || '') : '');
                    setEditExtraProductName(existing?.extraProductName || 'جبن مثلثات');
                    setEditExtraProductCustomersTarget(
                      existing ? String(existing.extraProductCustomersTarget || '') : ''
                    );
                  }}
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {delegatesList
                    .filter((d) => d !== 'الكل' && d !== 'الأدمن')
                    .map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تاركت ديناري شهري (د.ع):</label>
                <input
                  type="text"
                  value={editMonthlyIqdTarget}
                  onChange={(e) => setEditMonthlyIqdTarget(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 50,000,000"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">مطلوب تبيع لعدد محلات (محل):</label>
                <input
                  type="text"
                  value={editTargetShopsCount}
                  onChange={(e) => setEditTargetShopsCount(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 150"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">اسم المنتج الإضافي:</label>
                <input
                  type="text"
                  value={editExtraProductName}
                  onChange={(e) => setEditExtraProductName(e.target.value)}
                  placeholder="مثال: جبن كيري / جبن مثلثات"
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تاركت زبائن شهري للمنتج الإضافي (زبون):</label>
                <input
                  type="text"
                  value={editExtraProductCustomersTarget}
                  onChange={(e) => setEditExtraProductCustomersTarget(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 80"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <button
                type="button"
                onClick={() => setShowEditExtraTargetsModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${
                  isDarkMode
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveExtraTargets}
                disabled={isSavingExtraTargets}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {isSavingExtraTargets ? 'جاري الحفظ...' : 'حفظ الأهداف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Specific Product Targets Modal for Admin */}
      {showEditSpecificProductModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowEditSpecificProductModal(false)}
        >
          <div
            className={`p-6 rounded-3xl shadow-2xl w-full max-w-lg border text-right space-y-4 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-black text-base text-indigo-400 flex items-center gap-2">
                <Pencil className="w-5 h-5" />
                تعديل أهداف ومبيعات الصنف المحدد للمندوب
              </h3>
              <button
                type="button"
                onClick={() => setShowEditSpecificProductModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-slate-400">المندوب:</label>
                <select
                  value={editSpecificProductDelegate}
                  onChange={(e) => openEditSpecificProduct(e.target.value)}
                  className={`w-full p-2.5 rounded-xl border font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {delegatesList
                    .filter((d) => d !== 'الكل' && d !== 'الأدمن')
                    .map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">الصنف المحدد المعتمد:</label>
                <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold">
                  {specificProductName}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تاركت الصنف (قطعة):</label>
                <input
                  type="text"
                  value={editSpecificTargetPieces}
                  onChange={(e) => setEditSpecificTargetPieces(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 1200"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">مبيعات الصنف الفعلية (قطعة):</label>
                <input
                  type="text"
                  value={editSpecificSalesPieces}
                  onChange={(e) => setEditSpecificSalesPieces(parseArabicDigits(e.target.value))}
                  placeholder="المبيعات الفعلية المرفوعة من ملف الإكسل (مثال: 500)"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold mb-1 text-slate-400">تاركت الكارتون (اختياري):</label>
                  <input
                    type="text"
                    value={editSpecificTargetCartons}
                    onChange={(e) => setEditSpecificTargetCartons(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 50"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-400">مبيعات الكارتون (اختياري):</label>
                  <input
                    type="text"
                    value={editSpecificSalesCartons}
                    onChange={(e) => setEditSpecificSalesCartons(parseArabicDigits(e.target.value))}
                    placeholder="مثال: 45"
                    className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">مطلوب تبيع لعدد محلات (محل):</label>
                <input
                  type="text"
                  value={editSpecificTargetShops}
                  onChange={(e) => setEditSpecificTargetShops(parseArabicDigits(e.target.value))}
                  placeholder="مثال: 50"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-400">تم بيع لعدد محلات (محل):</label>
                <input
                  type="text"
                  value={editSpecificActualShops}
                  onChange={(e) => setEditSpecificActualShops(parseArabicDigits(e.target.value))}
                  placeholder="المحلات المباع لها المرفوعة من الإكسل (مثال: 35)"
                  className={`w-full p-2.5 rounded-xl border font-mono font-bold ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-3">
              <button
                type="button"
                onClick={() => setShowEditSpecificProductModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${
                  isDarkMode
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveSpecificProductModal}
                disabled={isSavingSpecificProductModal}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {isSavingSpecificProductModal ? 'جاري الحفظ...' : 'حفظ الأهداف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showActivationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowActivationModal(false)}>
          <div className={`p-6 rounded-3xl shadow-2xl w-full max-w-md border text-right space-y-4 ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-700">
              <h3 className="font-black text-base text-amber-400">إدارة وتفعيل مبيعات المندوبين</h3>
              <button onClick={() => setShowActivationModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">حدد المندوبين المراد تفعيل/إلغاء تفعيل حالة إكمال المبيعات لهم اليوم:</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {delegatesList.map(del => (
                <label key={del} className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isDarkMode ? 'bg-slate-800/80 border-slate-700 hover:bg-slate-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                  <span className="font-bold text-sm">{del}</span>
                  <input
                    type="checkbox"
                    checked={!!selectedActivationDelegates[del]}
                    onChange={(e) => {
                      setSelectedActivationDelegates({
                        ...selectedActivationDelegates,
                        [del]: e.target.checked
                      });
                    }}
                    className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowActivationModal(false)}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs border ${isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveActivation}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md"
              >
                حفظ التغييرات
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </PullToRefresh>
  );
};
