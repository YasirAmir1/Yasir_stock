import logoImg from '../assets/images/logo.png';
import { formatWithCommas, parseArabicDigits } from './numberUtils';

export interface InvoiceEntryForPrint {
  productName: string;
  quantity: number;
  enteredQuantity?: number;
  entryUnit?: string;
  priceMode?: 'wholesale' | 'retail';
  isGift?: boolean;
}

export interface InvoicePrintOptions {
  customerName: string;
  customerCode?: string;
  customerPhone?: string;
  customerAddress?: string;
  delegateName?: string;
  timestamp?: number;
  priceMode?: 'wholesale' | 'retail';
  entries: InvoiceEntryForPrint[];
  productsList: {
    productName: string;
    wholesalePrice?: number;
    retailPrice?: number;
    cartonQuantity?: number;
  }[];
  salesPhone?: string;
  notice?: string;
}

/**
 * Generates the clean, high-contrast, professional HTML receipt for printing
 */
export const generateInvoicePrintHtml = (options: InvoicePrintOptions): string => {
  const {
    customerName,
    customerCode = '',
    customerPhone = '',
    customerAddress = '',
    delegateName = 'غير محدد',
    timestamp = Date.now(),
    priceMode = 'wholesale',
    entries,
    productsList,
    salesPhone = '07718458337',
    notice = 'ملاحظة: قد تختلف الكميات أعلاه لنفاد المخزون.'
  } = options;

  const phoneRegex = /(?:\+964|0)?7[3-9]\d[\s-]?\d{3}[\s-]?\d{4}/;
  let cleanCustomerName = customerName.split(' | الزبون: ').pop() || customerName;
  cleanCustomerName = cleanCustomerName.replace(phoneRegex, '').replace(/[|\\/?:*"><]/g, '').trim() || 'زبون';

  const entryDate = new Date(timestamp);
  const formattedDate = `${String(entryDate.getDate()).padStart(2, '0')}/${String(entryDate.getMonth() + 1).padStart(2, '0')}/${entryDate.getFullYear()}`;
  const formattedTime = `${String(entryDate.getHours()).padStart(2, '0')}:${String(entryDate.getMinutes()).padStart(2, '0')}:${String(entryDate.getSeconds()).padStart(2, '0')}`;
  const invoicePriceModeStr = priceMode === 'wholesale' ? 'جملة' : 'مفرد';

  let totalPrice = 0;
  let totalCartons = 0;
  let totalPieces = 0;

  const rowsHtml = entries.map((e, idx) => {
    const isGift = Boolean(e.isGift);
    const prod = productsList.find((p) => p.productName === e.productName);
    const price = prod && !isGift ? ((e.priceMode || priceMode) === 'wholesale' ? (prod.wholesalePrice || 0) : (prod.retailPrice || 0)) : 0;
    const rowPrice = price * e.quantity;
    totalPrice += rowPrice;

    const cartonQty = Number(prod?.cartonQuantity) || 1;
    let qtyDisplay = '';

    if (cartonQty > 1) {
      const fullCartons = Math.floor(e.quantity / cartonQty);
      const remainder = e.quantity % cartonQty;
      if (!isGift) {
        totalCartons += (e.quantity / cartonQty);
      }
      totalPieces += e.quantity;

      if (fullCartons > 0 && remainder > 0) {
        qtyDisplay = `<div style="font-weight: 900;">${fullCartons} كارتون و ${remainder} ق</div><div style="font-size: 9px; color: #444;">(${formatWithCommas(e.quantity)} قطعة)</div>`;
      } else if (fullCartons > 0) {
        qtyDisplay = `<div style="font-weight: 900;">${fullCartons} كارتون</div><div style="font-size: 9px; color: #444;">(${formatWithCommas(e.quantity)} قطعة)</div>`;
      } else {
        qtyDisplay = `<div style="font-weight: 900;">${e.quantity} قطعة</div>`;
      }
    } else {
      if (!isGift) {
        totalCartons += e.quantity;
      }
      totalPieces += e.quantity;
      qtyDisplay = `<div style="font-weight: 900;">${formatWithCommas(e.quantity)} قطعة</div>`;
    }

    if (isGift) {
      qtyDisplay = `<div style="font-weight: 900; color: #b45309;">${formatWithCommas(e.quantity)} قطعة (هدية)</div>`;
    }

    return `
      <tr style="border-bottom: 1px dashed #bbb; page-break-inside: avoid; ${isGift ? 'background-color: #fffbeb;' : ''}">
        <td style="padding: 5px 2px; text-align: center; font-weight: 900; width: 6%; color: #000;">
          ${isGift ? '🎁' : idx + 1}
        </td>
        <td style="padding: 5px 4px; text-align: right; font-weight: 900; line-height: 1.25; width: 44%; color: #000;">
          ${isGift ? '<span style="color: #b45309; margin-left: 2px;">[هدية] </span>' : ''}${e.productName}
        </td>
        <td style="padding: 5px 2px; text-align: center; width: 25%; color: #000;">
          ${qtyDisplay}
        </td>
        <td style="padding: 5px 2px; text-align: left; font-weight: 900; white-space: nowrap; width: 25%; color: #000;">
          ${isGift ? 'هدية' : `${formatWithCommas(rowPrice, true)} د.ع`}
        </td>
      </tr>
    `;
  }).join('');

  const cleanPhone = customerPhone ? parseArabicDigits(customerPhone).replace(/\D/g, '') : '';

  return `
    <div class="direct-invoice-sheet" dir="rtl" style="font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #000; background: #fff; width: 100%; max-width: 80mm; margin: 0 auto; padding: 4px; box-sizing: border-box;">
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 4px;">
        <img src="${logoImg}" alt="Logo" style="height: 44px; max-width: 90px; object-fit: contain; margin: 0 auto 3px auto; display: block;" onerror="this.style.display='none'" />
        <div style="font-size: 15px; font-weight: 900; color: #000000; text-align: center; margin-top: 2px;">تطبيق ياسر للمبيعات | كالة فرع صلاح الدين</div>
      </div>

      <div style="border-top: 1.5px dashed #000; margin: 6px 0;"></div>

      <!-- Customer Meta Row -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px;">
        <div style="text-align: left; font-family: monospace; font-size: 10px; font-weight: bold; color: #000; line-height: 1.3; direction: ltr;">
          ${formattedDate}<br/>${formattedTime}
        </div>
        <div style="text-align: right; flex: 1;">
          <div style="font-size: 18px; font-weight: 900; color: #000; line-height: 1.2;">اسم الزبون: ${cleanCustomerName}</div>
          ${cleanPhone ? `
            <div style="margin-top: 3px;">
              <span style="border: 2px solid #000; border-radius: 5px; padding: 1px 8px; font-size: 13px; font-weight: 900; font-family: monospace; background: #fff; color: #000; display: inline-block; direction: ltr;">
                ${cleanPhone}
              </span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Details: Delegate, Code, Address -->
      <div style="font-size: 12px; font-weight: bold; color: #000; line-height: 1.4; margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-weight: 900;">المندوب: </span>
            <span>${delegateName}</span>
          </div>
          ${customerCode ? `
            <div style="font-family: monospace; font-size: 11px;">
              <span>كود: ${customerCode}</span>
            </div>
          ` : ''}
        </div>
        ${customerAddress ? `
          <div style="margin-top: 2px;">
            <span style="font-weight: 900;">العنوان: </span>
            <span>${customerAddress}</span>
          </div>
        ` : ''}
      </div>

      <div style="border-top: 1.5px dashed #000; margin: 6px 0;"></div>

      <!-- Items Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 11px;">
        <thead>
          <tr style="border-top: 2px solid #000; border-bottom: 2px solid #000;">
            <th style="padding: 5px 2px; text-align: center; font-size: 12px; font-weight: 900; width: 6%; color: #000;">#</th>
            <th style="padding: 5px 4px; text-align: right; font-size: 12px; font-weight: 900; width: 44%; color: #000;">المنتج</th>
            <th style="padding: 5px 2px; text-align: center; font-size: 12px; font-weight: 900; width: 25%; color: #000;">الكمية</th>
            <th style="padding: 5px 2px; text-align: left; font-size: 12px; font-weight: 900; width: 25%; color: #000;">السعر (${invoicePriceModeStr})</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 4px; display: flex; justify-content: space-between; align-items: center; margin: 6px 0;">
        <div style="font-size: 18px; font-weight: 900; text-align: left; color: #000;">${formatWithCommas(totalPrice, true)} د.ع</div>
        <div style="font-size: 16px; font-weight: 900; text-align: right; color: #000;">الإجمالي الكلي</div>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: bold; padding: 2px 4px; color: #333;">
        <span>إجمالي الكراتين: ${totalCartons.toFixed(1).replace(/\.0$/, '')} كارتون</span>
        <span>إجمالي القطع: ${formatWithCommas(totalPieces)} قطعة</span>
      </div>

      <!-- Notes and footer phone -->
      <div style="border: 1.5px solid #000; padding: 4px 6px; text-align: center; font-size: 10px; font-weight: 900; color: #000; margin-top: 6px;">
        ${notice}
      </div>

      <div style="border: 1.5px solid #0b3b8c; padding: 4px 6px; text-align: center; font-size: 11px; font-weight: 900; color: #000; margin-top: 4px;">
        رقم المبيعات: ${salesPhone}
      </div>
    </div>
  `;
};

/**
 * Triggers direct invoice printing using window.print() and dedicated @media print CSS rules,
 * avoiding popup blockers and delivering a pristine, clean printout.
 */
export const printInvoiceDirectly = async (options: InvoicePrintOptions): Promise<void> => {
  const invoiceHtml = generateInvoicePrintHtml(options);

  // 1. Mount or update in-page direct print area
  let printArea = document.getElementById('direct-invoice-print-area');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'direct-invoice-print-area';
    document.body.appendChild(printArea);
  }
  printArea.innerHTML = invoiceHtml;

  // Add printing state class to document body
  document.body.classList.add('printing-direct-invoice');

  // 2. Prepare hidden in-page print iframe (safe for sandboxed iframes & mobile webviews)
  let printIframe = document.getElementById('invoice-direct-print-iframe') as HTMLIFrameElement | null;
  if (!printIframe) {
    printIframe = document.createElement('iframe');
    printIframe.id = 'invoice-direct-print-iframe';
    printIframe.style.position = 'fixed';
    printIframe.style.top = '-9999px';
    printIframe.style.left = '-9999px';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    printIframe.style.visibility = 'hidden';
    document.body.appendChild(printIframe);
  }

  const iframeDoc = printIframe.contentDocument || printIframe.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <title>فاتورة - ${options.customerName}</title>
          <style>
            @media print {
              @page {
                margin: 2mm 3mm;
                size: auto;
              }
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                margin: 0 !important;
                padding: 0 !important;
                font-family: 'Cairo', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #000000;
              font-family: 'Cairo', system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif;
            }
            .direct-invoice-sheet {
              width: 100%;
              max-width: 80mm;
              margin: 0 auto;
              padding: 4px;
              box-sizing: border-box;
            }
          </style>
        </head>
        <body>
          ${invoiceHtml}
        </body>
      </html>
    `);
    iframeDoc.close();
  }

  // Allow image and DOM to layout cleanly
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    if (printIframe && printIframe.contentWindow) {
      printIframe.contentWindow.focus();
      printIframe.contentWindow.print();
    } else {
      window.focus();
      window.print();
    }
  } catch (err) {
    console.warn('Iframe print error, falling back to window.print():', err);
    window.focus();
    window.print();
  } finally {
    // Clear printing class after short delay
    setTimeout(() => {
      document.body.classList.remove('printing-direct-invoice');
    }, 1500);
  }
};
