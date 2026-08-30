export interface UserAccount {
  name: string;
  roleName: string;
  isAdmin: boolean;
  username: string;
  monthlyTargetKg: number;
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
  monthlyTargetKg: number;
  isAdmin: boolean;
  targetSetTimestamp?: number;
}

export interface SalesEntry {
  id: string;
  customerCode?: string;
  customerName: string;
  customerAddress?: string;
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
  type: 'milestone_50' | 'milestone_75' | 'milestone_100' | 'info' | 'success' | 'reminder';
  title: string;
  message: string;
  percentage: number;
  delegateName: string;
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



