import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { DamagedProductItem } from '../types';

export const generateDamagedProductPdf = async (item: DamagedProductItem): Promise<void> => {
  // Create an off-screen container for rendering the official A4 form
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px'; // Standard A4 width at 96 DPI
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Arabic', 'Cairo', Tahoma, sans-serif";
  container.style.direction = 'rtl';
  container.style.boxSizing = 'border-box';
  container.style.padding = '32px 36px';
  container.style.zIndex = '-999';

  // Format dates
  const reportDate = item.createdAt 
    ? new Date(item.createdAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleDateString('ar-EG');
  const printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // HTML content of the official QC Form
  container.innerHTML = `
    <div style="width: 100%; box-sizing: border-box;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px;">
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="background-color: #e11d48; color: #ffffff; width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px;">
              QC
            </div>
            <div>
              <h1 style="margin: 0; font-size: 19px; font-weight: 900; color: #0f172a;">استمارة بلاغ فحص منتج تالف - كالة فرع صلاح الدين</h1>
              <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b; font-weight: bold;">قسم مراقبة الجودة ومتابعة التعويضات (Quality Control Report)</p>
            </div>
          </div>
        </div>

        <div style="text-align: left; font-size: 11px; color: #334155;">
          <div style="font-weight: 800; color: #e11d48; font-size: 12px; font-family: monospace;">رقم التقرير: #QC-${item.id.slice(-6).toUpperCase()}</div>
          <div style="margin-top: 3px; font-weight: 600;">تاريخ التسجيل: <span style="direction: ltr; display: inline-block;">${reportDate}</span></div>
          <div style="margin-top: 2px; color: #64748b;">تاريخ الطباعة: <span style="direction: ltr; display: inline-block;">${printDate}</span></div>
        </div>
      </div>

      <!-- Delegate & Form Info Banner -->
      <div style="display: flex; justify-content: space-between; align-items: center; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 16px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #334155;">
          المندوب المسجل: <span style="color: #0f172a; font-weight: 900;">${item.delegateName || '—'}</span>
        </div>
        <div style="font-size: 11px; font-weight: 800; color: #64748b;">
          توثيق ومعاينة فنية للمنتج التالف
        </div>
      </div>

      <!-- Customer Details Section -->
      <div style="margin-bottom: 20px;">
        <div style="background-color: #0f172a; color: #ffffff; padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 900; display: flex; align-items: center; gap: 6px;">
          <span>1. بيانات العميل</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 11px; text-align: right;">
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="width: 20%; padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">اسم الزبون:</td>
              <td style="width: 30%; padding: 8px 12px; font-weight: 900; color: #0f172a; border-left: 1px solid #e2e8f0;">${item.customerName}</td>
              <td style="width: 20%; padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">كود الزبون:</td>
              <td style="width: 30%; padding: 8px 12px; font-weight: 800; font-family: monospace; color: #0f172a;">${item.customerCode}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">نوع الزبون:</td>
              <td style="padding: 8px 12px; font-weight: 800; color: #d97706; border-left: 1px solid #e2e8f0;">${item.customerType}</td>
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">عنوان الزبون:</td>
              <td style="padding: 8px 12px; font-weight: 700; color: #334155;">${item.customerAddress || 'غير محدد'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Product Details Section -->
      <div style="margin-bottom: 20px;">
        <div style="background-color: #0f172a; color: #ffffff; padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 900;">
          <span>2. بيانات المنتج التالف</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 11px; text-align: right;">
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="width: 20%; padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">اسم المنتج:</td>
              <td style="width: 30%; padding: 8px 12px; font-weight: 900; color: #059669; border-left: 1px solid #e2e8f0;">${item.productName}</td>
              <td style="width: 20%; padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">كود الصنف:</td>
              <td style="width: 30%; padding: 8px 12px; font-weight: 800; font-family: monospace; color: #0f172a;">${item.productCode || '—'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">رقم الدفعة (Batch No):</td>
              <td style="padding: 8px 12px; font-weight: 800; font-family: monospace; color: #0f172a; border-left: 1px solid #e2e8f0;">
                <span style="background-color: #f1f5f9; padding: 2px 8px; border-radius: 4px; border: 1px solid #cbd5e1;">${item.batchNumber || '—'}</span>
              </td>
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">الكمية التالفة:</td>
              <td style="padding: 8px 12px; font-weight: 900; color: #e11d48; font-size: 13px;">${item.purchaseQuantity || 1} قطعة</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">تاريخ شراء الزبون:</td>
              <td style="padding: 8px 12px; font-weight: 700; color: #0f172a; border-left: 1px solid #e2e8f0; font-family: monospace;">${item.purchaseDate || '—'}</td>
              <td style="padding: 8px 12px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">المندوب القائم بالبلاغ:</td>
              <td style="padding: 8px 12px; font-weight: 800; color: #0f172a;">${item.delegateName}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Defect Description Section -->
      <div style="margin-bottom: 20px;">
        <div style="background-color: #e11d48; color: #ffffff; padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 900;">
          <span>3. سبب العيب والمشكلة الفنية للمنتج</span>
        </div>
        <div style="border: 1px solid #fecdd3; background-color: #fff1f2; padding: 12px 16px; border-radius: 0 0 6px 6px; font-size: 12px; line-height: 1.6; font-weight: 700; color: #881337;">
          ${item.defectReason || 'لا يوجد وصف تفصيلي مسجل.'}
        </div>
      </div>

      <!-- Photographic Evidence Section -->
      ${item.images && item.images.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <div style="background-color: #0f172a; color: #ffffff; padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 900; display: flex; justify-content: space-between; align-items: center;">
            <span>4. التوثيق المصور للمنتج التالف (معاينة الصور المرفقة)</span>
            <span style="font-size: 11px; font-weight: normal; color: #cbd5e1;">عدد الصور: ${item.images.length}</span>
          </div>
          <div style="border: 1px solid #cbd5e1; border-top: none; padding: 14px; background-color: #f8fafc; border-radius: 0 0 6px 6px;">
            <div style="display: grid; grid-template-columns: repeat(${Math.min(item.images.length, 3)}, 1fr); gap: 12px;">
              ${item.images.map((imgUrl, idx) => `
                <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; background-color: #ffffff; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                  <div style="width: 100%; height: 160px; display: flex; align-items: center; justify-content: center; background-color: #000000; overflow: hidden;">
                    <img src="${imgUrl}" alt="صورة توثيقية ${idx + 1}" style="max-width: 100%; max-height: 160px; object-fit: contain; display: block;" crossOrigin="anonymous" />
                  </div>
                  <div style="padding: 6px; font-size: 10px; font-weight: 800; color: #475569; background-color: #f1f5f9; border-top: 1px solid #e2e8f0;">
                    صورة توثيقية (${idx + 1})
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Customer Invoice Photo Section (if attached) -->
      ${item.invoiceImage ? `
        <div style="margin-bottom: 24px;">
          <div style="background-color: #0f172a; color: #ffffff; padding: 6px 12px; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 900;">
            <span>5. صورة فاتورة الزبون المرفقة</span>
          </div>
          <div style="border: 1px solid #cbd5e1; border-top: none; padding: 12px; background-color: #f8fafc; border-radius: 0 0 6px 6px; text-align: center;">
            <div style="max-height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: #000000; border-radius: 6px;">
              <img src="${item.invoiceImage}" alt="فاتورة الزبون" style="max-width: 100%; max-height: 220px; object-fit: contain; display: block;" crossOrigin="anonymous" />
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Footer Stamp -->
      <div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #94a3b8;">
        <span>وثيقة فحص صادرة إلكترونياً من تطبيق ياسر للمبيعات - قسم مراقبة الجودة QC - كالة فرع صلاح الدين</span>
        <span>صفحة 1 من 1</span>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    // Wait for all images inside container to be fully loaded
    const imgElements = Array.from(container.querySelectorAll('img'));
    if (imgElements.length > 0) {
      await Promise.all(
        imgElements.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Don't block if an image fails
          });
        })
      );
    }

    // Small delay to ensure styles and font kerning are fully computed
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Capture the container via html2canvas-pro with high DPI (scale: 2)
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    // Create A4 PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pdfWidth = 210;
    const pdfHeight = 297;
    const contentHeightInMm = (canvas.height * pdfWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    if (contentHeightInMm <= pdfHeight) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, contentHeightInMm);
    } else {
      // If content overflows A4 height, paginate cleanly
      let heightLeft = contentHeightInMm;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, contentHeightInMm);
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, contentHeightInMm);
        heightLeft -= pdfHeight;
      }
    }

    // Sanitize filename
    const safeCust = (item.customerName || 'عميل').replace(/[/\\?%*:|"<>]/g, '_');
    const safeProd = (item.productName || 'منتج').replace(/[/\\?%*:|"<>]/g, '_');
    pdf.save(`استمارة_منتج_تالف_${safeCust}_${safeProd}.pdf`);
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
};
