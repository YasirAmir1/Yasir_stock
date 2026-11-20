import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { NewCustomerDefinition } from '../types';
import { formatEnglishDateTime } from './dateUtils';

const escapeHtml = (val: string): string =>
  String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const preloadImageAsDataUrl = async (src: string): Promise<string> => {
  if (!src || src.startsWith('data:')) return src;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : src);
        reader.onerror = () => reject(new Error('read error'));
        reader.readAsDataURL(blob);
      });
      return dataUrl;
    }
  } catch {
    // Fallback to original URL if CORS fetch is restricted
  }
  return src;
};

const waitForImages = async (container: HTMLElement): Promise<void> => {
  const imgs = Array.from(container.querySelectorAll('img'));
  if (imgs.length === 0) return;
  await Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    })
  );
};

const renderElementToA4Pdf = async (container: HTMLElement, fileName: string): Promise<void> => {
  document.body.appendChild(container);
  try {
    await waitForImages(container);
    await new Promise((resolve) => setTimeout(resolve, 180));

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pdfWidth = 210;
    const pdfHeight = 297;
    const contentHeightInMm = (canvas.height * pdfWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.94);

    if (contentHeightInMm <= pdfHeight) {
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, contentHeightInMm);
    } else {
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

    pdf.save(fileName);
  } finally {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
  }
};

export const generateNewCustomerPhotosPdf = async (item: NewCustomerDefinition): Promise<void> => {
  const rawPhotos: Array<{ title: string; src: string }> = [];
  if (item.exteriorSignImage) {
    rawPhotos.push({ title: '1. صورة اللوحة الخارجية للمحل', src: item.exteriorSignImage });
  }
  if (item.idCardFrontImage) {
    rawPhotos.push({ title: '2. صورة هوية الزبون (الوجه الأمامي)', src: item.idCardFrontImage });
  }
  if (item.idCardBackImage) {
    rawPhotos.push({ title: '3. صورة هوية الزبون (الظهر الخلفي)', src: item.idCardBackImage });
  }

  const photos = await Promise.all(
    rawPhotos.map(async (p) => ({
      title: p.title,
      src: await preloadImageAsDataUrl(p.src),
    }))
  );

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Cairo', Tahoma, sans-serif";
  container.style.direction = 'rtl';
  container.style.boxSizing = 'border-box';
  container.style.padding = '28px 32px';
  container.style.zIndex = '-999';

  const submittedAtStr = formatEnglishDateTime(item.createdAt || item.timestamp || new Date(), item.dateString || '-');
  const printedAtStr = formatEnglishDateTime(new Date(), '-');

  container.innerHTML = `
    <div style="width: 100%; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 18px;">
        <div>
          <h1 style="margin: 0; font-size: 18px; font-weight: 900; color: #1e1b4b;">استمارة وصور تعريف محل جديد</h1>
          <p style="margin: 3px 0 0 0; font-size: 11px; color: #64748b; font-weight: 700;">فرع صلاح الدين — توثيق بيانات وصور الزبون المرسلة من المندوب</p>
        </div>
        <div style="text-align: left; font-size: 10.5px; color: #334155;">
          <div style="font-weight: 800; color: #4338ca;">تاريخ الإرسال: <span dir="ltr" style="font-family: monospace;">${escapeHtml(submittedAtStr)}</span></div>
          <div style="margin-top: 2px; color: #64748b;">تاريخ التصدير: <span dir="ltr" style="font-family: monospace;">${escapeHtml(printedAtStr)}</span></div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 11px; margin-bottom: 18px;">
        <tbody>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="width: 24%; padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">اسم المشتري (بالقطعة):</td>
            <td style="width: 26%; padding: 7px 10px; font-weight: 900; color: #0f172a; border-left: 1px solid #e2e8f0;">${escapeHtml(item.shopSignName)}</td>
            <td style="width: 22%; padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">الاسم الثلاثي للمشتري:</td>
            <td style="width: 28%; padding: 7px 10px; font-weight: 900; color: #0f172a;">${escapeHtml(item.buyerFullName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">عنوان المشتري:</td>
            <td style="padding: 7px 10px; font-weight: 700; border-left: 1px solid #e2e8f0;">${escapeHtml(item.buyerAddress)}</td>
            <td style="padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">نوع المشتري:</td>
            <td style="padding: 7px 10px; font-weight: 900; color: #b45309;">${escapeHtml(item.customerType)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">رقم الهاتف 1 / 2:</td>
            <td style="padding: 7px 10px; font-family: monospace; font-weight: 800; border-left: 1px solid #e2e8f0;" dir="ltr">${escapeHtml(item.phone1)} | ${escapeHtml(item.phone2)}</td>
            <td style="padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">المندوب المرسل:</td>
            <td style="padding: 7px 10px; font-weight: 800;">${escapeHtml(item.delegateName)}</td>
          </tr>
          <tr>
            <td style="padding: 7px 10px; background-color: #f8fafc; font-weight: 800; color: #475569; border-left: 1px solid #e2e8f0;">موقع GPS:</td>
            <td colspan="3" style="padding: 7px 10px; font-family: monospace; font-weight: 800; color: #4338ca;" dir="ltr">${escapeHtml(item.gpsLocation)}</td>
          </tr>
        </tbody>
      </table>

      <div style="display: flex; flex-direction: column; gap: 16px;">
        ${photos
          .map(
            (p) => `
          <div style="border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #312e81; color: #ffffff; padding: 7px 12px; font-size: 12px; font-weight: 900;">
              ${escapeHtml(p.title)}
            </div>
            <div style="padding: 12px; background-color: #f8fafc; text-align: center;">
              <img src="${p.src}" ${p.src.startsWith('http') ? 'crossOrigin="anonymous"' : ''} style="max-width: 100%; max-height: 360px; object-fit: contain; display: block; margin: 0 auto; border-radius: 6px;" />
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  const safeShop = (item.shopSignName || item.buyerFullName || 'زبون').replace(/[/\\?%*:|"<>]/g, '_');
  await renderElementToA4Pdf(container, `تعريف_محل_${safeShop}.pdf`);
};

export const generateSinglePhotoPdf = async (
  src: string,
  title: string,
  subtitle?: string
): Promise<void> => {
  const safeSrc = await preloadImageAsDataUrl(src);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Cairo', Tahoma, sans-serif";
  container.style.direction = 'rtl';
  container.style.boxSizing = 'border-box';
  container.style.padding = '32px';
  container.style.zIndex = '-999';

  const printedAt = formatEnglishDateTime(new Date(), '-');

  container.innerHTML = `
    <div style="width: 100%; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px;">
        <div>
          <h1 style="margin: 0; font-size: 17px; font-weight: 900;">${escapeHtml(title)}</h1>
          ${subtitle ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #475569; font-weight: 700;">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div style="font-size: 10.5px; color: #475569; font-family: monospace;" dir="ltr">${escapeHtml(printedAt)}</div>
      </div>
      <div style="border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; background-color: #f8fafc; text-align: center;">
        <img src="${safeSrc}" ${safeSrc.startsWith('http') ? 'crossOrigin="anonymous"' : ''} style="max-width: 100%; max-height: 900px; object-fit: contain; display: block; margin: 0 auto;" />
      </div>
    </div>
  `;

  const safeTitle = (title || 'صورة_الزبون').replace(/[/\\?%*:|"<>]/g, '_');
  await renderElementToA4Pdf(container, `${safeTitle}.pdf`);
};
