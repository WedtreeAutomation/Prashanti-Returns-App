import axios from 'axios';
import type { Order } from './types';
import { db } from './firebase';
import { 
  serverTimestamp, 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  query, 
  where, 
  getDocs, 
  orderBy 
} from 'firebase/firestore';
import { ReturnData, ReturnItem } from './types';

// ==========================================================
// CONFIGURATION
// ==========================================================
const FLASK_API_BASE_URL = import.meta.env.VITE_FLASK_API_URL;
const FLASK_API_KEY = import.meta.env.VITE_FLASK_API_KEY;


// ==========================================================
// TYPES
// ==========================================================
export interface RestockItem {
  lineItemId: number;
  quantityReturned: number;
  sku?: string;
  title?: string;
  variantId?: number;
  productId?: number;
}

export interface RestockRecord {
  id?: string;
  returnId: string;
  orderId: string;
  RAN: string;
  items: RestockItem[];
  totalQuantityRestocked: number;
  restockedAt: Date;
  restockedBy: string;
  condition?: string; // <--- ADD THIS LINE
  status: 'success' | 'pending' | 'failed';
  errorMessage?: string;
  shopifyResponse?: any;
}

// ==========================================================
// AXIOS INSTANCE WITH AUTHENTICATION
// ==========================================================
export const apiClient = axios.create({
  baseURL: FLASK_API_BASE_URL,
  headers: {
    'X-API-Key': FLASK_API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error('Authentication failed: Invalid or missing API key');
      throw new Error('Authentication failed. Please check your API key.');
    }
    if (error.response?.status === 403) {
      console.error('Authorization failed: Insufficient permissions');
      throw new Error('Authorization failed. You do not have permission to perform this action.');
    }
    if (error.response?.status === 404) {
      console.error('Resource not found');
      throw new Error('The requested resource was not found.');
    }
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout');
      throw new Error('Request timed out. Please try again.');
    }
    if (!error.response) {
      console.error('Network error:', error.message);
      throw new Error('Network error. Please check your connection.');
    }
    return Promise.reject(error);
  }
);

// ==========================================================
// ORDER API FUNCTIONS
// ==========================================================

/**
 * Fetch a specific order by name and verify ownership
 */
export const fetchOrderByName = async (orderName: string, verificationInput: string): Promise<Order | null> => {
  try {
    const response = await apiClient.post('/orders/verify', {
      orderName,
      verificationInput
    });

    if (response.data.order) {
      return response.data.order;
    }
    return null;
  } catch (error: any) {
    console.error("Error fetching specific order:", error);
    
    if (error.response?.status === 403) {
      throw new Error('Verification failed: Order details do not match.');
    }
    if (error.response?.status === 404) {
      throw new Error('Order not found or not fulfilled yet.');
    }
    if (error.response?.status === 400) {
      throw new Error('Invalid request. Please check your input.');
    }
    
    throw error;
  }
};

/**
 * Fetch all orders for a customer by email or phone
 */
export const fetchOrdersByCustomer = async (identifier: string): Promise<Order[]> => {
  try {
    const response = await apiClient.post('/orders/customer', {
      identifier
    });

    return response.data.orders || [];
  } catch (error) {
    console.error("Error fetching customer history:", error);
    return [];
  }
};

/**
 * Fetch Shopify order details by order name
 */
export const fetchShopifyOrder = async (orderName: string): Promise<Order | null> => {
  try {
    const response = await apiClient.get(`/orders/${encodeURIComponent(orderName)}`);
    
    if (response.data.order) {
      return response.data.order;
    }
    return null;
  } catch (error) {
    console.error("Error fetching shopify order details:", error);
    return null;
  }
};

/**
 * Fetch product details including image and tags
 */
