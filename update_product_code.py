import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add getProductCode function
func_def = """  const getProductCode = (productName: string) => {
    const match = productSuggestions.find(p => p.name === productName);
    return match ? match.code : '000';
  };
"""
content = content.replace("  const activeDelegateName =", func_def + "\n  const activeDelegateName =")

# Update entry render
old_render = """                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900">{entry.productName}</span>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">"""

new_render = """                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-700 font-bold bg-slate-200 px-1.5 py-0.5 rounded border border-slate-300" title="كود المنتج">
                        {getProductCode(entry.productName)}
                      </span>
                      <span className="font-bold text-sm text-slate-900">{entry.productName}</span>
                      <span className="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">"""

if old_render in content:
    content = content.replace(old_render, new_render)
    with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Product code added successfully")
else:
    print("Could not find render block")

