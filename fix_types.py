import re

with open('src/types.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_sales_entry = """export interface SalesEntry {
  id: string;
  productName: string;
  categoryName: string;
  quantity: number;
  pieceWeightKg: number;
  totalWeightKg: number;
  delegateName: string;
  timestamp: number;
  dateString: string;
}"""

new_sales_entry = """export interface SalesEntry {
  id: string;
  customerCode?: string;
  customerName: string;
  customerAddress?: string;
  productName: string;
  categoryName: string;
  quantity: number;
  pieceWeightKg: number;
  totalWeightKg: number;
  delegateName: string;
  timestamp: number;
  dateString: string;
}"""

content = content.replace(old_sales_entry, new_sales_entry)

with open('src/types.ts', 'w', encoding='utf-8') as f:
    f.write(content)

