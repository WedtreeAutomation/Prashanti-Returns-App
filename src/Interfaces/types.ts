import { Timestamp } from 'firebase/firestore'

export interface LineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string | null;
  variant_title: string | null;
  product_id: number | null;
}

export interface Customer {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface Address {
  address1: string;
  address2: string | null;
  city: string;
  province?: string;
  province_code: string | null;
  zip: string;
  country: string;
  phone?: string | null;
  first_name?: string;     
  last_name?: string;
}

export interface ReturnItem {
  lineItemId: number;
  title: string;
  sku: string;
  price: string;
  productImage: string;
  quantityReturned: number;
  reason: string;
  note: string
  customerImages: string[];
}

export interface CreatePickupModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  RAN: string;
  customer?: Customer | null;
  currentUser?: User | null;
  shippingAddress?: Address | null;
  items?: ReturnItem[] | null;
  rejectedItems?: RejectedItem[] | null;
  onSuccess?: () => void;
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: 'cm' | 'in';
  weight: number;
  weightUnit: 'kg' | 'g' | 'lb';
}


export interface ReturnData {
  id: string;
  RAN: string;
  orderId: string;
  orderNumericId: number;
  type?: string;
  status: string;
  refundStatus?: string;
  shipmentStatus?: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  items: ReturnItem[];
  requestedMethod?: string;
  paymentMethod?: string;
  refundEligibility?: string;
  awb?: string;
  shippingLabelUrl?: string;
  trackingNumber?: string;
  courierPartner?: string;
  pickupDate?: string;
  pickupTime?: string;
  pickupAddress?: string;
  returned_product_received?: boolean;
  receivedAt?: any;
  itemCondition?: string;
  isRestocked?: boolean;
  restockedAt?: any;
  restockFailed?: boolean;
  restockErrorMessage?: string;
  hasDefectiveItems?: boolean;
  rejectionReason?: string;
  denialReason?: string;
  closeReason?: string;
  allowResubmit?: boolean;
  DeniedMailSent?: boolean;
  ClosedMailSent?: boolean;
  emailSentAt?: any;
  lastEmailAttempt?: any;
  createdAt?: any;
  refundedAt?: any;
  updatedAt?: any;
  completedAt?: any;
  rejectedItems?: RejectedItem[];
}

export interface ReturnEmailPayload {
  RAN: string;
  orderId: string;
  orderNumericId: number;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  items: Array<{
    lineItemId: number;
    title: string;
    sku: string;
    price: number;
    productImage: string;
    quantityReturned: number;
    reason: string;
    note: string;
    customerImages: string[];
  }>;
  type: string;
  status: string;
  requestedMethod: string;
  refundEligibility: string;
  hasDefectiveItems: boolean;
  submittedAt: string;
  totalRefundAmount: number;
  imageCount: number;
  timeline: {
    submitted: string;
    estimatedProcessing: string;
  };
  shopDetails: {
    name: string;
    supportEmail: string;
    website: string;
  };
}

export interface Order {
  id: number;
  name: string;
  email: string;
  contact_email?: string | null;
  phone?: string | null;
  tags?: string; 
  currency: string;
  total_price: string;
  delivered_at?: string | null;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  line_items: LineItem[];
  customer: Customer;
  shipping_address?: Address;
}

export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

// Utility to handle persistent login state
const USER_STORAGE_KEY = 'prashanti_agent_user';

export interface User {
  email: string;
  name: string;
  role: "agent";
  profilePic?: string;
  phone?: string;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
}

export const saveUserToStorage = (user: User) => {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch (error) {
    console.error("Failed to save user to storage:", error);
  }
};

export const getUserFromStorage = (): User | null => {
  try {
    const userStr = localStorage.getItem(USER_STORAGE_KEY);
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (error) {
    console.error("Failed to get user from storage:", error);
    return null;
  }
};

export const clearUserFromStorage = () => {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear user from storage:", error);
  }
};

export interface ActivityItem {
  id: string;
  type: 'success' | 'info' | 'processing' | 'warning' | 'note' | 'notification';
  title: string;
  description: string;
  timestamp: Timestamp;
  user?: string;
  metadata?: any;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  externalId: string;
  address1: string;
  address2: string;
  address3: string;
  country: string;
  state: string;
  city: string;
  pincode: string;
  phone: string;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface PackageTemplate {
  id: string;
  name: string;
  weight: number;
  weightUnit: 'kg' | 'g';
  length: number;
  width: number;
  height: number;
  dimensionUnit: 'cm' | 'in';
  isActive?: boolean;       
  createdAt?: any;          
  updatedAt?: any;
}
export interface ShopifyLineItem {
  id: number;
  price: string;
  sku: string;
  quantity: number;
  tax_lines?: Array<{ price: string | number }>;
  discount_allocations?: Array<{ amount: string | number }>;
}

export interface ShopifyOrder {
  id: number;
  name?: string;
  order_number?: number;
  line_items?: ShopifyLineItem[];
  paymentGatewayNames?: string[];
  customer?: {
    id: number;
    email: string;
  };
}

export interface RefundDetails {
  method: string;
  baseAmount: number;
  deductions: number;
  finalAmount: number;
  taxDeducted: number;
  reverseShipmentFeeDeducted: number;
  restockingFee: number;
  adjustmentAmount: number;
  forwardShipmentFee?: number;
  shopifyRefundId?: string;
  transactionId?: string;
  shopifyResponse?: any;
  giftCardCode?: string;
  transactions?: any[];
}

export interface RefundResult {
  success: boolean;
  refundMethod: string;
  refundId?: string;
  transactionId?: string;
  amount?: string;
  currency?: string;
  firebaseUpdated?: string;
  giftCardCode?: string;
  errorMessage?: string;
  transactions?: any[];
  orderName?: string;
}

export interface CancelPickupModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  RAN: string;
  currentAWB?: string; 
  customerEmail?: string; // Important for N8N email delivery
  onSuccess?: (awb: string) => void;
  currentUser?: User | null;
}

