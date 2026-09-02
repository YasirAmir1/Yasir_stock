import React, { useState, useMemo } from 'react';
import { useSales } from '../context/SalesContext';
import { ProductItem } from '../types';
import { Package, Upload, Search, Edit3, Check, X, Shield, Plus, Trash2, Camera, ImagePlus, AlertTriangle } from 'lucide-react';

const getAvatarProps = (name: string) => {
  const colors = [
    'bg-gradient-to-br from-red-400 to-red-600',
    'bg-gradient-to-br from-blue-400 to-blue-600',
    'bg-gradient-to-br from-green-400 to-green-600',
    'bg-gradient-to-br from-yellow-400 to-yellow-600',
    'bg-gradient-to-br from-purple-400 to-purple-600',
    'bg-gradient-to-br from-pink-400 to-pink-600',
    'bg-gradient-to-br from-indigo-400 to-indigo-600',
    'bg-gradient-to-br from-teal-400 to-teal-600',
    'bg-gradient-to-br from-orange-400 to-orange-600',
    'bg-gradient-to-br from-cyan-400 to-cyan-600'
  ];
  const charCode = name && name.length > 0 ? name.charCodeAt(0) : 0;
  const initial = name && name.length > 0 ? name.charAt(0).toUpperCase() : '?';
  const colorClass = colors[charCode % colors.length];
  return { initial, colorClass };
};

interface ProductsScreenProps {
  largeFont?: boolean;
}

