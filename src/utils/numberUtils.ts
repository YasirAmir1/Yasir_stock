/**
 * Converts Arabic/Eastern numerals (٠١٢٣٤٥٦٧٨٩) and Persian numerals (۰۱۲۳۴۵۶۷۸۹)
 * to standard ASCII English numerals (0123456789).
 */
export function parseArabicDigits(input: string): string {
  if (!input) return '';
  return input
    .replace(/[٠۰]/g, '0')
    .replace(/[١۱]/g, '1')
    .replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3')
    .replace(/[٤۴]/g, '4')
    .replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6')
    .replace(/[٧۷]/g, '7')
    .replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9')
    .replace(/٫/g, '.'); // handle Arabic decimal separator
}

/**
 * Parses a string or number that may contain Arabic or English digits into a float number.
 */
export function parseArabicNumber(input: string | number): number {
  if (typeof input === 'number') return isNaN(input) ? 0 : input;
  if (!input) return 0;
  const normalized = parseArabicDigits(input.toString()).replace(/,/g, '').trim();
  const val = parseFloat(normalized);
  return isNaN(val) ? 0 : val;
}

/**
 * Formats a number with thousand separators (e.g. 1,000)
 */
export function formatWithCommas(num: number, hasDecimals: boolean = false): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  if (hasDecimals) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  }
  return num.toLocaleString('en-US');
}
