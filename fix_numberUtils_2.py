import re

with open('src/utils/numberUtils.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_func = """
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
"""

content = re.sub(r'/\*\*[\s\S]*?formatWithCommas[\s\S]*?\}', new_func.strip(), content)

with open('src/utils/numberUtils.ts', 'w', encoding='utf-8') as f:
    f.write(content)
