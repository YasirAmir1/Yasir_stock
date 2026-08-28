import re

with open('src/utils/numberUtils.ts', 'r', encoding='utf-8') as f:
    content = f.read()

new_func = """
/**
 * Formats a number with thousand separators (e.g. 1,000)
 */
export function formatWithCommas(num: number): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}
"""

content += new_func

with open('src/utils/numberUtils.ts', 'w', encoding='utf-8') as f:
    f.write(content)
