export type AppTab = 'entry' | 'old_invoices' | 'routes' | 'reports' | 'evaluations' | 'products' | 'admin';

export interface UserAccount {
  name: string;
  roleName: string;
  role?: 'admin' | 'delegate' | 'dataEntry';
  isAdmin: boolean;
  username: string;
  monthlyTargetKg: number;
  delegateCode?: string;
  email?: string;
  delegateName?: string;
  targetSetTimestamp?: number;
}

export interface Category {
  id: number;
  name: string;
  dailyTargetWeightKg: number;
}

export interface DelegateTarget {
  id: string;
  delegateName: string;
  categoryName: string;
  dailyTargetWeightKg: number;
  lastUpdatedTimestamp?: number;
}

export interface DelegateAccount {
  username: string;
  password: string;
  delegateName: string;
  delegateCode?: string; // Add this
  monthlyTargetKg: number;
  isAdmin: boolean;
  role?: 'admin' | 'delegate' | 'dataEntry';
  targetSetTimestamp?: number;
}

export interface SalesEntry {
  id: string;
  invoiceId?: string;
  customerCode?: string;
  customerName: string;
  customerAddress?: string;
  customerType?: 'مفرد' | 'جملة';
  productName: string;
  categoryName: string;
  quantity: number;
  entryUnit?: 'piece' | 'carton';
  enteredQuantity?: number;
  pieceWeightKg: number;
  priceMode?: 'retail' | 'wholesale';
  totalWeightKg: number;
  delegateName: string;
  timestamp: number;
  dateString: string;
  isGift?: boolean;            // هل السطر هدية مجانية ترويجية
  giftPromotionId?: string;   // معرف عرض الهدية المرتبط إن وجد
}

export interface GiftPromotion {
  id: string;
  productCode: string;           // كود المنتج
  productName: string;           // اسم المنتج
  requirementCondition: string;  // الشرط المراد تحقيقه (نص توضيحي مثل: كل 15 قطعة أو كل 1 كارتون)
  conditionUnit?: 'piece' | 'carton'; // وحدة الشرط (قطعة أو كارتون)
  conditionQuantity: number;     // الكمية المطلوبة لتحقيق الشرط (مثلاً 15 قطعة)
  giftQuantityPieces: number;    // كمية الهدية بالقطع (مثلاً 1 قطعة هدية)
  customerType?: 'الكل' | 'مفرد' | 'جملة'; // نوع الزبون المشمول بالعرض (مفرد / جملة / الكل)
  startDate: string;             // تاريخ بدء التنفيذ (YYYY-MM-DD)
  endDate: string;               // تاريخ انتهاء التنفيذ (YYYY-MM-DD)
  notes?: string;                // ملاحظات إضافية
  isActive?: boolean;            // حالة التفعيل (مفعل أم معطل)
  createdAt?: number;
  updatedAt?: number;
}

export interface GridRow {
  id: string;
  category: string;
  pieceWeight: string;
  quantity: string;
  entryUnit?: 'piece' | 'carton';
  productName: string;
}

export interface CategoryReportItem {
  categoryId: number;
  categoryName: string;
  dailySalesWeightKg: number;
  dailyTargetWeightKg: number;
  percentage: number;
  isAchieved: boolean;
  remainingWeightKg: number;
}



export interface ToastNotification {
  id: string;
  type: 'milestone_50' | 'milestone_75' | 'milestone_100' | 'info' | 'success' | 'reminder' | 'gift_earned';
  title: string;
  message: string;
  percentage?: number;
  delegateName?: string;
  timestamp: number;
}

export interface DelegateEvaluation {
  delegateName: string;
  itemsCount?: number;
  totalPieces: number;
  totalCartons?: number;
  totalKg: number;
  totalWeightKg?: number;
  itemsScore?: number;
  piecesScore?: number;
  cartonsScore?: number;
  kgScore?: number;
  firstInvoiceTime?: string;
  firstInvoiceScore?: number;
  perfectItemsCount?: number;
  perfectItemsScore?: number;
  totalScore: number;
  breakdown?: {
    timeScore: number;
    salesScore: number;
    itemsScore: number;
    piecesScore: number;
    cartonsScore: number;
    targetCategoriesScore: number;
  };
}

export interface DailyEvaluationRecord {
  id: string;
  dateString: string;
  delegateName: string;
  totalScore: number;
  totalWeightKg: number;
  totalPieces: number;
  breakdown: {
    timeScore: number;
    salesScore: number;
    itemsScore: number;
    piecesScore: number;
    cartonsScore: number;
    targetCategoriesScore: number;
  };
  timestamp: number;
}
export interface ProductItem {
  id: string;
  productName: string;      // اسم المنتج
  cartonQuantity: string | number; // عدد في الكارتون
  categoryName: string;     // صنف المنتج
  productCode: string;      // كود المنتج
  pieceWeightKg: string | number; // وزن القطعة الواحدة
  retailPrice?: number;     // سعر المفرد
  wholesalePrice?: number;  // سعر الجملة
  stockCartons?: number;    // عدد الكارتون بالمخزن
  imageUrl?: string;        // صورة المنتج
  isAvailable?: boolean;    // حالة المنتج
}

export interface RouteItem {
  id: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string; // Add this field
  customerType: 'مفرد' | 'جملة';
  delegateName: string;
  delegateCode?: string; // New field
  path: string;
  position?: number;
}

export interface DebtItem {
  id: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  amountDue: number;
  invoiceDate: string;
  paymentDueDate: string;
  delegateName: string;
  delegateCode?: string;
  notified?: boolean;
}

export type DamagedProductStatus = 
  | 'تم ارسال ايميل به'
  | 'تم تعويضه'
  | 'لم يتم تعويضه لحد الان'
  | 'تم رفض التعويض';

export interface DamagedProductItem {
  id: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  customerType: 'مفرد' | 'جملة';
  productName: string;
  productCode: string;
  delegateName: string;
  batchNumber: string;
  purchaseDate: string; // YYYY-MM-DD
  purchaseQuantity: number;
  defectReason: string;
  images: string[]; // Base64 data URLs, minimum 3
  invoiceImage?: string; // Optional Base64 data URL for customer invoice photo
  status: DamagedProductStatus;
  createdAt: number;
  createdBy?: string;
  updatedAt?: number;
}



