import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add getCartonsDisplay function right after getProductCode
old_func = """  const getProductCode = (productName: string) => {
    const match = productSuggestions.find(p => p.name === productName);
    return match ? match.code : '000';
  };"""

new_func = """  const getProductCode = (productName: string) => {
    const match = productSuggestions.find(p => p.name === productName);
    return match ? match.code : '000';
  };

  const getCartonsDisplay = (productName: string, quantity: number) => {
    const productItem = productsList.find(p => p.productName === productName);
    if (productItem && productItem.cartonQuantity) {
      const cq = Number(productItem.cartonQuantity);
      if (cq > 0 && quantity >= cq) {
        const cartons = Math.floor(quantity / cq);
        const remainder = quantity % cq;
        return cartons + (remainder > 0 ? ` كرتون و ${remainder} ق` : ' كرتون');
      }
    }
    return null;
  };"""

content = content.replace(old_func, new_func)

# Modify render row
old_render = """                    <div className="flex items-center gap-2">
                      <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-md text-slate-800 text-[11px] min-w-[65px]">
                        {formatWithCommas(entry.quantity)} قطعة
                      </div>
                      <div className="text-center font-black text-emerald-800 px-2.5 py-1 bg-emerald-50 rounded-md border border-emerald-100 text-[11px] min-w-[75px]">"""

new_render = """                    <div className="flex items-center gap-2">
                      {getCartonsDisplay(entry.productName, entry.quantity) && (
                        <div className="text-center font-bold px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-md text-indigo-700 text-[11px] min-w-[65px]" title="عدد الكراتين">
                          {getCartonsDisplay(entry.productName, entry.quantity)}
                        </div>
                      )}
                      <div className="text-center font-bold px-2.5 py-1 bg-slate-100 rounded-md text-slate-800 text-[11px] min-w-[65px]">
                        {formatWithCommas(entry.quantity)} قطعة
                      </div>
                      <div className="text-center font-black text-emerald-800 px-2.5 py-1 bg-emerald-50 rounded-md border border-emerald-100 text-[11px] min-w-[75px]">"""

content = content.replace(old_render, new_render)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Cartons box added")
