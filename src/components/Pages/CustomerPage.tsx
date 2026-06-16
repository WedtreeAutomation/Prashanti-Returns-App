import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  PackageOpen,
  ArrowRight,
  Check,
  Truck,
  AlertCircle,
  Camera,
  Trash2,
  ArrowLeft,
  Wallet,
  Info,
  Search,
  History,
  ChevronRight,
  ChevronLeft,
  CreditCard,
  Loader2,
  XCircle,
  Globe,
  Eye,
  Edit2,
  Gift,
  Menu,
  X
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../Interfaces/firebase';
import { serverTimestamp, doc, setDoc, updateDoc, runTransaction, getDoc } from 'firebase/firestore';
import { fetchOrderByName, fetchProductDetails, fetchShopifyOrder, notifyReturnSubmission } from '../../Interfaces/api';
import type { Order } from '../../Interfaces/types';
import { Link } from 'react-router-dom';

const RETURN_REASONS = [
  "Wrong item shipped",
  "Color mismatch",
  "Size/fit issue",
  "Product quality issue",
  "I received a defective item",
  "Delivery was delayed",
  "Other reason"
] as const;

const CUSTOM_KEYWORDS = [
  'custom',
  'tailoring',
  'bespoke',
  'bspoke',
  'stitching',
  'blouse',
  'fall',
  'pico',
  'measurements',
  'saree finishing',
  'tassels'
];

const MAX_IMAGES = 6;
const MANDATORY_IMAGES = 2;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const RETURN_STATUSES = {
  OPEN: 'Open',
  PICKUP_CREATED: 'Pickup Created',
  ITEM_DELIVERED: 'Item Delivered',
  CLOSED: 'Closed',
  DENIED: 'Denied'
} as const;

// Allowed countries for returns (only India)
const ALLOWED_COUNTRIES = ['India', 'IN', 'भारत'];

type ReturnMethod = 'store_credit' | 'gift_card' | 'refund';
type Step = 'LOGIN' | 'SELECT' | 'METHOD' | 'REVIEW' | 'CONFIRMATION';

// ==========================================
// HELPER FUNCTIONS (outside component)
// ==========================================
const generateInitialImagesArray = () => Array(MAX_IMAGES).fill(null);

const validateFile = (file: File): { valid: boolean; error?: string } => {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File size should be less than 5MB' };
  }
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, WebP, and HEIC images are allowed' };
  }
  return { valid: true };
};

// Check if country is India
const isIndianAddress = (country?: string): boolean => {
  if (!country) return false;
  const normalizedCountry = country.trim().toLowerCase();
  return ALLOWED_COUNTRIES.some(allowed =>
    allowed.toLowerCase() === normalizedCountry ||
    normalizedCountry.includes(allowed.toLowerCase())
  );
};

