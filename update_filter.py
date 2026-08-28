import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add state
old_state = "  const [customerSearchTerm, setCustomerSearchTerm] = useState('');"
new_state = """  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [savedEntriesFilterDelegate, setSavedEntriesFilterDelegate] = useState<string>('الكل');"""
content = content.replace(old_state, new_state)

# Update filteredSavedEntries
old_filter = """  const filteredSavedEntries = safeSavedEntries.filter(
    (e) => !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm))
  );"""

new_filter = """  const filteredSavedEntries = safeSavedEntries.filter(
    (e) => {
      const matchSearch = !customerSearchTerm || (e.customerName && e.customerName.includes(customerSearchTerm));
      const matchDelegate = savedEntriesFilterDelegate === 'الكل' || e.delegateName === savedEntriesFilterDelegate;
      return matchSearch && matchDelegate;
    }
  );
  
  const uniqueDelegatesForFilter = Array.from(new Set(safeSavedEntries.map(e => e.delegateName || 'غير محدد'))).sort();
"""
content = content.replace(old_filter, new_filter)

# Update UI
old_ui = """            {safeSavedEntries.length > 0 && (
              <span className="text-xs font-bold text-emerald-700 shrink-0">
                الإجمالي: {formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم
              </span>
            )}
          </div>
        </div>"""

new_ui = """            {safeSavedEntries.length > 0 && (
              <span className="text-xs font-bold text-emerald-700 shrink-0">
                الإجمالي: {formatWithCommas(parseFloat(totalSavedWeight.toFixed(2)), true)} كجم
              </span>
            )}
          </div>
        </div>

        {/* Delegate Filter Buttons for Admin */}
        {currentUser?.isAdmin && uniqueDelegatesForFilter.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
            <span className="text-xs font-bold text-slate-700">تصفية حسب المندوب:</span>
            <button
              onClick={() => setSavedEntriesFilterDelegate('الكل')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${savedEntriesFilterDelegate === 'الكل' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
            >
              الكل
            </button>
            {uniqueDelegatesForFilter.map(delegate => (
              <button
                key={`filter_${delegate}`}
                onClick={() => setSavedEntriesFilterDelegate(delegate)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${savedEntriesFilterDelegate === delegate ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}
              >
                {delegate}
              </button>
            ))}
          </div>
        )}"""
content = content.replace(old_ui, new_ui)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Delegate filter added successfully")
