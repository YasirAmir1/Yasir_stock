import re

with open('src/components/ProductsScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Imports
old_imports = "import { Package, Upload, Search, Edit3, Check, X, Shield, Plus, Trash2 } from 'lucide-react';"
new_imports = "import { Package, Upload, Search, Edit3, Check, X, Shield, Plus, Trash2, Camera, ImagePlus } from 'lucide-react';"
content = content.replace(old_imports, new_imports)

# 2. Add handleImageUpload function inside ProductsScreen
old_states = """  const [editStockCartons, setEditStockCartons] = useState<string | number>('');
  const [editImageUrl, setEditImageUrl] = useState('');

  const isAdmin = currentUser?.isAdmin || currentUser?.name === 'الأدمن';"""

new_states = """  const [editStockCartons, setEditStockCartons] = useState<string | number>('');
  const [editImageUrl, setEditImageUrl] = useState('');

  const isAdmin = currentUser?.isAdmin || currentUser?.name === 'الأدمن';

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 500;
        const MAX_HEIGHT = 500;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setEditImageUrl(compressedDataUrl);
        }
      };
    };
    e.target.value = ''; // Reset input
  };"""
content = content.replace(old_states, new_states)

# 3. Update the Expanded Details Section
old_expanded = """                  {/* Expanded Details Section */}
                  {(expandedId === prod.id || isEditing) && (
                    <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-2 animate-in slide-in-from-top-1 fade-in duration-200`}>
                      {isEditing ? (
                        <div className="flex flex-col gap-1 w-full">
                          <label className="text-[8px] font-bold text-slate-400">رابط صورة المنتج</label>
                          <input
                            type="text"
                            value={editImageUrl}
                            onChange={(e) => setEditImageUrl(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full px-2 py-1 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white text-right"
                            placeholder="http://..."
                          />
                        </div>
                      ) : (
                        prod.imageUrl && (
                          <div className="w-full flex justify-center">
                            <img 
                              src={prod.imageUrl} 
                              alt={prod.productName} 
                              className="w-24 h-24 object-contain rounded-md shadow-sm border border-slate-200 dark:border-slate-700 bg-white"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          </div>
                        )
                      )}
                    </div>
                  )}"""

new_expanded = """                  {/* Expanded Details Section */}
                  {(expandedId === prod.id || isEditing) && (
                    <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-2 animate-in slide-in-from-top-1 fade-in duration-200`}>
                      {isEditing ? (
                        <div className="flex flex-col gap-2 w-full">
                          <label className="text-[9px] font-bold text-slate-400">صورة المنتج (رابط أو رفع)</label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editImageUrl}
                              onChange={(e) => setEditImageUrl(e.target.value)}
                              onKeyDown={handleKeyDown}
                              className="flex-1 px-2 py-1.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white text-right"
                              placeholder="رابط الصورة (URL)"
                            />
                            <label className="cursor-pointer px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 flex items-center justify-center transition-colors" title="رفع من الجهاز">
                              <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleImageUpload}
                              />
                            </label>
                            <label className="cursor-pointer px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 flex items-center justify-center transition-colors" title="التقاط بالكاميرا">
                              <Camera className="w-3.5 h-3.5 text-amber-400" />
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={handleImageUpload}
                              />
                            </label>
                          </div>
                          {editImageUrl && (
                            <img src={editImageUrl} alt="Preview" className="w-16 h-16 object-contain mx-auto mt-1 rounded border border-slate-700 bg-white" />
                          )}
                        </div>
                      ) : (
                        prod.imageUrl && (
                          <div className="w-full flex justify-center">
                            <img 
                              src={prod.imageUrl} 
                              alt={prod.productName} 
                              className="w-24 h-24 object-contain rounded-md shadow-sm border border-slate-200 dark:border-slate-700 bg-white"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          </div>
                        )
                      )}
                    </div>
                  )}"""

content = content.replace(old_expanded, new_expanded)

with open('src/components/ProductsScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Camera logic added")