export interface SelfShipModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  RAN: string;
  customerEmail?: string;
  customerName?: string;
  requestedMethod?: 'gift_card' | 'store_credit' | 'refund';
  currentUser?: User | null;
}

export interface MarkReceivedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (category: string, restock: boolean) => Promise<{ emailSent?: boolean } | void>;
  currentUser?: User | null;
  items?: ReturnItem[]; // Items to be processed (already filtered - active items only)
  RAN?: string; // Return Authorization Number
  orderId?: string; // Order ID for reference
  customerName?: string; // Customer name for email
  customerEmail?: string; // Customer email for notification
  requestedMethod?: string; // Refund method (gift_card, store_credit, refund)
}

export interface RejectRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string, allowResubmit: boolean, itemId?: number) => Promise<void>;
  orderId?: string;
  RAN?: string;
  currentUser?: User | null;
  customerEmail?: string;
  customerName?: string;
  itemIdToReject?: number;
  itemToReject?: ReturnItem;
}

export interface RejectedItem {
  lineItemId: number;
  title: string;
  sku: string;
  quantityReturned: number;
  price: string;
  reason: string;
  rejectedAt: Timestamp;
  rejectedBy: string;
  rejectedByName: string;
}

export interface IssueRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  data: ReturnData; // Replace the inline data type with ReturnData
  shopifyOrder?: ShopifyOrder;
  currentUser?: User | null;
}

export interface CheckboxWithInputProps {
  label: string;
  checked: boolean;
  onChangeCheck: (checked: boolean) => void;
  inputValue: string;
  onChangeInput: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputDisabled?: boolean;
  min?: number;
  max?: number;
}

export interface ReturnRequest {
  id: string;
  RAN: string;
  orderId: string;
  awb?: string;
  status: string;
  shipmentStatus?: string;
  refundStatus?: string;
  refundMethod?: string;
  requestedMethod?: 'refund' | 'gift_card' | 'store_credit';
  createdAt: any;
  updatedAt?: any;
  refundedAt?: any;
  isRestocked?: boolean;
  completedAt?: any;
  receivedAt?: any;
  rejectionReason?: string;
  items: Array<{
    title: string;
    quantityReturned: number;
    price?: string;
  }>;
  customer: {
    name: string;
    email: string;
  };
  refundDetails?: {
    finalAmount?: number;
    method?: string;
  };
  refundAmount?: number;
  rejectedItems?: Array<any>;
}

export interface RecentActivity {
  id: string;
  RAN: string;
  orderId: string;
  type: 'return_submitted' | 'pickup_created' | 'item_received' | 'refund_issued' | 'return_rejected' | 'note_added';
  title: string;
  description: string;
  timestamp: any;
  amount?: number;
  method?: string;
}

export interface ProductReturnData {
  variantId: string;
  title: string;
  sku: string;
  price: number;
  image?: string;
  returnCount: number;
  totalQuantity: number;
  totalValue: number;
  reasons: Record<string, number>;
  returnRate: number; // percentage of orders this product was returned
}


export interface CustomerReturnData {
  customerId: string;
  name: string;
  email: string;
  returnCount: number;
  totalValue: number;
  phone?: string;
}

export interface StateReturnData {
  state: string;
  returnCount: number;
  totalValue: number;
  uniqueCustomers: number;
}

export interface ReasonData {
  reason: string;
  count: number;
  percentage: number;
  totalValue: number;
}

export interface ResolutionData {
  type: string;
  count: number;
  percentage: number;
  totalValue: number;
}

export interface DashboardStats {
  totalReturns: number;
  openReturns: number;
  pendingApproval: number;
  activeShipments: number;
  completedReturns: number;
  rejectedReturns: number;
  totalRefundedAmount: number;
  todayRefundedAmount: number;
  avgProcessingDays: number;
  pendingRefunds: number;
  giftCardReturns: number;
  storeCreditReturns: number;
  originalPaymentReturns: number;
}