export const ProductsScreen: React.FC<ProductsScreenProps> = ({ largeFont = false }) => {
  const { currentUser, productsList, importProductsFromExcel, updateProduct, addProduct, deleteProduct, deleteAllProducts, isDarkMode, setUserMessage, saveSalesEntries, selectedDelegate, rawSavedEntries } = useSales();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState(() => localStorage.getItem('pref_categoryFilter') || 'الكل');
  const [priceMode, setPriceMode] = useState<'retail' | 'wholesale'>(() => (localStorage.getItem('pref_priceMode') as 'retail' | 'wholesale') || 'retail');
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('pref_sortBy') || 'name');
  const [mobileGridCols, setMobileGridCols] = useState(() => localStorage.getItem('pref_mobileGridCols') || '2');

  React.useEffect(() => {
    localStorage.setItem('pref_categoryFilter', selectedCategoryFilter);
  }, [selectedCategoryFilter]);

  React.useEffect(() => {
    localStorage.setItem('pref_priceMode', priceMode);
  }, [priceMode]);

  React.useEffect(() => {
    localStorage.setItem('pref_sortBy', sortBy);
  }, [sortBy]);

  React.useEffect(() => {
    localStorage.setItem('pref_mobileGridCols', mobileGridCols);
  }, [mobileGridCols]);
  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedQuantities, setSelectedQuantities] = useState<Record<string, string>>({});
  const [entryModes, setEntryModes] = useState<Record<string, 'piece' | 'carton'>>({});
  const [addingQuantityId, setAddingQuantityId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Inline editing state for Admin
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editCartonQuantity, setEditCartonQuantity] = useState<string | number>('');
  const [editPieceWeightKg, setEditPieceWeightKg] = useState<string | number>('');
  const [editRetailPrice, setEditRetailPrice] = useState<string | number>('');
  const [editWholesalePrice, setEditWholesalePrice] = useState<string | number>('');
  const [editStockCartons, setEditStockCartons] = useState<string | number>('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editIsAvailable, setEditIsAvailable] = useState(true);

  // Standalone Image Upload Modal State
  const [showImageUploadModal, setShowImageUploadModal] = useState(false);
  const [imageUploadCode, setImageUploadCode] = useState('');
  const [imageUploadBase64, setImageUploadBase64] = useState('');
  const [imageUploadError, setImageUploadError] = useState('');

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
  };

  const categoriesList = useMemo(() => {
    const cats = new Set<string>();
    productsList.forEach(p => {
      if (p.categoryName) cats.add(p.categoryName);
    });
    return ['الكل', ...Array.from(cats)];
  }, [productsList]);

  const filteredProducts = useMemo(() => {
    let filtered = productsList.filter(p => {
      // Hide unavailable products and low stock products (<= 2) for non-admins
      if (!isAdmin && (p.isAvailable === false || (p.stockCartons || 0) <= 2)) return false;

      const matchSearch = 
        p.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.productCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchCat = selectedCategoryFilter === 'الكل' || p.categoryName === selectedCategoryFilter;
      return matchSearch && matchCat;
    });

    if (sortBy === 'most_sold') {
      const salesMap = new globalThis.Map<string, number>();
      rawSavedEntries?.forEach(entry => {
        salesMap.set(entry.productName, (salesMap.get(entry.productName) || 0) + entry.quantity);
      });
      filtered.sort((a, b) => {
        const salesA = salesMap.get(a.productName) || 0;
        const salesB = salesMap.get(b.productName) || 0;
        return salesB - salesA;
      });
    } else if (sortBy === 'file_order') {
      filtered.sort((a, b) => {
        return productsList.indexOf(a) - productsList.indexOf(b);
      });
    } else {
      filtered.sort((a, b) => {
        if (sortBy === 'name') return a.productName.localeCompare(b.productName);
        if (sortBy === 'category') return a.categoryName.localeCompare(b.categoryName);
        if (sortBy === 'weight') return (Number(b.pieceWeightKg) || 0) - (Number(a.pieceWeightKg) || 0);
        if (sortBy === 'price') {
          const priceA = (priceMode === 'retail' ? a.retailPrice : a.wholesalePrice) || 0;
          const priceB = (priceMode === 'retail' ? b.retailPrice : b.wholesalePrice) || 0;
          return (priceB * (Number(a.cartonQuantity) || 1)) - (priceA * (Number(b.cartonQuantity) || 1));
        }
        if (sortBy === 'stock') return (b.stockCartons || 0) - (a.stockCartons || 0);
        return 0;
      });
    }

    return filtered;
  }, [productsList, searchTerm, selectedCategoryFilter, isAdmin, sortBy, priceMode, rawSavedEntries]);

  const handleStandaloneImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          setImageUploadBase64(compressedDataUrl);
        }
      };
    };
    e.target.value = '';
  };

  const handleStandaloneImageSubmit = () => {
    setImageUploadError('');
    if (!imageUploadCode.trim()) {
      setImageUploadError('يرجى إدخال كود المنتج');
      return;
    }
    if (!imageUploadBase64) {
      setImageUploadError('يرجى اختيار صورة');
      return;
    }

    const prod = productsList.find(p => p.productCode === imageUploadCode.trim());
    if (!prod) {
      setImageUploadError('لم يتم العثور على منتج بهذا الكود');
      return;
    }

    updateProduct(prod.id, { imageUrl: imageUploadBase64 });
    setShowImageUploadModal(false);
    setImageUploadCode('');
    setImageUploadBase64('');
    setUserMessage('تم ربط الصورة بالمنتج بنجاح ✅');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importProductsFromExcel(file);
    e.target.value = '';
  };

  const downloadExcelTemplate = () => {
    const headers = [
      'صنف المنتج',
      'كود المنتج',
      'عدد بالكارتون',
      'اسم المنتج',
      'وزن القطعة الواحدة',
      'سعر القطعة مفرد',
      'سعر القطعة جملة',
      'عدد الكارتون المتوفر بالمخزن'
    ];
    const csvContent = '\uFEFF' + headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'نموذج_المنتجات.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startEditing = (p: ProductItem) => {
    if (!isAdmin) return;
    setEditingId(p.id);
    setEditCategoryName(p.categoryName);
    setEditProductCode(p.productCode);
    setEditProductName(p.productName);
    setEditCartonQuantity(p.cartonQuantity);
    setEditPieceWeightKg(p.pieceWeightKg.toString());
    setEditRetailPrice(p.retailPrice?.toString() || '0');
    setEditWholesalePrice(p.wholesalePrice?.toString() || '0');
    setEditStockCartons(p.stockCartons?.toString() || '0');
    setEditImageUrl(p.imageUrl || '');
    setEditIsAvailable(p.isAvailable !== false);
    setExpandedId(p.id); // Expand when editing
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const container = e.currentTarget.closest('tr, .relative.flex.flex-col');
      if (!container) return;
      const focusableElements = Array.from(
        container.querySelectorAll('input, select')
      ) as HTMLElement[];
      const index = focusableElements.indexOf(e.currentTarget);
      if (index > -1 && index + 1 < focusableElements.length) {
        focusableElements[index + 1].focus();
      } else if (index === focusableElements.length - 1) {
        const saveBtn = container.querySelector('button[title="حفظ"]') as HTMLButtonElement;
        if (saveBtn) {
          saveBtn.click();
        }
      }
    }
  };

  const saveEditing = (id: string) => {
    updateProduct(id, {
      categoryName: editCategoryName.trim() || 'عام',
      productCode: editProductCode.trim() || 'PRD-000',
      productName: editProductName.trim() || 'منتج جديد',
      cartonQuantity: Number(editCartonQuantity) || 12,
      pieceWeightKg: Number(editPieceWeightKg) || 0,
      retailPrice: Number(editRetailPrice) || 0,
      wholesalePrice: Number(editWholesalePrice) || 0,
      stockCartons: Number(editStockCartons) || 0,
      imageUrl: editImageUrl.trim(),
      isAvailable: editIsAvailable,
    });
    setEditingId(null);
  };

  const handleSaveQuickAdd = () => {
    setErrorMessage(null);
    const trimmedCustomerName = customerName.trim();
    if (!trimmedCustomerName) {
      setErrorMessage('تنبيه: لم تقم بإدخال اسم الزبون!');
      return;
    }

    const itemsToSave = [];
    const entries = Object.entries(selectedQuantities);
    if (entries.length === 0) {
      setErrorMessage('تنبيه: لم تقم بإضافة أي منتج للزبون.');
      return;
    }

    for (const [prodId, qtyStr] of entries) {
      let q = parseInt(qtyStr, 10);
      if (isNaN(q) || q <= 0) continue;
      
      const prod = productsList.find(p => p.id === prodId);
      if (!prod) continue;
      
      const unit = entryModes[prodId] || 'piece';
      const enteredQty = q;
      if (unit === 'carton') {
        q = q * (Number(prod.cartonQuantity) || 1);
      }
      
      const wGrams = Math.round(Number(prod.pieceWeightKg) * 1000) || 0;
      const pieceWeightKg = wGrams / 1000;
      const totalW = (q * wGrams) / 1000;
      
      itemsToSave.push({
        productName: prod.productName,
        categoryName: prod.categoryName,
        quantity: q,
        entryUnit: unit,
        enteredQuantity: enteredQty,
        pieceWeightKg: pieceWeightKg,
        totalWeightKg: totalW,
        delegateName: (currentUser?.isAdmin ? (selectedDelegate && selectedDelegate !== 'الكل' ? selectedDelegate : 'الأدمن') : currentUser?.name) || 'عام',
        dateString: new Date().toISOString().split('T')[0],
        customerName: trimmedCustomerName,
        customerCode: customerCode.trim(),
        customerAddress: customerAddress.trim(),
        priceMode: priceMode
      });
    }

    if (itemsToSave.length < 3) {
      setErrorMessage('تنبيه: يجب ادخال 3 منتجات او اكثر للحفظ');
      return;
    }

    if (itemsToSave.length > 0) {
      saveSalesEntries(itemsToSave);
      setUserMessage(`تم حفظ ${itemsToSave.length} منتجات للزبون ${trimmedCustomerName} وتم إرسالها لصفحة الإدخالات.`);
      setSelectedQuantities({});
      setCustomerName('');
      setCustomerCode('');
      setCustomerAddress('');
      setErrorMessage(null);
    }
  };

  const handleUpdateQuantity = (prodId: string, val: string) => {
    if (val === '') {
      const newQ = { ...selectedQuantities };
      delete newQ[prodId];
      setSelectedQuantities(newQ);
    } else {
      setSelectedQuantities({ ...selectedQuantities, [prodId]: val });
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 space-y-6 animate-in fade-in duration-300">
      {/* Header & Description */}
      {isAdmin && (
        <div className={`p-5 rounded-2xl border shadow-lg flex flex-col md:flex-row items-center justify-between gap-4 ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-emerald-200 text-slate-900'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center border border-emerald-500/30">
              <Package className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black tracking-tight">قائمة المنتجات والأصناف</h2>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                استعراض تفاصيل المنتجات، كود المنتج، عدد الكارتون، ووزن القطعة الواحدة. (يمكن للأدمن التعديل المباشر للأصناف)
              </p>
            </div>
          </div>

          {/* Admin Excel Upload & Add Product Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImageUploadModal(true)}
              className="cursor-pointer px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
              title="إضافة صور المنتجات"
            >
              <ImagePlus className="w-3 h-3" />
              <span>إضافة صور المنتجات</span>
            </button>
            <button
              onClick={() => {
                if(window.confirm('هل أنت متأكد من حذف جميع المنتجات؟ لا يمكن التراجع عن هذا الإجراء.')){
                  deleteAllProducts();
                }
              }}
              className="cursor-pointer px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
              title="حذف جميع المنتجات"
            >
              <Trash2 className="w-3 h-3" />
              <span>حذف الكل</span>
            </button>
            <button
              onClick={() => {
                addProduct();
                setSelectedCategoryFilter('الكل');
                setSearchTerm('');
              }}
              className="cursor-pointer px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95"
            >
              <Plus className="w-3 h-3" />
              <span>إضافة منتج</span>
            </button>
            <div className="flex flex-col gap-1 items-center">
              <label className="cursor-pointer px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-2 shadow-lg transition-all active:scale-95 w-full justify-center">
                <Upload className="w-3 h-3" />
                <span>رفع إكسل</span>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <button
                onClick={downloadExcelTemplate}
                className={`text-[9px] font-bold underline transition-colors hover:text-emerald-500 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}
              >
                تحميل نموذج الإكسل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Customer Info Box */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 sm:p-4 shadow-sm relative">
        {errorMessage && (
          <div className="mb-3 p-2.5 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg flex items-center justify-between">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 font-bold p-1">&times;</button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
            إضافة سريعة للمنتجات
          </h3>
          <button
            onClick={handleSaveQuickAdd}
            className="w-1/2 mx-auto sm:mx-0 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-xs sm:text-sm shadow-md transition-all active:scale-95"
          >
            حفظ الفاتورة
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الزبون (إلزامي)</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="اسم الزبون..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">كود الزبون</label>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="الكود..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">العنوان</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="العنوان..."
              className="w-full px-2 py-1.5 sm:px-3 sm:py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-[10px] sm:text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col gap-3">
        {/* Search on a single line */}
        <div className="relative w-full">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="بحث باسم المنتج أو الكود..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full pr-10 pl-4 py-3 rounded-xl border text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
              isDarkMode
                ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500'
                : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex items-center justify-center sm:justify-start w-full sm:w-auto bg-slate-200 dark:bg-slate-800 p-1.5 rounded-lg">
            <button
              onClick={() => setPriceMode('retail')}
              className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-xs sm:text-sm font-black transition-all ${priceMode === 'retail' ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
            >
              مفرد
            </button>
            <button
              onClick={() => setPriceMode('wholesale')}
              className={`flex-1 sm:flex-none px-6 py-2 rounded-md text-xs sm:text-sm font-black transition-all ${priceMode === 'wholesale' ? 'bg-white dark:bg-slate-700 shadow-md text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
            >
              جملة
            </button>
          </div>
          
          {categoriesList.length > 2 && (
            <div className="flex items-center gap-2 w-full flex-wrap pb-1 sm:pb-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] sm:text-[10px] font-bold shrink-0">الصنف:</span>
                {categoriesList.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategoryFilter(cat)}
                    className={`px-2 py-1 rounded text-[8px] sm:text-[9px] font-extrabold transition-all ${
                      selectedCategoryFilter === cat
                        ? 'bg-emerald-600 text-white shadow-md'
                        : isDarkMode
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mr-auto flex-wrap justify-end">
                <span className="text-[9px] sm:text-[10px] font-bold shrink-0">طريقة العرض:</span>
                <select
                  value={mobileGridCols}
                  onChange={(e) => setMobileGridCols(e.target.value)}
                  className={`text-[9px] sm:text-xs font-bold rounded p-1 focus:outline-none ${
                    isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                >
                  <option value="1">عرض 1 بطاقة</option>
                  <option value="2">عرض 2 بطاقة</option>
                  <option value="3">عرض 3 بطاقات</option>
                </select>

                <span className="text-[9px] sm:text-[10px] font-bold shrink-0 mr-2">الترتيب حسب:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className={`text-[9px] sm:text-xs font-bold rounded p-1 focus:outline-none ${
                    isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-200 text-slate-700 border-slate-300'
                  }`}
                >
                  <option value="name">الاسم</option>
                  <option value="category">الصنف</option>
                  <option value="weight">الوزن</option>
                  <option value="price">سعر الكارتون</option>
                  <option value="stock">الكمية المتوفرة</option>
                  <option value="most_sold">الأكثر مبيعاً</option>
                  <option value="file_order">ترتيب الملف المرفوع</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Products Grid */}
      <div className="mt-4 pb-12">
        {filteredProducts.length === 0 ? (
          <div className={`rounded-2xl border shadow-xl flex flex-col items-center justify-center py-12 px-4 text-center ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <Package className="w-12 h-12 text-slate-500 opacity-40 mb-3" />
            <p className="font-bold text-slate-400">لا توجد منتجات مسجلة حالياً.</p>
            {isAdmin && (
              <p className="text-xs text-slate-500 mt-1">
                قم بإضافة منتج جديد أو رفع ملف إكسل.
              </p>
            )}
          </div>
        ) : (
          <div className={`grid ${mobileGridCols === '1' ? 'grid-cols-1' : mobileGridCols === '3' ? 'grid-cols-3' : 'grid-cols-2'} sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-1.5 sm:gap-2`}>
            {filteredProducts.map((prod, idx) => {
              const isEditing = editingId === prod.id;
  return (
                <div
                  key={prod.id || idx}
                  onClick={() => !isEditing && setExpandedId(expandedId === prod.id ? null : prod.id)}
                  className={`relative flex flex-col gap-1 p-2 sm:p-2.5 rounded-lg border shadow-sm transition-all hover:shadow-md active:scale-95 cursor-pointer ${prod.isAvailable === false && !isEditing ? 'opacity-60 grayscale-[30%]' : ''} ${
                    isDarkMode 
                      ? 'bg-slate-900 border-slate-800 hover:border-emerald-500/30' 
                      : 'bg-white border-slate-200 hover:border-emerald-400/50'
                  } ${expandedId === prod.id ? (isDarkMode ? 'ring-1 ring-emerald-500/50' : 'ring-1 ring-emerald-400') : ''}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    {/* Category Label and Stock */}
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editCategoryName}
                          onChange={(e) => setEditCategoryName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-16 px-1 py-0.5 text-[8px] rounded border border-emerald-500 bg-slate-800 text-white font-bold text-center"
                          placeholder="الصنف"
                        />
                      ) : (
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                          isDarkMode ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60' : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        }`}>
                          {prod.categoryName}
                        </span>
                      )}
                      {!isEditing && prod.stockCartons !== undefined && prod.stockCartons > 0 && (
                        <div className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800/50 px-1.5 py-0.5 rounded text-[9px] font-black text-indigo-600 dark:text-indigo-400" title="عدد كارتون بالمخزن">
                          <Package className="w-2 h-2" />
                          {Number(prod.stockCartons).toLocaleString('en-US', {maximumFractionDigits: 0})}
                        </div>
                      )}
                    </div>
                    {/* Actions */}
                    {isAdmin && (
                      <div className="shrink-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => saveEditing(prod.id)}
                              title="حفظ"
                              className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow save-btn transition-all"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={cancelEditing}
                              title="إلغاء"
                              className="p-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow transition-all"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if(window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
                                  deleteProduct(prod.id);
                                }
                              }}
                              title="حذف المنتج"
                              className={`p-1 rounded-lg transition-all ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 border border-slate-700'
                                  : 'bg-slate-100 hover:bg-rose-50 text-slate-500 hover:text-rose-700 border border-slate-300'
                              }`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => startEditing(prod)}
                              title="تعديل تفاصيل المنتج"
                              className={`p-1 rounded-lg transition-all ${
                                isDarkMode
                                  ? 'bg-slate-800 hover:bg-emerald-950 text-slate-400 hover:text-emerald-400 border border-slate-700'
                                  : 'bg-slate-100 hover:bg-emerald-50 text-slate-500 hover:text-emerald-700 border border-slate-300'
                              }`}
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Product Code & Stock Cartons */}
                  <div className="text-right flex items-center justify-between">
                    <div>
                      {isEditing && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[8px] text-slate-400">عدد كارتون بالمخزن:</label>
                          <input
                            type="number"
                            value={editStockCartons}
                            onChange={(e) => setEditStockCartons(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-16 px-1 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                            placeholder="المخزن"
                          />
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editProductCode}
                        onChange={(e) => setEditProductCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-20 px-2 py-1 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-mono text-right"
                        placeholder="كود المنتج"
                      />
                    ) : (
                      <div className="font-mono text-[9px] sm:text-[10px] font-black text-cyan-600 dark:text-cyan-400 opacity-80">
                        {prod.productCode}
                      </div>
                    )}
                  </div>

                  {/* Product Name & Image */}
                  <div className="flex flex-col gap-1.5 items-center justify-center my-1.5 w-full min-h-[56px]">
                    <div className="text-center w-full">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editProductName}
                          onChange={(e) => setEditProductName(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-full px-2 py-1.5 text-sm rounded border border-emerald-500 bg-slate-800 text-white font-bold text-center"
                          placeholder="اسم المنتج"
                        />
                      ) : (
                        <h3 className={`font-black leading-tight text-slate-900 dark:text-slate-100 text-center ${largeFont ? 'text-lg sm:text-xl' : 'text-xs sm:text-sm'}`}>
                          {prod.productName}
                        </h3>
                      )}
                    </div>
                    
                    {/* Image Display */}
                    {!isEditing && (
                      <div className="shrink-0 animate-in fade-in zoom-in-95 duration-200">
                        {prod.imageUrl ? (
                          <img 
                            src={prod.imageUrl} 
                            alt={prod.productName} 
                            className="w-[170px] h-[170px] object-cover rounded-md shadow-sm border border-slate-200 dark:border-slate-700 bg-white"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                        ) : (
                          <div className={`w-[170px] h-[170px] flex flex-col items-center justify-center rounded-md shadow-sm border border-slate-200 dark:border-slate-700 text-white ${getAvatarProps(prod.productName).colorClass}`}>
                            <span className="text-5xl font-black opacity-90 drop-shadow-md">{getAvatarProps(prod.productName).initial}</span>
                            <span className="text-[10px] font-bold opacity-75 mt-2 bg-black/20 px-2 py-0.5 rounded">بدون صورة</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stats Grid */}
                  <div className={`grid grid-cols-2 gap-2 p-1.5 rounded-md border ${
                    isDarkMode ? 'bg-slate-950/50 border-slate-800/80' : 'bg-slate-50 border-slate-100'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center border-l border-slate-200 dark:border-slate-800">
                      <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">العدد بالكرتون</span>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editCartonQuantity}
                          onChange={(e) => setEditCartonQuantity(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-10 px-0.5 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                        />
                      ) : (
                        <span className="font-black text-amber-600 dark:text-amber-400 text-xs sm:text-sm">
                          {prod.cartonQuantity}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mb-0.5">وزن القطعة</span>
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            value={editPieceWeightKg}
                            onChange={(e) => setEditPieceWeightKg(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-10 px-0.5 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                          />
                        </div>
                      ) : (
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-xs sm:text-sm">
                          {Math.round(Number(prod.pieceWeightKg) * 1000)} غ
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Price Section */}
                  <div className={`mt-0.5 p-1.5 rounded-md border flex justify-between items-center ${
                    isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-[9px] font-bold text-slate-400 mb-0.5">سعر ({priceMode === 'retail' ? 'مفرد' : 'جملة'})</span>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={priceMode === 'retail' ? editRetailPrice : editWholesalePrice}
                          onChange={(e) => priceMode === 'retail' ? setEditRetailPrice(e.target.value) : setEditWholesalePrice(e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-16 px-1 py-0.5 text-[10px] rounded border border-emerald-500 bg-slate-800 text-white font-extrabold text-center"
                        />
                      ) : (
                        <span className={`font-black text-emerald-600 dark:text-emerald-400 ${largeFont ? 'text-lg sm:text-xl' : 'text-xs sm:text-[15px]'}`}>
                          {Number(priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)).toLocaleString('en-US', {maximumFractionDigits: 0})}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center justify-center text-center border-r border-slate-200 dark:border-slate-700 pr-2">
                      <span className="text-[9px] font-bold text-slate-400 mb-0.5">الكارتون</span>
                      <span className={`font-black text-indigo-600 dark:text-indigo-400 ${largeFont ? 'text-lg sm:text-xl' : 'text-xs sm:text-[15px]'}`}>
                        {Number((priceMode === 'retail' ? (prod.retailPrice || 0) : (prod.wholesalePrice || 0)) * (Number(prod.cartonQuantity) || 1)).toLocaleString('en-US', {maximumFractionDigits: 0})}
                      </span>
                    </div>
                  </div>
                  
                  {/* Quick Add Section */}
                  {!isEditing && (
                    <div className="mt-0.5 flex items-center gap-2">
                      {addingQuantityId === prod.id ? (
                        <div className="grid grid-cols-5 gap-1 w-full bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                          <input
                            type="number"
                            min="1"
                            placeholder="العدد"
                            value={selectedQuantities[prod.id] || ''}
                            onChange={(e) => handleUpdateQuantity(prod.id, e.target.value)}
                            className="col-span-3 w-full px-2 py-1 text-xs font-bold rounded-md border border-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:scale-105 transition-all text-center shadow-sm focus:shadow-emerald-500/30"
                            autoFocus
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEntryModes(prev => ({...prev, [prod.id]: prev[prod.id] === 'carton' ? 'piece' : 'carton'}));
                            }}
                            className="col-span-1 w-full flex items-center justify-center py-1 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-md transition-colors text-[10px] font-black shadow-sm"
                            title="تبديل بين قطعة وكارتون"
                          >
                            {entryModes[prod.id] === 'carton' ? 'ك' : 'ق'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddingQuantityId(null);
                            }}
                            className="col-span-1 w-full flex items-center justify-center py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors shadow-sm"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      ) : selectedQuantities[prod.id] ? (
                         <div 
                           className="flex items-center justify-between w-full bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-500 p-1.5 rounded-lg cursor-pointer"
                           onClick={(e) => {
                             e.stopPropagation();
                             setAddingQuantityId(prod.id);
                           }}
                         >
                           <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                             {entryModes[prod.id] === 'carton' ? 
                               `تم ادخال ${selectedQuantities[prod.id]} كارتون | ${Number(selectedQuantities[prod.id]) * (Number(prod.cartonQuantity) || 1)} قطع` : 
                               `تم ادخال ${selectedQuantities[prod.id]} قطع | ${parseFloat((Number(selectedQuantities[prod.id]) / (Number(prod.cartonQuantity) || 1)).toFixed(2))} كارتون`}
                           </span>
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               handleUpdateQuantity(prod.id, '');
                             }}
                             className="text-emerald-700 dark:text-emerald-400 hover:text-red-500 transition-colors"
                           >
                             <X className="w-3 h-3" />
                           </button>
                         </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddingQuantityId(prod.id);
                          }}
                          className="w-full py-1.5 bg-slate-100 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:bg-emerald-900/30 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg flex items-center justify-center gap-1 transition-all relative"
                        >
                          <Plus className="w-4 h-4" />
                          {prod.stockCartons !== undefined && (prod.stockCartons || 0) * (Number(prod.cartonQuantity) || 1) < 5 && (
                            <span title="الكمية قاربت على النفاد (أقل من 5 قطع)" className="absolute left-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Expanded Details Section */}
                  {(expandedId === prod.id || isEditing) && (
                    <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} flex flex-col gap-2 animate-in slide-in-from-top-1 fade-in duration-200`}>
                      {isEditing ? (
                        <>
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
                        </>
                      ) : null}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}

        {/* Footer Summary */}
        <div className={`mt-6 p-4 rounded-xl border flex items-center justify-between text-xs font-bold ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-600'
        }`}>
          <span>إجمالي المنتجات: <strong className="text-emerald-500">{filteredProducts.length}</strong></span>
          {isAdmin && (
            <span className="text-amber-500 dark:text-amber-400">✨ يمكنك تعديل أي منتج بالضغط على أيقونة التعديل</span>
          )}
        </div>
      </div>

      {showImageUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className={`w-full max-w-sm p-6 rounded-2xl shadow-2xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`font-black text-lg ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>إضافة صورة لمنتج</h3>
              <button onClick={() => setShowImageUploadModal(false)} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            
            {imageUploadError && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-500 text-xs font-bold">
                {imageUploadError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>كود المنتج</label>
                <input
                  type="text"
                  value={imageUploadCode}
                  onChange={(e) => setImageUploadCode(e.target.value)}
                  className={`w-full px-3 py-2 rounded-xl border text-sm font-bold text-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-emerald-500' : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-emerald-500'} focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all`}
                  placeholder="مثال: PRD-1234"
                  dir="ltr"
                />
              </div>

              <div>
                <label className={`block text-xs font-bold mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>صورة المنتج</label>
                <div className="flex flex-col items-center gap-3">
                  {imageUploadBase64 ? (
                    <div className="relative">
                      <img src={imageUploadBase64} alt="Preview" className="w-32 h-32 object-contain rounded-xl border border-slate-300 dark:border-slate-700 bg-white" />
                      <button onClick={() => setImageUploadBase64('')} className="absolute -top-2 -right-2 p-1 bg-rose-500 text-white rounded-full shadow-lg hover:bg-rose-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <label className={`w-full flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isDarkMode ? 'border-slate-700 hover:border-emerald-500 bg-slate-800/50 hover:bg-slate-800' : 'border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/50'}`}>
                      <ImagePlus className={`w-8 h-8 mb-2 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                      <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>اضغط لاختيار صورة</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleStandaloneImageUpload} />
                    </label>
                  )}
                </div>
              </div>

              <button
                onClick={handleStandaloneImageSubmit}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-sm shadow-lg shadow-emerald-900/20 transition-all active:scale-[0.98]"
              >
                حفظ الصورة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};