export const fetchProductDetails = async (productId: number): Promise<{ image: string | null, tags: string[] }> => {
  if (!productId) return { image: null, tags: [] };
  
  try {
    const response = await apiClient.get(`/products/${productId}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching product details:", error);
    return { image: null, tags: [] };
  }
};

// ==========================================================
// ENHANCED RESTOCK FUNCTION WITH FIREBASE TRACKING
// ==========================================================

/**
 * Restock items in Shopify with comprehensive tracking
 * Supports multiple items with different quantities in a single call
 * 
 * @param items - Array of items with lineItemId and quantityReturned
 * @param orderId - Shopify order ID (numeric)
 * @param returnId - Firestore return document ID
 * @param RAN - Return Authorization Number
 * @param restockedBy - User who performed the restock (default: 'System')
 * @returns Promise<RestockRecord> - Detailed restock record
 */
export const restockShopifyItems = async (
  items: Array<{ lineItemId: number; quantityReturned: number; sku?: string; title?: string }>, 
  orderId: number,
  returnId: string,
  RAN: string,
  restockedBy: string = 'System',
  condition: string = 'Unknown' // <--- ADD THIS PARAMETER
): Promise<RestockRecord> => {
  // Validate inputs
  if (!items || items.length === 0) {
    throw new Error('No items to restock');
  }
  
  if (!orderId || typeof orderId !== 'number') {
    throw new Error('Valid order ID is required');
  }

  if (!returnId || !RAN) {
    throw new Error('Return ID and RAN are required for tracking');
  }

  // Validate each item has required fields
  const invalidItems = items.filter(item => !item.lineItemId || !item.quantityReturned);
  if (invalidItems.length > 0) {
    throw new Error(`Invalid items: ${JSON.stringify(invalidItems)}`);
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantityReturned, 0);
  
  // Create restock record object
  const restockRecord: RestockRecord = {
    returnId,
    orderId: orderId.toString(),
    RAN,
    condition, // <--- ADD IT TO THE OBJECT
    items: items.map(item => ({
      lineItemId: item.lineItemId,
      quantityReturned: item.quantityReturned,
      sku: item.sku,
      title: item.title
    })),
    totalQuantityRestocked: totalQuantity,
    restockedAt: new Date(),
    restockedBy,
    status: 'pending'
  };

  try {
    console.log(`🔄 Restocking ${items.length} items (${totalQuantity} units) for order ${orderId}, RAN: ${RAN}`);
    
    // Step 1: Call Shopify API via Flask backend
    const response = await apiClient.post(`/orders/${orderId}/restock`, {
      items: items.map(item => ({
        lineItemId: item.lineItemId,
        quantityReturned: item.quantityReturned
      }))
    });
    
    if (response.status === 200 || response.status === 201) {
      console.log(`✅ Successfully restocked ${items.length} items (${totalQuantity} units) for order ${orderId}`);
      
      // Update restock record with success status
      restockRecord.status = 'success';
      restockRecord.shopifyResponse = response.data;
      
      // Step 2: Save restock record to Firebase
      await saveRestockRecord(restockRecord);
      
      return restockRecord;
    }
    
    throw new Error(`Restock failed with status: ${response.status}`);
    
  } catch (error: any) {
    console.error(`❌ Failed to restock items for order ${orderId}:`, error);
    
    // Update restock record with failure details
    restockRecord.status = 'failed';
    restockRecord.errorMessage = error.response?.data?.error || error.message || 'Unknown error';
    restockRecord.shopifyResponse = error.response?.data;
    
    // Save failed restock record to Firebase for tracking
    await saveRestockRecord(restockRecord);
    
    // Provide more detailed error message
    if (error.response?.data?.error) {
      throw new Error(`Restock failed: ${error.response.data.error}`);
    }
    if (error.response?.status === 404) {
      throw new Error(`Order ${orderId} not found`);
    }
    if (error.response?.status === 400) {
      throw new Error(`Invalid request: ${error.response.data?.error || 'Check item data'}`);
    }
    
    throw error;
  }
};

/**
 * Save restock record to Firebase
 */
const saveRestockRecord = async (record: RestockRecord): Promise<void> => {
  try {
    
    const restockRef = collection(db, 'restock_history');
    
    const firestoreRecord = {
      ...record,
      restockedAt: serverTimestamp(),
      items: record.items.map(item => ({
        lineItemId: item.lineItemId,
        quantityReturned: item.quantityReturned,
        sku: item.sku || '',
        title: item.title || ''
      }))
    };
    
    const docRef = await addDoc(restockRef, firestoreRecord);
    console.log(`📝 Restock record saved to Firebase with ID: ${docRef.id}`);
    
    // Also update the main return document to indicate restock status
    await updateReturnRestockStatus(record.returnId, record);
    
  } catch (error) {
    console.error('Failed to save restock record to Firebase:', error);
    // Don't throw - restock already succeeded, just log the error
  }
};

/**
 * Update the main return document with restock information
 */
const updateReturnRestockStatus = async (returnId: string, record: RestockRecord): Promise<void> => {
  try {
    
    const returnRef = doc(db, 'returns', returnId);
    
    await updateDoc(returnRef, {
      isRestocked: record.status === 'success',
      restockStatus: record.status === 'success' ? 'Completed' : 'Failed',
      restockedAt: serverTimestamp(),
      restockedItems: record.items.map(item => ({
        lineItemId: item.lineItemId,
        quantity: item.quantityReturned,
        sku: item.sku,
        title: item.title
      })),
      totalQuantityRestocked: record.totalQuantityRestocked,
      restockErrorMessage: record.errorMessage,
      restockRecordId: record.id,
      updatedAt: serverTimestamp()
    });
    
    console.log(`✅ Updated return ${returnId} with restock status`);
    
  } catch (error) {
    console.error('Failed to update return restock status:', error);
  }
};

/**
 * Get restock history for a specific return
 */
export const getRestockHistory = async (returnId: string): Promise<RestockRecord[]> => {
  try {
    
    const restockRef = collection(db, 'restock_history');
    const q = query(
      restockRef, 
      where('returnId', '==', returnId),
      orderBy('restockedAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const history: RestockRecord[] = [];
    
    querySnapshot.forEach((doc) => {
      history.push({ id: doc.id, ...doc.data() } as RestockRecord);
    });
    
    return history;
    
  } catch (error) {
    console.error('Failed to fetch restock history:', error);
    return [];
  }
};

// ==========================================================
// WEBHOOK FUNCTIONS
// ==========================================================

export const notifyReturnSubmission = async (returnData: any): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/return-applied', returnData);
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify return submission:", error);
    return false;
  }
};

/**
 * Notify backend to trigger item rejection webhook
 */
export const notifyItemRejection = async (
  returnData: ReturnData,
  rejectedItem: ReturnItem,
  reason: string
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/item-rejection', {
      RAN: returnData.RAN,
      orderId: returnData.orderId,
      customer: returnData.customer,
      rejectedItem: {
        lineItemId: rejectedItem.lineItemId,
        title: rejectedItem.title,
        sku: rejectedItem.sku,
        quantityReturned: rejectedItem.quantityReturned,
        price: rejectedItem.price,
        productImage: rejectedItem.productImage,
        reason: reason
      },
      remainingItemsCount: returnData.items.filter(i => i.lineItemId !== rejectedItem.lineItemId).length,
      rejectionReason: reason
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify item rejection:", error);
    return false;
  }
};

/**
 * Notify backend to trigger return rejection webhook
 */
export const notifyReturnRejection = async (returnData: any, reason: string, allowResubmit: boolean): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/return-rejection', {
      returnData,
      reason,
      allowResubmit
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify return rejection:", error);
    return false;
  }
};

/**
 * Notify backend to trigger self-ship request webhook
 */
export const notifySelfShip = async (returnData: any, selfShipDetails: any): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/self-ship', {
      returnData,
      selfShipDetails
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify self-ship:", error);
    return false;
  }
};

/**
 * Notify backend to trigger refund completion webhook
 */
export const notifyRefundDone = async (
  returnData: any,
  refundDetails: {
    method: 'gift_card' | 'store_credit' | 'original_payment' | 'manual';
    amount: number;
    giftCardCode?: string;
    transactionId?: string;
    paymentMethod?: string;
    creditReference?: string;
    expiryDate?: string;
  }
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/refund-done', {
      returnData,
      refundDetails
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify refund done:", error);
    return false;
  }
};

/**
 * Notify backend to trigger pickup creation webhook
 */
export const notifyPickupCreated = async (
  returnData: any,
  pickupDetails: {
    scheduledDate: string;
    timeSlot?: string;
    courierPartner?: string;
    trackingNumber?: string;
    address?: string;
    city?: string;
    zip?: string;
  }
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/pickup-created', {
      returnData,
      pickupDetails
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify pickup created:", error);
    return false;
  }
};

/**
 * Notify backend to trigger pickup cancellation webhook
 */
export const notifyPickupCancelled = async (
  returnData: any,
  cancellationDetails: {
    reason: string;
    additionalNotes?: string;
    rescheduleAllowed: boolean;
  }
): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/pickup-cancelled', {
      returnData,
      cancellationDetails
    });
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify pickup cancelled:", error);
    return false;
  }
};

/**
 * Notify backend to trigger return received webhook
 */
export const notifyReturnReceived = async (data: {
  RAN: string;
  orderId: string;
  customer: { name?: string; email?: string };
  items: any[];
  requestedMethod?: string;
  itemCondition: string;
  restockInfo?: {
    restocked: boolean;
    totalQuantityRestocked: number;
  };
}): Promise<boolean> => {
  try {
    const response = await apiClient.post('/webhooks/return-received', data);
    return response.data?.success || false;
  } catch (error) {
    console.error("Failed to notify return received:", error);
    return false;
  }
};

/**
 * Get formatted refund method display name (Kept for UI display purposes)
 */
export const getRefundMethodDisplay = (method: string): string => {
  switch (method) {
    case 'store_credit': return 'Store Credit';
    case 'gift_card': return 'Gift Card';
    case 'refund': return 'Original Payment Method';
    default: return method || 'Unknown';
  }
};

// ==========================================================
// TYPE DEFINITIONS FOR API RESPONSES
// ==========================================================
export interface ApiError {
  error: string;
  success?: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}