const ImageCarousel = ({ images }: { images: string[] }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="relative aspect-square rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center p-4 text-center text-slate-400 text-sm">
        No images uploaded
      </div>
    );
  }

  const next = () => setCurrentIndex((prev) => (prev + 1) % images.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <div className="relative h-64 sm:h-80 w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center group">
      <img 
        src={images[currentIndex]} 
        alt={`Upload ${currentIndex + 1}`} 
        className="w-full h-full object-contain transition-opacity duration-300 p-2" 
      />

      <span className="absolute top-2 left-2 px-2.5 py-1 bg-black/60 text-white text-xs font-medium rounded-full backdrop-blur-sm">
        {currentIndex + 1} / {images.length}
      </span>

      {images.length > 1 && (
        <>
          <button 
            onClick={prev} 
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 hover:bg-white text-slate-800 rounded-full flex items-center justify-center shadow-md backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-105"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <button 
            onClick={next} 
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 hover:bg-white text-slate-800 rounded-full flex items-center justify-center shadow-md backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-105"
            aria-label="Next image"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 bg-black/20 px-2 py-1.5 rounded-full backdrop-blur-sm">
            {images.map((_, idx) => (
              <div 
                key={idx} 
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? 'bg-white w-3' : 'bg-white/50'
                }`} 
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const compressImage = (file: File, maxWidth = 1024): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Calculate new dimensions maintaining aspect ratio
        const scaleSize = maxWidth / img.width;
        canvas.width = maxWidth;
        canvas.height = img.height * scaleSize;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Convert back to a file (0.7 = 70% JPEG quality)
        canvas.toBlob((blob) => {
          if (blob) {
            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(newFile);
          } else {
            resolve(file); // Fallback to original if compression fails
          }
        }, 'image/jpeg', 0.7); 
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Format currency
const formatCurrency = (amount: string | number): string => {
  const num = typeof amount === 'string' ? parseFloat(amount.replace(/[^0-9.]/g, '')) : amount;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

// ==========================================
// MOBILE HEADER COMPONENT
// ==========================================
const MobileHeader = ({ 
  step, 
  onMenuToggle,
  isMenuOpen 
}: { 
  step: Step; 
  onMenuToggle: () => void;
  isMenuOpen: boolean;
}) => {
  const getStepTitle = () => {
    switch(step) {
      case 'LOGIN': return 'Start Return';
      case 'SELECT': return 'Select Items';
      case 'METHOD': return 'Return Method';
      case 'REVIEW': return 'Review';
      case 'CONFIRMATION': return 'Confirmation';
      default: return 'Return Portal';
    }
  };

  return (
    <div className="lg:hidden bg-[#5A0A38] border-b border-[#5A0A38]/20 sticky top-0 z-50">
      <div className="px-4 py-3 flex items-center justify-between">
        <Link to="/CustomerPage" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
            <PackageOpen className="w-4 h-4 text-[#5A0A38]" />
          </div>
          <span className="font-bold text-sm text-white">
            Prashanti<span className="text-pink-300">Returns</span>
          </span>
        </Link>
        
        <div className="flex items-center gap-2">
          <Link
            to="/ReturnStatusPage"
            className="text-white/80 p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Search className="w-5 h-5" />
          </Link>
          <button
            onClick={onMenuToggle}
            className="p-2 hover:bg-white/10 rounded-lg text-white"
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/70">Step</span>
          <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-white transition-all duration-300"
              style={{ 
                width: step === 'LOGIN' ? '20%' : 
                       step === 'SELECT' ? '40%' :
                       step === 'METHOD' ? '60%' :
                       step === 'REVIEW' ? '80%' : '100%'
              }}
            />
          </div>
          <span className="text-xs font-medium text-white/90">{getStepTitle()}</span>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN COMPONENT
// ==========================================
export const ReturnPortalSplit = () => {
  // --- UI State ---
  const [step, setStep] = useState<Step>('LOGIN');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // --- Loading States ---
  const [isSpecificLoading, setSpecificLoading] = useState(false);

  // --- Return Settings State ---
  const [returnDaysLimit, setReturnDaysLimit] = useState<number>(14);

  // --- Modal State ---
  const [ineligibleModal, setIneligibleModal] = useState<{ 
    show: boolean; 
    orderName: string; 
    type: 'custom' | 'active_return' | 'international' | 'time_window' 
  }>({
    show: false,
    orderName: '',
    type: 'custom'
  });

  // --- Input States ---
  const [specificOrderId, setSpecificOrderId] = useState('');
  const [specificEmail, setSpecificEmail] = useState('');

  // --- Data States ---
  const [order, setOrder] = useState<Order | null>(null);
  const [enrichedOrderData, setEnrichedOrderData] = useState<any | null>(null);

  // Store details object (image + tags) instead of just image string
  const [productDetails, setProductDetails] = useState<Record<number, { image: string | null, tags: string[] }>>({});

  const [generatedRAN, setGeneratedRAN] = useState<string>('');

  // --- Return Status States ---
  const [orderReturnStatus, setOrderReturnStatus] = useState<Record<string, { status: string; items: Record<number, string> }>>({});
  const [checkingStatus, setCheckingStatus] = useState<Record<string, boolean>>({});

  // --- Return Selection States ---
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [returnDetails, setReturnDetails] = useState<Record<number, { qty: number; reason: string; note: string }>>({});
  const [uploadFiles, setUploadFiles] = useState<Record<number, (File | null)[]>>({});
  const [previews, setPreviews] = useState<Record<number, (string | null)[]>>({});
  const [selectedMethod, setSelectedMethod] = useState<ReturnMethod>('store_credit');

  // --- Review State ---
  const [reviewData, setReviewData] = useState<{
    items: Array<{
      id: number;
      title: string;
      sku: string;
      price: string;
      quantity: number;
      reason: string;
      note: string;
      images: string[];
      productImage: string;
    }>;
    customerInfo: {
      name: string;
      email: string;
      phone: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
    totalAmount: number;
    selectedMethod: ReturnMethod;
    hasDefectiveItems: boolean;
  } | null>(null);

  // ==========================================
  // HELPER FUNCTIONS (inside component)
  // ==========================================
  
  /**
   * Check if order is within return period (dynamic days from settings)
   */
  const isWithinReturnPeriod = useCallback((target_date: string): boolean => {
    if (!target_date) return false;
    
    const orderDate = new Date(target_date);
    const currentDate = new Date();
    const diffTime = currentDate.getTime() - orderDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    
    return diffDays <= returnDaysLimit;
  }, [returnDaysLimit]);

  /**
   * Get days since order creation/delivery
   */
  const getDaysSinceOrder = useCallback((target_date: string): number => {
    if (!target_date) return 0;
    
    const orderDate = new Date(target_date);
    const currentDate = new Date();
    const diffTime = currentDate.getTime() - orderDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }, []);

  // ==========================================
  // FETCH RETURN SETTINGS
  // ==========================================
  const fetchReturnSettings = useCallback(async () => {
    try {
      const settingsDoc = await getDoc(doc(db, 'settings', 'returnSettings'));
      if (settingsDoc.exists()) {
        const data = settingsDoc.data();
        setReturnDaysLimit(data.returnDaysLimit || 14);
      }
    } catch (error) {
      console.error("Error fetching return settings:", error);
    }
  }, []);

  // Call this in useEffect when component mounts
  useEffect(() => {
    fetchReturnSettings();
  }, [fetchReturnSettings]);

  // Close mobile menu when step changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [step]);

  // ==========================================
  // CUSTOMIZATION LOGIC (GRANULAR BLOCKING)
  // ==========================================
  const isItemCustomized = useCallback((item: any): boolean => {
    if (item.product_id && productDetails[item.product_id]) {
      const tags = productDetails[item.product_id].tags;
      if (tags.some(tag => CUSTOM_KEYWORDS.some(keyword => tag.includes(keyword)))) {
        return true;
      }
      if (tags.includes('non-returnable') || tags.includes('final sale')) {
        return true;
      }
    }

    if (item.title) {
      const titleLower = item.title.toLowerCase();
      if (CUSTOM_KEYWORDS.some(k => titleLower.includes(k))) {
        return true;
      }
    }

    if (item.properties && Array.isArray(item.properties) && item.properties.length > 0) {
      const hasCustomProperty = item.properties.some((prop: any) => {
        const key = (prop.name || '').toLowerCase();
        const value = (prop.value || '').toString().toLowerCase();
        if (!key && !value) return false;
        return CUSTOM_KEYWORDS.some(keyword =>
          key.includes(keyword) || value.includes(keyword)
        );
      });
      if (hasCustomProperty) return true;
    }

    if (item.variant_title) {
      const variantLower = item.variant_title.toLowerCase();
      if (CUSTOM_KEYWORDS.some(k => variantLower.includes(k))) {
        return true;
      }
    }

    if (item.sku && /-CUST|-BSP/i.test(item.sku)) {
      return true;
    }

    return false;
  }, [productDetails]);

  // ==========================================
  // ORDER ELIGIBILITY CHECK
  // ==========================================
  const isOrderEligibleForReturn = useCallback((order: Order): { eligible: boolean; reason?: 'final_sale' | 'time_window' | 'active_return' | 'international' } => {
    // Check 1: Time window (dynamic days from settings)
    // Use delivered_at if available, otherwise fallback to created_at
    const targetDate = order.delivered_at || order.created_at; 

    if (!isWithinReturnPeriod(targetDate)) {
      return { eligible: false, reason: 'time_window' };
    }
    
    // Check 2: Final sale / non-returnable tags
    const strictExcludedTags = ['Final Sale', 'Non-Returnable'];
    if (order.tags) {
      const orderTags = order.tags.toLowerCase();
      if (strictExcludedTags.some(tag => orderTags.includes(tag.toLowerCase()))) {
        return { eligible: false, reason: 'final_sale' };
      }
    }
    
    return { eligible: true };
  }, [isWithinReturnPeriod]);

  // Check if order shipping address is in India
  const isOrderInIndia = useCallback(async (orderData: Order): Promise<boolean> => {
    try {
      let shippingCountry = '';

      if (enrichedOrderData?.shipping_address?.country) {
        shippingCountry = enrichedOrderData.shipping_address.country;
      } else if (orderData.shipping_address?.country) {
        shippingCountry = orderData.shipping_address.country;
      } else {
        const shopifyOrder = await fetchShopifyOrder(orderData.name);
        if (shopifyOrder?.shipping_address?.country) {
          shippingCountry = shopifyOrder.shipping_address.country;
          setEnrichedOrderData(shopifyOrder);
        }
      }

      return isIndianAddress(shippingCountry);
    } catch (error) {
      console.error("Error checking shipping country:", error);
      return false;
    }
  }, [enrichedOrderData]);

  // ==========================================
  // NAVIGATION HANDLERS
  // ==========================================
  const handleBackFromSelect = useCallback(() => {
    setStep('LOGIN');
    setOrder(null);
    setEnrichedOrderData(null);
    setSpecificOrderId('');
    setSpecificEmail('');
    setProductDetails({});
  }, []);

  const handleBackToSelection = useCallback(() => {
    setStep('SELECT');
    setReviewData(null);
  }, []);

  const handleBackToMethod = useCallback(() => {
    setStep('METHOD');
    setReviewData(null);
  }, []);

  // ==========================================
  // API DATA LOADING
  // ==========================================
  const loadOrderProductDetails = useCallback(async (orderData: Order) => {
    const productIds = orderData.line_items
      .map(item => item.product_id)
      .filter((id): id is number => id !== null && id !== undefined && !productDetails[id]);

    const uniqueIds = [...new Set(productIds)];

    if (uniqueIds.length === 0) return;

    const promises = uniqueIds.map(async (productId) => {
      const details = await fetchProductDetails(productId);
      return { id: productId, ...details };
    });

    const results = await Promise.all(promises);

    setProductDetails(prev => {
      const next = { ...prev };
      results.forEach(r => {
        next[r.id] = { image: r.image, tags: r.tags };
      });
      return next;
    });
  }, [productDetails]);

  // ==========================================
  // ENRICH ORDER WITH SHIPPING DETAILS
  // ==========================================
  // const enrichOrderWithDetails = useCallback(async (orderData: Order) => {
  //   try {
  //     const shopifyOrder = await fetchShopifyOrder(orderData.name);
  //     if (shopifyOrder) {
  //       setEnrichedOrderData(shopifyOrder);
  //       return shopifyOrder;
  //     }
  //   } catch (error) {
  //     console.error("Error enriching order data:", error);
  //   }
  //   return null;
  // }, []);

  // ==========================================
  // RETURN STATUS CHECKING
  // ==========================================
  const checkOrderReturnStatus = useCallback(async (orderName: string) => {
    if (!orderName || checkingStatus[orderName]) return;

    setCheckingStatus(prev => ({ ...prev, [orderName]: true }));

    try {
      const returnDocRef = doc(db, "returns", orderName);
      const returnDoc = await getDoc(returnDocRef);

      if (returnDoc.exists()) {
        const returnData = returnDoc.data();
        const itemsStatus: Record<number, string> = {};

        returnData.items?.forEach((item: any) => {
          if (item.lineItemId) {
            itemsStatus[item.lineItemId] = returnData.status;
          }
        });

        setOrderReturnStatus(prev => ({
          ...prev,
          [orderName]: {
            status: returnData.status,
            items: itemsStatus
          }
        }));
      } else {
        setOrderReturnStatus(prev => ({
          ...prev,
          [orderName]: {
            status: 'No Return',
            items: {}
          }
        }));
      }
    } catch (error) {
      console.error("Error checking return status:", error);
    } finally {
      setCheckingStatus(prev => ({ ...prev, [orderName]: false }));
    }
  }, [checkingStatus]);

  useEffect(() => {
    if (order?.name) {
      checkOrderReturnStatus(order.name);
    }
  }, [order?.name, checkOrderReturnStatus]);

  const canItemBeReturned = useCallback((orderName: string, itemId: number): { allowed: boolean; status?: string } => {
    const orderStatus = orderReturnStatus[orderName];
    if (!orderStatus || orderStatus.status === 'No Return') {
      return { allowed: true };
    }

    const itemStatus = orderStatus.items[itemId];
    if (itemStatus) {
      const allowed = itemStatus === RETURN_STATUSES.CLOSED;
      return { allowed, status: itemStatus };
    }

    return { allowed: true };
  }, [orderReturnStatus]);

  const showIneligibleModal = useCallback((orderName: string, type: 'custom' | 'active_return' | 'international' | 'time_window' = 'custom') => {
    setIneligibleModal({
      show: true,
      orderName,
      type
    });
    setTimeout(() => setIneligibleModal({ show: false, orderName: '', type: 'custom' }), 5000);
  }, []);

  // ==========================================
  // COMPUTED PROPERTIES
  // ==========================================
  const hasDefectiveItems = useMemo(() => {
    return selectedItems.some(id =>
      returnDetails[id]?.reason === "I received a defective item"
    );
  }, [selectedItems, returnDetails]);

  // ==========================================
  // RAN GENERATION
  // ==========================================
  const generateSequentialRAN = useCallback(async (orderName: string): Promise<string> => {
    const counterRef = doc(db, 'settings', 'returnCounter');

    try {
      const newCount = await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(counterRef);
        const nextValue = sfDoc.exists() ? sfDoc.data().current + 1 : 1000000;
        transaction.set(counterRef, { current: nextValue });
        return nextValue;
      });

      const orderSuffix = orderName.replace(/[^0-9]/g, '').slice(-6);
      return `R${newCount}-${orderSuffix}`;
    } catch (error) {
      console.error("Transaction failed: ", error);
      const fallback = Math.floor(1000000 + Math.random() * 9000000);
      return `R${fallback}-${orderName.slice(-4)}`;
    }
  }, []);

  // ==========================================
  // FILE HANDLING
  // ==========================================
  const uploadFilesBatch = useCallback(async (
    files: (File | null)[],
    RAN: string,
    itemId: number
  ): Promise<string[]> => {
    const validFiles = files
      .map((file, idx) => ({ file, idx }))
      .filter((item): item is { file: File; idx: number } =>
        item.file !== null && validateFile(item.file).valid
      )
      .slice(0, MAX_IMAGES);

    if (validFiles.length === 0) return [];

    const uploadPromises = validFiles.map(async ({ file, idx }) => {
      try {
        const compressedFile = await compressImage(file);
        
        const timestamp = Date.now();
        const sanitizedName = compressedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const storageRef = ref(storage, `returns/${RAN}/${itemId}/${timestamp}_${idx}_${sanitizedName}`);
        
        // Upload the significantly smaller file
        const snapshot = await uploadBytes(storageRef, compressedFile);
        return await getDownloadURL(snapshot.ref);
      } catch (error) {
        console.error(`Upload failed for item ${itemId} image ${idx}`, error);
        return null;
      }
    });

    const results = await Promise.all(uploadPromises);
    return results.filter((url): url is string => url !== null);
  }, []);

  const handleFileChange = useCallback((
    lineItemId: number,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Reset the input value so the user can select the same files again if they removed them
    e.target.value = '';

    setUploadFiles(prev => {
      const currentFiles = prev[lineItemId] || generateInitialImagesArray();
      const emptyCount = currentFiles.filter(f => f === null).length;

      if (emptyCount === 0) {
        alert(`Maximum ${MAX_IMAGES} images allowed.`);
        return prev;
      }

      const newFiles = [...currentFiles];
      let currentEmptyIdx = 0;

      files.forEach(file => {
        const validation = validateFile(file);
        if (!validation.valid) {
          alert(`Skipped ${file.name}: ${validation.error}`);
          return;
        }

        // Find the next available empty slot
        while (currentEmptyIdx < MAX_IMAGES && newFiles[currentEmptyIdx] !== null) {
          currentEmptyIdx++;
        }

        // If we found an empty slot, assign the file and trigger the preview reader
        if (currentEmptyIdx < MAX_IMAGES) {
          newFiles[currentEmptyIdx] = file;
          const targetIdx = currentEmptyIdx; 

          const reader = new FileReader();
          reader.onloadend = () => {
            setPreviews(p => {
              const currentPreviews = p[lineItemId] || generateInitialImagesArray();
              const newPreviews = [...currentPreviews];
              newPreviews[targetIdx] = reader.result as string;
              return { ...p, [lineItemId]: newPreviews };
            });
          };
          reader.readAsDataURL(file);
        }
      });

      // Warn if they tried to upload more files than available slots
      if (files.length > emptyCount) {
        alert(`Only up to ${MAX_IMAGES} images allowed. Some files were skipped.`);
      }

      return { ...prev, [lineItemId]: newFiles };
    });
  }, []);

  const removeImage = useCallback((lineItemId: number, index: number) => {
    setUploadFiles(prev => {
      const newFiles = [...(prev[lineItemId] || generateInitialImagesArray())];
      newFiles[index] = null;
      return { ...prev, [lineItemId]: newFiles };
    });

    setPreviews(prev => {
      const newPreviews = [...(prev[lineItemId] || generateInitialImagesArray())];
      newPreviews[index] = null;
      return { ...prev, [lineItemId]: newPreviews };
    });
  }, []);

  // ==========================================
  // API HANDLERS
  // ==========================================
  const handleSpecificSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!specificOrderId || !specificEmail) return;

    setSpecificLoading(true);
    setError('');

    try {
      const data = await fetchOrderByName(specificOrderId, specificEmail);
      if (data) {
        const eligibility = isOrderEligibleForReturn(data);
        
        if (!eligibility.eligible) {
          if (eligibility.reason === 'time_window') {
            showIneligibleModal(data.name, 'time_window');
          } else if (eligibility.reason === 'final_sale') {
            showIneligibleModal(data.name, 'custom');
          }
          setOrder(null);
          return;
        }

        // Optimization: Use pre-fetched product details if the backend provided them
        if (data.product_details) {
          const formattedDetails: Record<number, { image: string | null, tags: string[] }> = {};
          
          // Use Object.entries to safely get both the key and the value
          Object.entries(data.product_details).forEach(([key, value]) => {
            formattedDetails[parseInt(key)] = value;
          });
          
          setProductDetails(formattedDetails);
        } else {
          // Fallback just in case
          await loadOrderProductDetails(data);
        }

        // Optimization: Set enrichedOrderData directly from the fetched data to skip extra network calls
        setEnrichedOrderData(data);

        // Synchronous check (will resolve instantly because data.shipping_address is already loaded)
        const isInIndia = await isOrderInIndia(data);
        if (!isInIndia) {
          showIneligibleModal(data.name, 'international');
          setOrder(null);
          return;
        }

        setOrder(data);
        setStep('SELECT');
      } else {
        setError("Order not found, details incorrect, or order not fulfilled.");
      }
    } catch (err) {
      setError("System error. Please try again.");
    } finally {
      setSpecificLoading(false);
    }
  }, [specificOrderId, specificEmail, isOrderEligibleForReturn, isOrderInIndia, loadOrderProductDetails, showIneligibleModal]);

  // ==========================================
  // UI HANDLERS
  // ==========================================
  const toggleItem = useCallback((lineItemId: number) => {
    if (!order) return;

    const { allowed, status } = canItemBeReturned(order.name, lineItemId);
    if (!allowed) {
      alert(`This item has an active return (${status}). You can only reapply for return after the current return is closed.`);
      return;
    }

    const item = order.line_items.find(i => i.id === lineItemId);
    if (item && isItemCustomized(item)) {
      alert("This item is customized/bespoke and cannot be returned.");
      return;
    }

    setSelectedItems(prev => {
      const isSelected = prev.includes(lineItemId);

      if (isSelected) {
        setReturnDetails(prevDetails => {
          const newDetails = { ...prevDetails };
          delete newDetails[lineItemId];
          return newDetails;
        });

        setUploadFiles(prevFiles => {
          const newFiles = { ...prevFiles };
          delete newFiles[lineItemId];
          return newFiles;
        });

        setPreviews(prevPreviews => {
          const newPreviews = { ...prevPreviews };
          delete newPreviews[lineItemId];
          return newPreviews;
        });

        return prev.filter(i => i !== lineItemId);
      } else {
        setReturnDetails(d => ({
          ...d,
          [lineItemId]: { qty: 1, reason: '', note: '' }
        }));
        setUploadFiles(f => ({
          ...f,
          [lineItemId]: generateInitialImagesArray()
        }));
        setPreviews(p => ({
          ...p,
          [lineItemId]: generateInitialImagesArray()
        }));
        return [...prev, lineItemId];
      }
    });
  }, [order, canItemBeReturned, isItemCustomized]);

  const updateDetail = useCallback((lineItemId: number, field: string, value: any) => {
    setReturnDetails(prev => ({
      ...prev,
      [lineItemId]: {
        ...(prev[lineItemId] || { qty: 1, reason: '', note: '' }),
        [field]: value
      }
    }));
  }, []);

  const validateReturn = useCallback((): boolean => {
    if (!order) return false;

    for (const itemId of selectedItems) {
      const { allowed, status } = canItemBeReturned(order.name, itemId);
      if (!allowed) {
        alert(`Item has an active return (${status}). Cannot proceed with return.`);
        return false;
      }

      const item = order.line_items.find(i => i.id === itemId);
      if (item && isItemCustomized(item)) {
        alert(`Item "${item.title}" is customized and cannot be returned.`);
        return false;
      }

      const files = uploadFiles[itemId] || [];
      const uploadedCount = files.filter(f => f !== null).length;

      if (uploadedCount < MANDATORY_IMAGES) {
        alert(`Please upload at least ${MANDATORY_IMAGES} images for all selected items.`);
        return false;
      }

      if (!returnDetails[itemId]?.reason) {
        alert("Please select a reason for all items.");
        return false;
      }
    }

    return true;
  }, [order, selectedItems, uploadFiles, returnDetails, canItemBeReturned, isItemCustomized]);

  // ==========================================
  // PREPARE REVIEW DATA
  // ==========================================
  const prepareReviewData = useCallback(() => {
    if (!order) return null;

    let phone = order.phone || order.customer?.phone || '';
    let address = '';
    let city = '';
    let state = '';
    let zip = '';
    let country = '';

    if (enrichedOrderData) {
      const shipping = enrichedOrderData.shipping_address;
      if (shipping) {
        phone = shipping.phone || phone;
        address = shipping.address1 + (shipping.address2 ? `, ${shipping.address2}` : '');
        city = shipping.city || '';
        state = shipping.province || '';
        zip = shipping.zip || '';
        country = shipping.country || '';
      }
    } else {
      const shipping = order.shipping_address;
      if (shipping) {
        phone = shipping.phone || phone;
        address = shipping.address1 + (shipping.address2 ? `, ${shipping.address2}` : '');
        city = shipping.city || '';
        state = shipping.province || '';
        zip = shipping.zip || '';
        country = shipping.country || '';
      }
    }

    const items = selectedItems.map(itemId => {
      const item = order.line_items.find(i => i.id === itemId)!;
      const details = returnDetails[itemId];
      const files = uploadFiles[itemId] || [];
      const images = files
        .map((file, idx) => file ? previews[itemId]?.[idx] : null)
        .filter((url): url is string => url !== null);

      return {
        id: itemId,
        title: item.title,
        sku: item.sku || 'N/A',
        price: item.price,
        quantity: details.qty,
        reason: details.reason,
        note: details.note || '',
        images,
        productImage: item.product_id ? productDetails[item.product_id]?.image || '' : ''
      };
    });

    const totalAmount = items.reduce((sum, item) => {
      const price = parseFloat(item.price.replace(/[^0-9.]/g, '')) || 0;
      return sum + (price * item.quantity);
    }, 0);

    return {
      items,
      customerInfo: {
        name: `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || 'N/A',
        email: order.email || 'N/A',
        phone: phone || 'N/A',
        address: address || 'N/A',
        city: city || 'N/A',
        state: state || 'N/A',
        zip: zip || 'N/A',
        country: country || 'N/A'
      },
      totalAmount,
      selectedMethod,
      hasDefectiveItems
    };
  }, [order, enrichedOrderData, selectedItems, returnDetails, uploadFiles, previews, productDetails, selectedMethod, hasDefectiveItems]);

  // ==========================================
  // CONTINUE HANDLER
  // ==========================================
  const handleContinueAction = useCallback(() => {
    if (!validateReturn()) return;

    if (!hasDefectiveItems && selectedMethod === 'refund') {
      setSelectedMethod('store_credit');
    }

    setStep('METHOD');
  }, [validateReturn, hasDefectiveItems, selectedMethod]);

  const handleMethodContinue = useCallback(() => {
    const review = prepareReviewData();
    if (review) {
      setReviewData(review);
      setStep('REVIEW');
    }
  }, [prepareReviewData]);

  // ==========================================
  // EXTRACT CUSTOMER CONTACT DETAILS
  // ==========================================
  const extractCustomerContactDetails = useCallback(() => {
    if (!order) return { phone: '', address: '', city: '', state: '', zip: '', country: '' };

    let phone = order.phone || order.customer?.phone || '';
    let address = '';
    let city = '';
    let state = '';
    let zip = '';
    let country = '';

    if (enrichedOrderData) {
      const shipping = enrichedOrderData.shipping_address;
      if (shipping) {
        phone = shipping.phone || phone;
        address = shipping.address1 + (shipping.address2 ? `, ${shipping.address2}` : '');
        city = shipping.city || '';
        state = shipping.province || '';
        zip = shipping.zip || '';
        country = shipping.country || '';
      }

      if (!phone && enrichedOrderData.billing_address) {
        phone = enrichedOrderData.billing_address.phone || phone;
      }
    } else {
      const shipping = order.shipping_address;
      if (shipping) {
        phone = shipping.phone || phone;
        address = shipping.address1 + (shipping.address2 ? `, ${shipping.address2}` : '');
        city = shipping.city || '';
        state = shipping.province || '';
        zip = shipping.zip || '';
        country = shipping.country || '';
      }
    }

    return { phone, address, city, state, zip, country };
  }, [order, enrichedOrderData]);

  // ==========================================
  // SUBMISSION HANDLER
  // ==========================================
  const handleSubmitReturn = useCallback(async () => {
    if (!order) return;
    setSubmitting(true);

    try {
      const isInIndia = await isOrderInIndia(order);
      if (!isInIndia) {
        alert("Returns are only accepted for orders shipped within India.");
        setSubmitting(false);
        return;
      }

      const RAN = await generateSequentialRAN(order.name);
      setGeneratedRAN(RAN);

      const { phone, address, city, state, zip, country } = extractCustomerContactDetails();

      const itemProcessingPromises = selectedItems.map(async (itemId) => {
        const item = order.line_items.find(i => i.id === itemId);
        if (!item) return null;

        const details = returnDetails[itemId];
        const files = uploadFiles[itemId] || generateInitialImagesArray();
        const imageUrls = await uploadFilesBatch(files, RAN, itemId);

        return {
          lineItemId: itemId,
          title: item.title,
          sku: item.sku || 'N/A',
          price: item.price,
          productImage: item.product_id ? productDetails[item.product_id]?.image || '' : '',
          quantityReturned: details.qty,
          reason: details.reason,
          note: details.note?.trim() || '',
          customerImages: imageUrls || []
        };
      });

      const processedItems = (await Promise.all(itemProcessingPromises))
        .filter((item): item is NonNullable<typeof item> => item !== null);

      const returnData = {
        RAN,
        orderId: order.name,
        orderNumericId: order.id,
        customer: {
          name: `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim(),
          email: order.email,
          phone: phone || order.customer?.phone || order.phone || '',
          address: address || '',
          city: city || '',
          state: state || '',
          zip: zip || '',
          country: country || ''
        },
        items: processedItems,
        type: 'Return',
        status: RETURN_STATUSES.OPEN,
        refundStatus: 'Pending',
        awb: '',
        requestedMethod: selectedMethod,
        refundEligibility: selectedMethod === 'refund' ? 'Eligible' : 'Not Eligible',
        hasDefectiveItems,
        previousReturns: orderReturnStatus[order.name]?.status !== 'No Return' ? orderReturnStatus[order.name] : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        submittedAt: new Date().toISOString(),
        ReturnSubmitEmailSent: false,
        webhookStatus: 'pending'
      };

      const orderDocRef = doc(db, "returns", order.name);
      await setDoc(orderDocRef, returnData);

      try {
        const webhookSuccess = await notifyReturnSubmission(returnData);

        if (webhookSuccess) {
          await updateDoc(orderDocRef, {
            ReturnSubmitEmailSent: true,
            webhookStatus: 'success',
            emailSentAt: serverTimestamp()
          });
        } else {
          await updateDoc(orderDocRef, {
            webhookStatus: 'failed',
            webhookFailureTime: serverTimestamp(),
            webhookErrorMessage: 'Webhook returned non-OK response'
          });
          console.warn("⚠️ Webhook failed but return was saved");
        }
      } catch (webhookError) {
        console.error("❌ Failed to trigger automation:", webhookError);
        await updateDoc(orderDocRef, {
          webhookStatus: 'failed',
          webhookFailureTime: serverTimestamp(),
          webhookErrorMessage: webhookError instanceof Error ? webhookError.message : 'Unknown error'
        });
      }

      setStep('CONFIRMATION');

    } catch (err) {
      console.error("Submission error:", err);
      alert("Failed to submit return. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [order, selectedItems, returnDetails, uploadFiles, productDetails, selectedMethod, hasDefectiveItems, generateSequentialRAN, uploadFilesBatch, orderReturnStatus, extractCustomerContactDetails, isOrderInIndia]);

  const resetForm = useCallback(() => {
    setStep('LOGIN');
    setSelectedItems([]);
    setReturnDetails({});
    setUploadFiles({});
    setPreviews({});
    setSpecificOrderId('');
    setSpecificEmail('');
    setOrder(null);
    setEnrichedOrderData(null);
    setGeneratedRAN('');
    setProductDetails({});
    setError('');
    setIneligibleModal({ show: false, orderName: '', type: 'custom' });
    setSelectedMethod('store_credit');
    setReviewData(null);
  }, []);

  // ==========================================
  // RENDER HELPERS
  // ==========================================
  const renderIneligibleModal = useMemo(() => {
    if (!ineligibleModal.show) return null;

    const isActiveReturn = ineligibleModal.type === 'active_return';
    const isInternational = ineligibleModal.type === 'international';
    const isTimeWindow = ineligibleModal.type === 'time_window';

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setIneligibleModal({ show: false, orderName: '', type: 'custom' })}
        />
        <div className="relative bg-white rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 mx-4">
          <div className="absolute top-4 right-4">
            <button
              onClick={() => setIneligibleModal({ show: false, orderName: '', type: 'custom' })}
              className="text-slate-400 hover:text-slate-600"
            >
              <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>

          <div className={`w-16 h-16 sm:w-20 sm:h-20 ${
            isInternational ? 'bg-blue-100' : 
            isActiveReturn ? 'bg-amber-100' : 
            isTimeWindow ? 'bg-orange-100' : 'bg-[#5A0A38]/10'
          } rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6`}>
            {isInternational ? (
              <Globe className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600" />
            ) : isTimeWindow ? (
              <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 text-orange-600" />
            ) : (
              <AlertCircle className={`w-8 h-8 sm:w-10 sm:h-10 ${isActiveReturn ? 'text-amber-600' : 'text-[#5A0A38]'}`} />
            )}
          </div>

          <h3 className="text-xl sm:text-2xl font-bold text-slate-900 text-center mb-2 sm:mb-3">
            {isInternational ? 'International Order' :
             isActiveReturn ? 'Return Already In Progress' :
             isTimeWindow ? 'Return Period Expired' : 'Return Not Eligible'}
          </h3>

          <div className="text-center mb-4 sm:mb-6">
            <p className="text-sm sm:text-base text-slate-700 mb-2">
              Order <span className="font-bold text-[#5A0A38]">{ineligibleModal.orderName}</span>
            </p>
            <div className={`${
              isInternational ? 'bg-blue-50 border-blue-100' :
              isActiveReturn ? 'bg-amber-50 border-amber-100' :
              isTimeWindow ? 'bg-orange-50 border-orange-100' : 'bg-[#5A0A38]/5 border-[#5A0A38]/10'
            } border rounded-xl p-3 sm:p-4`}>
              <p className={`${
                isInternational ? 'text-blue-700' :
                isActiveReturn ? 'text-amber-700' :
                isTimeWindow ? 'text-orange-700' : 'text-[#5A0A38]'
              } text-sm sm:text-base font-medium`}>
                {isInternational
                  ? 'Returns are only accepted for orders shipped within India.'
                  : isActiveReturn
                    ? 'This order has an active return request.'
                    : isTimeWindow
                      ? `Returns are only accepted within ${returnDaysLimit} days of order delivery.`
                      : 'This order is marked as Final Sale.'
                }
              </p>
            </div>
            
            {/* Hide the bottom explanation text for time_window to prevent repetition */}
            {!isTimeWindow && (
              <p className="text-xs sm:text-sm text-slate-600 mt-3 sm:mt-4">
                {isInternational
                  ? 'We currently only accept returns for orders delivered within India.'
                  : isActiveReturn
                    ? 'You can submit a new return only after the current return is closed.'
                    : 'Items marked as Final Sale or Non-Returnable cannot be returned.'}
              </p>
            )}
          </div>

          <button
            onClick={() => setIneligibleModal({ show: false, orderName: '', type: 'custom' })}
            className="w-full bg-[#5A0A38] hover:bg-[#4A082D] text-white font-bold py-3 px-4 rounded-xl transition-all text-sm sm:text-base"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }, [ineligibleModal, returnDaysLimit]);

  const renderItemCard = useCallback((item: any) => {
    const isSelected = selectedItems.includes(item.id);
    const details = returnDetails[item.id] || { qty: 1, reason: '', note: '' };
    const itemFiles = uploadFiles[item.id] || generateInitialImagesArray();
    const itemPreviews = previews[item.id] || generateInitialImagesArray();
    const uploadedCount = itemFiles.filter(f => f !== null).length;

    const { allowed, status } = order ? canItemBeReturned(order.name, item.id) : { allowed: true, status: undefined };
    const hasActiveReturn = !allowed && status && status !== RETURN_STATUSES.CLOSED;
    const isCustomized = isItemCustomized(item);
    const isDisabled = hasActiveReturn || isCustomized;
    
    // Use delivered_at if available, otherwise fallback to created_at
    const targetDate = order ? (order.delivered_at || order.created_at) : '';
    const daysSinceOrder = targetDate ? getDaysSinceOrder(targetDate) : 0;
    const isNearExpiry = daysSinceOrder >= (returnDaysLimit - 2) && daysSinceOrder <= returnDaysLimit;

    return (
      <div
        key={item.id}
        className={`bg-white rounded-xl sm:rounded-2xl border transition-all duration-300 overflow-hidden ${
          isDisabled
            ? 'border-slate-200 bg-slate-50 opacity-90'
            : isSelected
              ? 'border-[#5A0A38] shadow-lg ring-1 ring-[#5A0A38]'
              : 'border-slate-200 shadow-sm hover:border-slate-300'
        }`}
      >
        <div className="p-3 sm:p-4 flex gap-3 sm:gap-4 items-start">
          <div
            className="pt-1"
            onClick={(e) => {
              e.stopPropagation();
              if (!isDisabled) {
                toggleItem(item.id);
              }
            }}
          >
            <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
              isDisabled
                ? 'bg-slate-100 border-slate-300 cursor-not-allowed'
                : isSelected
                  ? 'bg-[#5A0A38] border-[#5A0A38]'
                  : 'bg-white border-slate-300 hover:border-[#5A0A38] cursor-pointer'
            }`}>
              {isSelected && <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white stroke-[3]" />}
              {isDisabled && isCustomized && <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-slate-400 rounded-full" />}
            </div>
          </div>

          <div className="w-16 h-20 sm:w-20 sm:h-24 bg-slate-100 rounded-lg border border-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
            {item.product_id && productDetails[item.product_id]?.image ? (
              <img
                src={productDetails[item.product_id].image!}
                alt={item.title}
                className={`w-full h-full object-cover ${isDisabled ? 'grayscale' : ''}`}
                loading="lazy"
              />
            ) : (
              <PackageOpen className="w-6 h-6 sm:w-8 sm:h-8 text-slate-300" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <div className="flex-1">
                <h3 className={`font-bold text-sm sm:text-base break-words leading-tight ${isDisabled ? 'text-slate-500' : 'text-slate-800'}`}>
                  {item.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 sm:mt-1">
                  Variant: {item.variant_title || 'Default'}
                </p>

                {item.properties && item.properties.length > 0 && (
                  <div className="mt-1 sm:mt-2 flex flex-wrap gap-1 overflow-x-auto pb-1">
                    {item.properties.map((prop: any, idx: number) => {
                      if (!prop.name || !prop.value) return null;
                      return (
                        <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap">
                          {prop.name}: {prop.value}
                        </span>
                      );
                    })}
                  </div>
                )}

                <p className="font-bold text-slate-900 mt-1 sm:mt-2 text-sm sm:text-base">
                  {item.price} {order?.currency}
                </p>
              </div>

              <div className="flex flex-row sm:flex-col gap-1 items-start sm:items-end">
                {status && status !== 'No Return' && (
                  <div className={`
                    text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 rounded-full flex items-center gap-1 sm:gap-1.5 whitespace-nowrap
                    ${status === RETURN_STATUSES.CLOSED
                      ? 'bg-slate-100 text-slate-600 border border-slate-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }
                  `}>
                    {status === RETURN_STATUSES.CLOSED ? (
                      <><History className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> Closed</>
                    ) : (
                      <><AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> {status}</>
                    )}
                  </div>
                )}

                {isCustomized && (
                  <div className="text-[10px] sm:text-xs font-bold px-2 sm:px-3 py-1 sm:py-1.5 rounded-full flex items-center gap-1 sm:gap-1.5 bg-red-50 text-red-700 border border-red-100 whitespace-nowrap">
                    <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    Custom
                  </div>
                )}
              </div>
            </div>

            {isNearExpiry && !isDisabled && (
              <div className="mt-2 sm:mt-3 bg-orange-50 border border-orange-200 rounded-lg p-2 sm:p-3">
                <div className="flex items-start gap-1.5 sm:gap-2">
                  <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] sm:text-xs text-orange-700">
                    Return window closes in {returnDaysLimit - daysSinceOrder} day(s). Please submit soon.
                  </p>
                </div>
              </div>
            )}

            {hasActiveReturn && (
              <div className="mt-2 sm:mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 sm:p-3">
                <div className="flex items-start gap-1.5 sm:gap-2">
                  <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] sm:text-xs text-amber-700">
                    Return in progress ({status}). Reapply after closure.
                  </p>
                </div>
              </div>
            )}

            {isCustomized && !hasActiveReturn && (
              <div className="mt-2 sm:mt-3 bg-slate-50 border border-slate-200 rounded-lg p-2 sm:p-3">
                <div className="flex items-start gap-1.5 sm:gap-2">
                  <Info className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] sm:text-xs text-slate-600">
                    Non-returnable due to customization.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {isSelected && !isDisabled && (
          <div className="px-3 sm:px-5 pb-4 sm:pb-6 pt-2 bg-slate-50/50 border-t border-[#5A0A38]/10">
            <div className="grid grid-cols-1 gap-3 sm:gap-4 mb-4 sm:mb-6">
              <div>
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Quantity
                </label>
                <select
                  value={details.qty}
                  onChange={(e) => updateDetail(item.id, 'qty', parseInt(e.target.value))}
                  className="w-full p-2 sm:p-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5A0A38] focus:ring-2 focus:ring-[#5A0A38]/20"
                >
                  {Array.from({ length: item.quantity }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Reason for Return
                </label>
                <select
                  value={details.reason}
                  onChange={(e) => updateDetail(item.id, 'reason', e.target.value)}
                  className="w-full p-2 sm:p-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5A0A38] focus:ring-2 focus:ring-[#5A0A38]/20"
                >
                  <option value="" disabled>Select a reason...</option>
                  {RETURN_REASONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Additional Notes (Optional)
                </label>
                <input
                  type="text"
                  value={details.note}
                  onChange={(e) => updateDetail(item.id, 'note', e.target.value)}
                  placeholder="Add details..."
                  className="w-full p-2 sm:p-2.5 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-[#5A0A38] focus:ring-2 focus:ring-[#5A0A38]/20"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase">
                  Upload Images
                </label>
                <span className={`text-[10px] sm:text-xs font-medium px-2 py-1 rounded-full ${
                  uploadedCount >= MANDATORY_IMAGES
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {uploadedCount}/{MAX_IMAGES}
                </span>
              </div>

              <p className="text-[10px] sm:text-xs text-slate-500 mb-2 sm:mb-3">
                <span className="text-[#5A0A38] font-bold">{MANDATORY_IMAGES} required</span> • Max {MAX_IMAGES} • 5MB each
              </p>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-3">
                {Array.from({ length: MAX_IMAGES }, (_, index) => {
                  const isRequired = index < MANDATORY_IMAGES;
                  const hasFile = !!itemFiles[index];
                  const isDisabledUpload = !isRequired && !hasFile && uploadedCount >= MAX_IMAGES;

                  return (
                    <div key={index} className="relative aspect-square">
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/heic"
                        id={`file-multi-${item.id}`}
                        className="hidden"
                        onChange={(e) => handleFileChange(item.id, e)}
                        disabled={uploadedCount >= MAX_IMAGES}
                      />

                      {hasFile ? (
                        <div className="w-full h-full rounded-lg sm:rounded-xl border border-slate-200 overflow-hidden relative group">
                          <img
                            src={itemPreviews[index]!}
                            alt={`Upload ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => removeImage(item.id, index)}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove image"
                          >
                            <Trash2 className="text-white w-3 h-3 sm:w-5 sm:h-5" />
                          </button>
                          <span className="absolute top-0.5 left-0.5 w-4 h-4 sm:w-5 sm:h-5 bg-black/60 text-white text-[8px] sm:text-xs rounded-full flex items-center justify-center backdrop-blur-sm">
                            {index + 1}
                          </span>
                        </div>
                      ) : (
                        /* All empty slots point to the same multi-file input */
                        <label
                          htmlFor={`file-multi-${item.id}`}
                          className={`
                            w-full h-full border border-dashed sm:border-2 rounded-lg sm:rounded-xl flex flex-col items-center justify-center 
                            transition-all cursor-pointer
                            ${isRequired
                              ? 'border-[#5A0A38]/30 bg-[#5A0A38]/5 hover:bg-[#5A0A38]/10'
                              : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            }
                            ${isDisabledUpload ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          <Camera className={`w-3 h-3 sm:w-5 sm:h-5 mb-0.5 sm:mb-1 ${
                            isRequired ? 'text-[#5A0A38]' : 'text-slate-400'
                          }`} />
                          <span className={`text-[6px] sm:text-[10px] font-bold ${
                            isRequired ? 'text-[#5A0A38]' : 'text-slate-400'
                          }`}>
                            {isRequired ? 'Req' : 'Add'}
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              {uploadedCount < MANDATORY_IMAGES && (
                <div className="mt-2 sm:mt-3 flex items-center gap-1.5 sm:gap-2 text-amber-600 bg-amber-50 p-2 rounded-lg text-[10px] sm:text-xs">
                  <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
                  <span>Upload at least {MANDATORY_IMAGES} images</span>
                </div>
              )}
            </div>
          </div>  
        )}
      </div>
    );
  }, [selectedItems, returnDetails, uploadFiles, previews, productDetails, order, toggleItem, updateDetail, handleFileChange, removeImage, canItemBeReturned, isItemCustomized, returnDaysLimit, getDaysSinceOrder]);

  // ==========================================
  // RENDER MAIN
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 relative">

      {/* Desktop Header */}
      <div className="hidden lg:block bg-[#5A0A38] border-b border-[#5A0A38]/20 shadow-lg sticky top-0 z-50">
        <div className="w-full px-16 py-4">
          <div className="flex items-center justify-between w-full">
            <Link to="/CustomerPage" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all">
                <PackageOpen className="w-5 h-5 text-[#5A0A38]" />
              </div>
              <div>
                <span className="font-bold text-lg text-white">Prashanti</span>
                <span className="text-pink-300 font-bold text-lg ml-1">Returns</span>
              </div>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                to="/ReturnStatusPage"
                className="flex items-center gap-2 text-white/90 hover:text-white transition-colors px-4 py-2 rounded-lg hover:bg-white/10 border border-white/20"
              >
                <Search className="w-4 h-4" />
                Track Return Status
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <MobileHeader 
        step={step} 
        onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        isMenuOpen={isMobileMenuOpen}
      />

      {/* Mobile Menu Dropdown */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-x-0 top-[73px] bg-white border-b border-slate-200 shadow-lg z-40 animate-in slide-in-from-top">
          <div className="p-4 space-y-2">
            <Link
              to="/ReturnStatusPage"
              className="flex items-center gap-3 p-3 text-[#5A0A38] hover:bg-[#5A0A38]/10 rounded-xl transition-colors"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <Search className="w-5 h-5" />
              <span className="font-medium">Track Return Status</span>
            </Link>
            {step !== 'LOGIN' && (
              <button
                onClick={() => {
                  resetForm();
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 p-3 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium">Start Over</span>
              </button>
            )}
          </div>
        </div>
      )}

      {renderIneligibleModal}

      {/* Main Content - Mobile Responsive Layout */}
      <div className="flex flex-col lg:flex-row flex-1">
        {/* LEFT PANEL */}
        {/* LEFT PANEL */}
        <div className={`
          ${step === 'LOGIN' ? 'flex w-full lg:w-[450px] justify-center pb-12 lg:pb-0' : 'hidden lg:flex lg:w-[450px]'} 
          bg-white border-r border-slate-200 flex-col flex-1 lg:flex-none min-h-[calc(100vh-73px)] shadow-2xl z-20
        `}>
          <div className={`p-4 sm:p-6 lg:p-8 pb-2 sm:pb-4 ${step === 'LOGIN' ? 'text-center lg:text-left' : ''}`}>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mb-1">
              {step === 'LOGIN' ? 'Start your return' :
                step === 'CONFIRMATION' ? 'Confirmation' :
                  step === 'REVIEW' ? 'Review Details' : 'Return Request'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              {step === 'CONFIRMATION' ? 'Return request submitted' :
                step === 'REVIEW' ? 'Please verify all details before submitting' :
                  'Follow the steps to process your return.'}
            </p>
          </div>

          <div className={`px-4 sm:px-6 lg:px-8 py-2 sm:py-4 flex flex-col gap-4 sm:gap-6 overflow-y-auto ${step === 'LOGIN' ? '' : 'flex-1'}`}>
            {step === 'LOGIN' ? (
              <div className="space-y-4 sm:space-y-6">
                <div className="bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-3 sm:mb-4 text-slate-800">
                    <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[#5A0A38]" />
                    <h3 className="font-bold text-xs sm:text-sm uppercase tracking-wide">Find Your Order</h3>
                  </div>
                  <form onSubmit={handleSpecificSearch} className="space-y-2 sm:space-y-3">
                    <input
                      type="text"
                      value={specificOrderId}
                      onChange={e => setSpecificOrderId(e.target.value)}
                      placeholder="Order ID (e.g. #1001)"
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm bg-white border border-slate-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-[#5A0A38]/20 focus:border-[#5A0A38] outline-none transition-all"
                      disabled={isSpecificLoading}
                    />
                    <input
                      type="text"
                      value={specificEmail}
                      onChange={e => setSpecificEmail(e.target.value)}
                      placeholder="Email or Phone Number"
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 text-sm bg-white border border-slate-200 rounded-lg sm:rounded-xl focus:ring-2 focus:ring-[#5A0A38]/20 focus:border-[#5A0A38] outline-none transition-all"
                      disabled={isSpecificLoading}
                    />
                    <button
                      type="submit"
                      disabled={isSpecificLoading}
                      className="w-full bg-[#5A0A38] hover:bg-[#4A082D] text-white font-bold py-2 sm:py-3 rounded-lg sm:rounded-xl transition-all flex items-center justify-center gap-2 mt-1 sm:mt-2 text-xs sm:text-sm disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {isSpecificLoading ? (
                        <>
                          <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
                          Searching...
                        </>
                      ) : "Find Order"}
                    </button>
                  </form>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-3 sm:p-4 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 sm:gap-3 border border-red-100">
                    <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                    {error}
                  </div>
                )}

                {/* Helpful Information Cards to fill empty space */}
                <div className="pt-4 sm:pt-8 grid gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">Need help?</h4>
                      <p className="text-xs text-slate-500 mt-0.5">Our support team is ready.</p>
                    </div>
                    <a 
                      href="mailto:support@prashanti.in" 
                      className="text-xs font-bold text-[#5A0A38] hover:text-[#4A082D] bg-slate-50 border border-slate-200 px-4 py-2 rounded-lg hover:border-[#5A0A38]/30 transition-colors"
                    >
                      Contact Us
                    </a>
                  </div>
                </div>

              </div>
            ) : step === 'SELECT' && order ? (
              <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-left-4">
                <div className="bg-slate-50 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1 sm:mb-2">Active Session</p>
                  <div>
                    <div className="flex justify-between items-baseline mb-1">
                      <p className="font-bold text-slate-800 text-base sm:text-2xl">{order.name}</p>
                      <span className="bg-white border border-slate-200 text-[8px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md text-slate-500">
                        {new Date(order.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 truncate">{order.email}</p>
                  </div>
                </div>

                <button
                  onClick={resetForm}
                  className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-400 hover:text-[#5A0A38] transition-colors px-2"
                >
                  <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" /> Start Over
                </button>
              </div>
            ) : step === 'METHOD' && order ? (
              <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-left-4">
                <div className="bg-slate-50 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1 sm:mb-2">Return Items</p>
                  <p className="text-xs sm:text-sm font-medium text-slate-800">{selectedItems.length} item(s) selected</p>
                </div>
                <button
                  onClick={handleBackToSelection}
                  className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-400 hover:text-[#5A0A38] transition-colors px-2"
                >
                  <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" /> Back to Items
                </button>
              </div>
            ) : step === 'REVIEW' && order ? (
              <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-left-4">
                <div className="bg-slate-50 p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200">
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase mb-1 sm:mb-2">Review Mode</p>
                  <p className="text-xs sm:text-sm font-medium text-slate-800">Please verify all details</p>
                </div>
                <button
                  onClick={handleBackToMethod}
                  className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-400 hover:text-[#5A0A38] transition-colors px-2"
                >
                  <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" /> Edit Details
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className={`
          flex-1 bg-slate-50/50 p-3 sm:p-4 lg:p-8 xl:p-12 overflow-y-auto lg:max-h-[calc(100vh-73px)]
          ${step !== 'LOGIN' ? 'block' : 'hidden lg:block'}
        `}>

          {/* IDLE STATE */}
          {step === 'LOGIN' && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40 select-none py-8 sm:py-12">
              <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-32 lg:h-32 bg-slate-200 rounded-full mb-4 sm:mb-6 flex items-center justify-center">
                <Truck className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 text-slate-400" />
              </div>
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-400">Order Details</h3>
              <p className="max-w-[250px] sm:max-w-xs mt-1 sm:mt-2 text-xs sm:text-sm text-slate-400 px-4">
                Enter your order details on the left to find your eligible items.
              </p>
            </div>
          )}

          {/* ITEM SELECTION */}
          {step === 'SELECT' && order && (
            <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    onClick={handleBackFromSelect}
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-slate-200 flex items-center justify-center transition-colors text-slate-500"
                    aria-label="Back to login"
                  >
                    <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900">Select items to return</h2>
                </div>
                <span className="text-xs sm:text-sm font-medium text-slate-500">
                  {order.line_items.length} items
                </span>
              </div>

              <div className="space-y-3 sm:space-y-4">
                {order.line_items.map(renderItemCard)}
              </div>

              {selectedItems.length > 0 && (
                <div className="mt-6 sm:mt-8 lg:mt-10">
                  <div className="bg-white border border-slate-200 p-4 sm:p-5 lg:p-6 rounded-xl sm:rounded-2xl shadow-lg">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-5">
                      <div className="text-sm font-medium text-slate-600 flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#5A0A38] text-lg sm:text-xl">
                            {selectedItems.length}
                          </span>
                          <span>item(s) selected</span>
                        </div>

                        {hasDefectiveItems && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4" />
                            Defective
                          </span>
                        )}
                      </div>

                      <button
                        onClick={handleContinueAction}
                        disabled={submitting}
                        className="w-full sm:w-auto bg-[#5A0A38] hover:bg-[#4A082D] text-white px-8 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            {hasDefectiveItems ? 'Continue to Refund' : 'Select Method'}
                            <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* METHOD SELECTION */}
          {step === 'METHOD' && order && (
            <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6 animate-in slide-in-from-right-8">
              <button
                onClick={() => setStep('SELECT')}
                className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-slate-500 hover:text-slate-800 mb-2 sm:mb-4 font-medium transition-colors"
              >
                <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" /> Back to items
              </button>

              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 px-2 sm:px-0">
                {hasDefectiveItems ? 'How would you like your refund?' : 'How would you like to receive your credit?'}
              </h2>

              <div className="space-y-3 sm:space-y-4">
                <label
                  className={`
                    block relative cursor-pointer border rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-200
                    ${selectedMethod === 'store_credit'
                      ? 'border-[#5A0A38] bg-[#5A0A38]/5'
                      : 'border-slate-200 hover:border-slate-300'
                    }
                  `}
                  onClick={() => setSelectedMethod('store_credit')}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`
                      mt-1 p-2 sm:p-3 rounded-full transition-colors shrink-0
                      ${selectedMethod === 'store_credit'
                        ? 'bg-[#5A0A38] text-white'
                        : 'bg-slate-100 text-slate-500'
                      }
                    `}>
                      <Wallet className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm sm:text-base lg:text-lg text-slate-800">Store Credit</h3>
                        {selectedMethod === 'store_credit' && (
                          <div className="w-5 h-5 sm:w-6 sm:h-6 bg-[#5A0A38] rounded-full flex items-center justify-center shrink-0 ml-2">
                            <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Receive credit to your store account instantly.
                      </p>
                    </div>
                  </div>
                </label>

                <label
                  className={`
                    block relative cursor-pointer border rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-200
                    ${selectedMethod === 'gift_card'
                      ? 'border-[#5A0A38] bg-[#5A0A38]/5'
                      : 'border-slate-200 hover:border-slate-300'
                    }
                  `}
                  onClick={() => setSelectedMethod('gift_card')}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className={`
                      mt-1 p-2 sm:p-3 rounded-full transition-colors shrink-0
                      ${selectedMethod === 'gift_card'
                        ? 'bg-[#5A0A38] text-white'
                        : 'bg-slate-100 text-slate-500'
                      }
                    `}>
                      <Gift className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm sm:text-base lg:text-lg text-slate-800">Gift Card</h3>
                        {selectedMethod === 'gift_card' && (
                          <div className="w-5 h-5 sm:w-6 sm:h-6 bg-[#5A0A38] rounded-full flex items-center justify-center shrink-0 ml-2">
                            <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Receive a digital gift card code via email.
                      </p>
                    </div>
                  </div>
                </label>

                {hasDefectiveItems && (
                  <label
                    className={`
                      block relative border rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-200 cursor-pointer
                      ${selectedMethod === 'refund'
                        ? 'border-[#5A0A38] bg-[#5A0A38]/5'
                        : 'border-slate-200 hover:border-slate-300'
                      }
                    `}
                    onClick={() => setSelectedMethod('refund')}
                  >
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className={`
                        mt-1 p-2 sm:p-3 rounded-full transition-colors shrink-0
                        ${selectedMethod === 'refund'
                          ? 'bg-[#5A0A38] text-white'
                          : 'bg-slate-100 text-slate-500'
                        }
                      `}>
                        <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-sm sm:text-base lg:text-lg text-slate-800">Refund to Original Payment</h3>
                          {selectedMethod === 'refund' && (
                            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-[#5A0A38] rounded-full flex items-center justify-center shrink-0 ml-2">
                              <Check className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-slate-500 mt-1">
                          Refund to original payment method.
                        </p>
                        <div className="mt-2 sm:mt-3 flex items-start gap-1.5 sm:gap-2 text-blue-600 bg-blue-50 p-2 sm:p-3 rounded-lg text-[10px] sm:text-xs font-semibold">
                          <Info className="w-3 h-3 sm:w-4 sm:h-4 shrink-0 mt-0.5" />
                          <span>Available for defective items only.</span>
                        </div>
                      </div>
                    </div>
                  </label>
                )}
              </div>

              <button
                onClick={handleMethodContinue}
                className="w-full bg-[#5A0A38] hover:bg-[#4A082D] text-white py-3 sm:py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 mt-4 sm:mt-6 text-sm sm:text-base"
              >
                Continue to Review <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
            </div>
          )}

          {/* REVIEW STEP */}
          {step === 'REVIEW' && reviewData && order && (
            <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-right-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Review Your Return Request</h2>
                <div className="bg-[#5A0A38]/10 text-[#5A0A38] px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 w-fit">
                  <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
                  Final Review
                </div>
              </div>

              {/* Customer Information Card */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-lg">
                <div className="bg-gradient-to-r from-slate-50 to-white px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
                  <h3 className="font-semibold text-sm sm:text-base text-slate-800 flex items-center gap-2">
                    <div className="w-6 h-6 sm:w-8 sm:h-8 bg-[#5A0A38]/10 rounded-lg flex items-center justify-center text-[#5A0A38]">
                      <Info className="w-3 h-3 sm:w-4 sm:h-4" />
                    </div>
                    Customer Information
                  </h3>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-2 sm:space-y-3">
                      <div>
                        <label className="text-[10px] sm:text-xs font-medium text-slate-500">Name</label>
                        <p className="text-xs sm:text-sm font-semibold text-slate-800 break-words">{reviewData.customerInfo.name}</p>
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-medium text-slate-500">Email</label>
                        <p className="text-xs sm:text-sm text-slate-800 break-words">{reviewData.customerInfo.email}</p>
                      </div>
                      <div>
                        <label className="text-[10px] sm:text-xs font-medium text-slate-500">Phone</label>
                        <p className="text-xs sm:text-sm text-slate-800">{reviewData.customerInfo.phone}</p>
                      </div>
                    </div>
                    <div className="space-y-2 sm:space-y-3">
                      <div>
                        <label className="text-[10px] sm:text-xs font-medium text-slate-500">Address</label>
                        <p className="text-xs sm:text-sm text-slate-800 break-words">{reviewData.customerInfo.address}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500">City</label>
                          <p className="text-xs sm:text-sm text-slate-800 break-words">{reviewData.customerInfo.city}</p>
                        </div>
                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500">State</label>
                          <p className="text-xs sm:text-sm text-slate-800">{reviewData.customerInfo.state}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500">ZIP Code</label>
                          <p className="text-xs sm:text-sm text-slate-800">{reviewData.customerInfo.zip}</p>
                        </div>
                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500">Country</label>
                          <p className="text-xs sm:text-sm text-slate-800">{reviewData.customerInfo.country}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Return Items */}
              <div className="space-y-3 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-semibold text-slate-800">Items to Return ({reviewData.items.length})</h3>
                {reviewData.items.map((item, index) => (
                  <div key={item.id} className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-lg">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 sm:w-6 sm:h-6 bg-[#5A0A38]/10 text-[#5A0A38] rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0">
                          {index + 1}
                        </span>
                        <h4 className="font-semibold text-sm sm:text-base text-slate-800 truncate max-w-[200px] sm:max-w-none">{item.title}</h4>
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#5A0A38] shrink-0 ml-2">Qty: {item.quantity}</span>
                    </div>

                    <div className="p-4 sm:p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500 mb-1 sm:mb-2 block">Uploaded Images</label>
                          <ImageCarousel images={item.images} />
                        </div>

                        <div>
                          <label className="text-[10px] sm:text-xs font-medium text-slate-500 mb-1 sm:mb-2 block">Original Product</label>
                          {item.productImage ? (
                            <div className="relative h-64 sm:h-80 w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                              <img src={item.productImage} alt="Product" className="w-full h-full object-contain p-2" />
                            </div>
                          ) : (
                            <div className="bg-slate-50 h-64 sm:h-80 w-full rounded-lg p-6 sm:p-8 flex items-center justify-center">
                              <PackageOpen className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-slate-300" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 sm:mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 pt-4 border-t border-slate-100">
                        <div>
                          <label className="text-[8px] sm:text-[10px] font-medium text-slate-500">SKU</label>
                          <p className="text-[10px] sm:text-xs font-medium text-slate-800 break-words">{item.sku}</p>
                        </div>
                        <div>
                          <label className="text-[8px] sm:text-[10px] font-medium text-slate-500">Price</label>
                          <p className="text-[10px] sm:text-xs font-bold text-slate-900">{formatCurrency(item.price)}</p>
                        </div>
                        <div>
                          <label className="text-[8px] sm:text-[10px] font-medium text-slate-500">Total</label>
                          <p className="text-[10px] sm:text-xs font-bold text-emerald-600">
                            {formatCurrency(parseFloat(item.price.replace(/[^0-9.]/g, '')) * item.quantity)}
                          </p>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <label className="text-[8px] sm:text-[10px] font-medium text-slate-500">Reason</label>
                          <p className="text-[10px] sm:text-xs text-slate-800">{item.reason}</p>
                        </div>
                        {item.note && (
                          <div className="col-span-2 sm:col-span-3">
                            <label className="text-[8px] sm:text-[10px] font-medium text-slate-500">Additional Note</label>
                            <p className="text-[10px] sm:text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">{item.note}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary Card */}
              <div className="bg-gradient-to-r from-[#5A0A38]/5 to-[#7D0E4B]/5 rounded-xl sm:rounded-2xl border border-[#5A0A38]/10 p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                  <div>
                    <p className="text-[10px] sm:text-xs font-medium text-[#5A0A38] mb-1">Return Summary</p>
                    <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-900">Product Amount</h3>
                  </div>
                  <div className="text-left sm:text-right w-full sm:w-auto">
                    <p className="text-xl sm:text-2xl lg:text-3xl font-bold text-[#5A0A38]">{formatCurrency(reviewData.totalAmount)}</p>
                    <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                      via {reviewData.selectedMethod === 'store_credit' ? 'Store Credit' : reviewData.selectedMethod === 'gift_card' ? 'Gift Card' : 'Original Payment'}
                    </p>
                  </div>
                </div>
                
                {/* Disclaimer */}
                <div className="mt-3 pt-3 border-t border-[#5A0A38]/10">
                  <p className="text-[10px] sm:text-xs text-slate-500 flex items-start gap-1.5">
                    <Info className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Final refund amount may vary based on shipping charges, taxes, and applicable discounts.</span>
                  </p>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2 sm:pt-4">
                <button
                  onClick={handleBackToMethod}
                  className="w-full sm:flex-1 px-4 sm:px-6 py-3 sm:py-4 border-2 border-slate-200 hover:border-slate-300 text-slate-700 font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-sm sm:text-base"
                  disabled={submitting}
                >
                  <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  Edit Details
                </button>
                <button
                  onClick={handleSubmitReturn}
                  disabled={submitting}
                  className="w-full sm:flex-1 bg-[#5A0A38] hover:bg-[#4A082D] text-white font-bold py-3 sm:py-4 px-4 sm:px-6 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                      Confirm & Submit
                    </>
                  )}
                </button>
              </div>

              <p className="text-[10px] sm:text-xs text-slate-400 text-center mt-3 sm:mt-4">
                By submitting, you confirm all information is accurate.
              </p>
            </div>
          )}

          {/* CONFIRMATION */}
          {step === 'CONFIRMATION' && order && (
            <div className="max-w-2xl mx-auto space-y-6 sm:space-y-8">
              <div className="text-center">
                <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 bg-[#5A0A38]/10 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <Check className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 text-[#5A0A38]" />
                </div>
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900">Return Request Submitted!</h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 sm:mt-2">Your return request has been received successfully.</p>
              </div>

              <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 p-4 sm:p-6 lg:p-8 shadow-sm">
                <h3 className="font-bold text-base sm:text-lg text-slate-800 mb-3 sm:mb-4">Return Details</h3>

                <div className="space-y-3 sm:space-y-4">
                  <div className="flex justify-between items-center pb-2 sm:pb-3 border-b border-slate-100">
                    <span className="text-xs sm:text-sm text-slate-600">Return Authorization Number</span>
                    <span className="text-xs sm:text-sm font-bold text-[#5A0A38] font-mono">{generatedRAN}</span>
                  </div>

                  <div className="flex justify-between items-center pb-2 sm:pb-3 border-b border-slate-100">
                    <span className="text-xs sm:text-sm text-slate-600">Order Number</span>
                    <span className="text-xs sm:text-sm font-bold text-slate-900">{order.name}</span>
                  </div>

                  <div className="flex justify-between items-center pb-2 sm:pb-3 border-b border-slate-100">
                    <span className="text-xs sm:text-sm text-slate-600">Refund Method</span>
                    <span className="text-xs sm:text-sm font-bold text-[#5A0A38]">
                      {selectedMethod === 'refund' ? 'Refund to Original Payment' : selectedMethod === 'store_credit' ? 'Store Credit' : 'Gift Card'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-xs sm:text-sm text-slate-600">Estimated Processing Time</span>
                    <span className="text-xs sm:text-sm font-bold text-slate-900">5-7 business days</span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <p className="text-[10px] sm:text-xs text-slate-500 flex items-start gap-1.5">
                      <Info className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>Final refund amount is subject to deductions for shipping charges, taxes, and applicable discounts.</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 sm:mt-6 lg:mt-8 p-3 sm:p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <Info className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] sm:text-xs text-blue-800">
                        <strong>Important:</strong> Your refund will be processed to your {selectedMethod === 'refund' ? 'original payment method' : selectedMethod === 'store_credit' ? 'store account' : 'email as a gift card'}.
                        Please allow 5-7 business days.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-center">
                <button
                  onClick={resetForm}
                  className="bg-[#5A0A38] hover:bg-[#4A082D] text-white px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold transition-all inline-flex items-center gap-2 shadow-lg hover:shadow-xl text-sm sm:text-base"
                >
                  Start New Return
                </button>
                <p className="text-[10px] sm:text-xs text-slate-500 mt-3 sm:mt-4">
                  Need help? Contact support@prashanti.in
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
