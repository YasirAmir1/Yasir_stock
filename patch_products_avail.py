import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State
old_state = "const [editImageUrl, setEditImageUrl] = useState('');"
new_state = "const [editImageUrl, setEditImageUrl] = useState('');\n  const [editIsAvailable, setEditIsAvailable] = useState(true);"
content = content.replace(old_state, new_state)

# 2. startEditing
old_start = "setEditImageUrl(p.imageUrl || '');"
new_start = "setEditImageUrl(p.imageUrl || '');\n    setEditIsAvailable(p.isAvailable !== false);"
content = content.replace(old_start, new_start)

# 3. saveEditing
old_save = "imageUrl: editImageUrl.trim(),"
new_save = "imageUrl: editImageUrl.trim(),\n      isAvailable: editIsAvailable,"
content = content.replace(old_save, new_save)

# 4. Toggle switch UI in edit mode
old_expanded = """                          {editImageUrl && (
                            <img src={editImageUrl} alt="Preview" className="w-16 h-16 object-contain mx-auto mt-1 rounded border border-slate-700 bg-white" />
                          )}
                        </div>"""

new_expanded = """                          {editImageUrl && (
                            <img src={editImageUrl} alt="Preview" className="w-16 h-16 object-contain mx-auto mt-1 rounded border border-slate-700 bg-white" />
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between p-2 rounded-md border border-slate-700 bg-slate-800/50 mt-1">
                          <span className="text-[10px] font-bold text-white">حالة المنتج</span>
                          <button
                            type="button"
                            onClick={() => setEditIsAvailable(!editIsAvailable)}
                            className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                              editIsAvailable ? 'bg-emerald-500' : 'bg-slate-600'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                editIsAvailable ? '-translate-x-2' : 'translate-x-2'
                              }`}
                            />
                          </button>
                        </div>
                        """

content = content.replace(old_expanded, new_expanded)

# 5. Unavailable Badge in Card if Admin is viewing an unavailable product
old_card_start = """                  <div className="flex justify-between items-start mb-2">"""
new_card_start = """                  <div className="flex justify-between items-start mb-2">
                    {prod.isAvailable === false && !isEditing && (
                      <div className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-bold shadow-sm whitespace-nowrap z-10">
                        غير متاح
                      </div>
                    )}"""
content = content.replace(old_card_start, new_card_start)

# 6. Apply opacity if unavailable
old_card_container = """                  className={`relative flex flex-col p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md cursor-pointer ${"""
new_card_container = """                  className={`relative flex flex-col p-1.5 sm:p-2 rounded-md border shadow-sm transition-all hover:shadow-md cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${"""
content = content.replace(old_card_container, new_card_container)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
