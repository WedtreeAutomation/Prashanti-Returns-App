import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  X, Mail, ChevronDown, User, Phone, MapPin, Bell,
  FileText, AlertCircle, CheckCircle2, Package, CreditCard,
  RefreshCw, Truck, Plus, Download, ArrowLeft, Gift
} from 'lucide-react';
import {
  doc, getDoc, collection, query, orderBy, limit,
  getDocs, addDoc, updateDoc, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { fetchShopifyOrder, restockShopifyItems, notifyReturnRejection, notifyItemRejection } from '../../Interfaces/api';
import { ImageZoom } from '../Layout/ImageZoom';
import { ExchangeModal } from '../../Modals/ExchangeModal';
import { RejectRequestModal } from '../../Modals/RejectRequestModal';
import { IssueRefundModal } from '../../Modals/IssueRefundModal';
import { CreatePickupModal } from '../../Modals/CreatePickupModal';
import { MarkReceivedModal } from '../../Modals/MarkReceivedModal';
import { CancelPickupModal } from '../../Modals/CancelPickupModal';
import { SelfShipModal } from '../../Modals/SelfShipModal';
import { getUserFromStorage, RejectedItem, ActivityItem, ReturnItem, ReturnData } from '../../Interfaces/types';

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface StoreCreditAccount {
  id: string;
  balance_amount: number;
  balance_currency: string;
}

interface GiftCard {
  id: string;
  balance_amount: number;
  balance_currency: string;
  code: string;
  customer_id: string | null;
}

interface CustomerBalances {
  customer_found: boolean;
  email: string;
  customer_graphql_id: string;
  customer_legacy_id: string;
  store_credit_accounts: StoreCreditAccount[];
  gift_cards: GiftCard[];
}


// Return Status Badge - Overall request state
const ReturnStatusBadge = ({ status }: { status: string }) => {
  const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
    'pending': { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100', label: 'Pending' },
    'open': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100', label: 'Open' },
    'approved': { color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-100', label: 'Approved' },
    'denied': { color: 'text-red-700', bg: 'bg-red-50 border-red-100', label: 'Denied' },
    'closed': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-100', label: 'Closed' },
    'completed': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', label: 'Completed' },
    'default': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-100', label: 'Unknown' }
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.default;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${config.bg}`}>
      {config.label}
    </span>
  );
};

// Shipment Status Badge - Reverse logistics tracking
const ShipmentStatusBadge = ({ status }: { status?: string }) => {
  if (!status) return <span className="text-xs text-slate-400">Not Created</span>;

  const statusConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
    'not created': { color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <Package className="w-3 h-3" /> },
    'pickup created': { color: 'text-purple-700', bg: 'bg-purple-50 border-purple-100', icon: <Truck className="w-3 h-3" /> },
    'pickup scheduled': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100', icon: <RefreshCw className="w-3 h-3" /> },
    'in transit': { color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-100', icon: <Truck className="w-3 h-3" /> },
    'delivered': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', icon: <CheckCircle2 className="w-3 h-3" /> },
    'received': { color: 'text-green-700', bg: 'bg-green-50 border-green-100', icon: <CheckCircle2 className="w-3 h-3" /> },
    'pickup cancelled': { color: 'text-red-700', bg: 'bg-red-50 border-red-100', icon: <X className="w-3 h-3" /> },
    'failed': { color: 'text-red-700', bg: 'bg-red-50 border-red-100', icon: <AlertCircle className="w-3 h-3" /> },
    'default': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-100', icon: <Package className="w-3 h-3" /> }
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.default;

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${config.bg}`}>
      {config.icon}
      {status}
    </span>
  );
};

// Refund Status Badge - Money flow tracking
const RefundStatusBadge = ({ status, method }: { status?: string; method?: string }) => {
  if (!status) return <span className="text-xs text-slate-400">Not Initiated</span>;

  const statusConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
    'pending': { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100', icon: <RefreshCw className="w-3 h-3" /> },
    'processing': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-100', icon: <RefreshCw className="w-3 h-3" /> },
    'refunded': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-100', icon: <CheckCircle2 className="w-3 h-3" /> },
    'failed': { color: 'text-red-700', bg: 'bg-red-50 border-red-100', icon: <AlertCircle className="w-3 h-3" /> },
    'not eligible': { color: 'text-slate-600', bg: 'bg-slate-50 border-slate-200', icon: <X className="w-3 h-3" /> },
    'skipped': { color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200', icon: <X className="w-3 h-3" /> },
    'default': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-100', icon: <CreditCard className="w-3 h-3" /> }
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.default;
  
  // Method indicator
  const methodIcon = method === 'gift_card' ? '🎁' : method === 'store_credit' ? '💳' : '💰';

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${config.bg}`}>
      <span>{methodIcon}</span>
      {status}
    </span>
  );
};

const formatAddress = (customer: CustomerInfo): string => {
  const parts = [customer.address, customer.city, customer.state, customer.zip, customer.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Not provided';
};

const InfoCard = ({ icon, label, value, isLink = false, color = 'slate' }: { icon: React.ReactNode; label: string; value: string; isLink?: boolean; color?: string; }) => {
  const colorClasses = {
    indigo: 'bg-indigo-50 text-indigo-700',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-50 text-slate-700'
  };

  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors">
      <div className={`p-2 rounded-lg flex-shrink-0 ${colorClasses[color as keyof typeof colorClasses]}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-500 mb-0.5">{label}</div>
        {isLink ? (
          <a href={label === 'Email' ? `mailto:${value}` : `tel:${value}`} className="text-sm text-slate-800 hover:text-indigo-600 block break-all hover:underline" title={value}>
            {value}
          </a>
        ) : (
          <p className="text-sm text-slate-800 break-words whitespace-pre-wrap" title={value}>{value}</p>
        )}
      </div>
    </div>
  );
};

const HorizontalActivityItem = ({ type, title, description, time, timestamp, user }: { type: 'success' | 'info' | 'processing' | 'warning' | 'note' | 'notification'; title: string; description: string; time: string; timestamp: string; user?: string; }) => {
  const typeConfig = {
    success: { color: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    info: { color: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: <Bell className="w-3.5 h-3.5" /> },
    processing: { color: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: <RefreshCw className="w-3.5 h-3.5" /> },
    warning: { color: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: <AlertCircle className="w-3.5 h-3.5" /> },
    note: { color: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', icon: <FileText className="w-3.5 h-3.5" /> },
    notification: { color: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: <Bell className="w-3.5 h-3.5" /> }
  };
  const config = typeConfig[type] || typeConfig.info;

  return (
    <div className={`min-w-[250px] p-4 rounded-lg border ${config.border} ${config.color} hover:shadow-md transition-shadow duration-200`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`p-2 rounded-lg ${config.color} ${config.text}`}>{config.icon}</div>
        <div className="flex-1">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-slate-800">{title}</span>
            <span className={`px-2 py-0.5 ${config.color} ${config.text} text-[10px] font-medium rounded-full flex items-center gap-1 whitespace-nowrap`}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{description}</p>
          {user && <p className="text-[10px] font-medium text-slate-500 mt-1">by {user}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <span className="truncate">{time}</span>
        <span className="w-1 h-1 bg-slate-300 rounded-full flex-shrink-0"></span>
        <span className="whitespace-nowrap">{timestamp}</span>
      </div>
    </div>
  );
};

const ItemComparisonCard = ({ item, index, RAN, onRejectClick }: { item: ReturnItem, index: number, RAN: string, onRejectClick: (itemId: number, item: ReturnItem) => void }) => {
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleDownloadAll = async () => {
    if (!item.customerImages || item.customerImages.length === 0) return;
    try {
      for (let i = 0; i < item.customerImages.length; i++) {
        const imageUrl = item.customerImages[i];
        const fileName = `${RAN}_${item.sku}_${i + 1}.jpg`;

        try {
          // Attempt 1: Fetch and Blob (Forces silent download without opening a new tab)
          // Note: This requires the image host (Firebase/Shopify) to have CORS enabled.
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error('Network response was not ok');
          
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } catch (fetchError) {
          console.warn(`Fetch failed for image ${i + 1}, falling back to direct link:`, fetchError);
          // Attempt 2: Direct link fallback (Will open in a new tab if cross-origin rules apply)
          const link = document.createElement('a');
          link.href = imageUrl;
          link.download = fileName;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        
        // Increased delay to 300ms to prevent browser from blocking rapid consecutive downloads
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error('Error downloading images:', error);
      alert('Failed to download some or all images.');
    }
  };

  const handleDownloadProductImage = async () => {
    if (!item.productImage) return;
    const fileName = `${RAN}_${item.sku}_product.jpg`;
    
    try {
      const response = await fetch(item.productImage);
      if (!response.ok) throw new Error('Network response was not ok');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('Error downloading product image, falling back to direct link:', error);
      const link = document.createElement('a');
      link.href = item.productImage;
      link.download = fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-200 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-md flex items-center justify-center text-xs font-semibold">{index + 1}</div>
          <span className="text-sm font-semibold text-slate-700">Item Details - {item.title}</span>
        </div>
        <button onClick={() => setIsExpanded(!isExpanded)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-50 transition-colors">
          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
        <div className="flex items-center gap-3">
          <button 
            onClick={(e) => {
              e.stopPropagation(); // Prevent card from collapsing if they click reject
              onRejectClick(item.lineItemId, item);
            }} 
            className="px-3 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Reject Item
          </button>
          
          <button onClick={() => setIsExpanded(!isExpanded)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-50 transition-colors">
            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-5">
        <div className={`p-5 ${isExpanded ? 'block' : 'hidden'}`}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><span className="w-2 h-2 bg-amber-500 rounded-full"></span>Uploaded Images</h3>
                <button onClick={handleDownloadAll} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 px-2 py-1 hover:bg-indigo-50 rounded-lg transition-colors">
                  <Download className="w-3 h-3" /> Download All
                </button>
              </div>

              <div className="relative w-full h-72 bg-gradient-to-br from-slate-50 to-white rounded-xl overflow-hidden border border-slate-200">
                {item.customerImages && item.customerImages.length > 0 ? (
                  <>
                    <ImageZoom src={item.customerImages[selectedImageIdx]} alt="Uploaded by customer" />
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md backdrop-blur-sm">
                      {selectedImageIdx + 1} / {item.customerImages.length}
                    </div>
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-2"><Package className="w-5 h-5" /></div>
                    <p className="text-sm">No Image Uploaded</p>
                  </div>
                )}
              </div>

              <div>
                <p className="font-medium text-slate-900 text-sm mb-2 line-clamp-2">{item.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md font-medium">SKU: {item.sku}</span>
                  <span className="text-slate-400">•</span>
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-medium">Qty: {item.quantityReturned}</span>
                  <span className="text-slate-400">•</span>
                  <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-md font-medium">{item.reason}</span>
                </div>
              </div>

              {item.customerImages && item.customerImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {item.customerImages.map((img, i) => (
                    <div key={i} onClick={() => setSelectedImageIdx(i)} className={`relative w-16 h-16 border-2 rounded-lg cursor-pointer transition-all shrink-0 overflow-hidden ${selectedImageIdx === i ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-md' : 'border-slate-200 hover:border-indigo-300'}`}>
                      <img src={img} className="w-full h-full object-cover hover:scale-110 transition-transform duration-300" alt={`thumb-${i}`} />
                      {selectedImageIdx === i && (
                        <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                          <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center"><CheckCircle2 className="w-3 h-3 text-white" /></div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hidden lg:flex lg:col-span-1 items-center justify-center relative">
              <div className="w-px h-64 bg-gradient-to-b from-transparent via-slate-300 to-transparent"></div>
              <div className="absolute"><RefreshCw className="w-6 h-6 text-slate-400 bg-white p-1 rounded-full" /></div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span>Original Product</h3>
                <button onClick={handleDownloadProductImage} className="text-xs text-slate-600 hover:text-slate-800 font-medium flex items-center gap-1 px-2 py-1 hover:bg-slate-100 rounded-lg transition-colors">
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>

              <div className="relative w-full h-72 bg-gradient-to-br from-emerald-50 to-white rounded-xl overflow-hidden border border-slate-200">
                <ImageZoom src={item.productImage} alt="Original Catalog" />
              </div>

              <div>
                <p className="font-medium text-slate-900 text-sm mb-2 line-clamp-2">{item.title}</p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Price:</span>
                    <span className="font-semibold text-slate-800">{item.price}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Return Value:</span>
                    <span className="font-bold text-emerald-600">₹{(parseFloat(item.price.replace(/[^0-9.]/g, '')) * item.quantityReturned).toFixed(2)}</span>
                  </div>
                  {item.note && (
                    <div className={`mt-3 p-3 bg-slate-50 rounded-lg ${isExpanded ? 'block' : 'hidden'}`}>
                      <p className="text-xs text-slate-600"><strong>Customer Note:</strong> {item.note}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          </div>
      </div>
    </div>
  );
};

export const ReturnDetailsPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [data, setData] = useState<ReturnData | null>(null);
  const [shopifyOrderData, setShopifyOrderData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeActivityTab, setActiveActivityTab] = useState<'all' | 'notes' | 'notifications'>('all');

  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isMarkReceivedModalOpen, setIsMarkReceivedModalOpen] = useState(false);
  const [isIssueRefundModalOpen, setIsIssueRefundModalOpen] = useState(false);
  const [labelPreview, setLabelPreview] = useState<string | null>(null);
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
  const [isCancelPickupModalOpen, setIsCancelPickupModalOpen] = useState(false);
  const [itemToReject, setItemToReject] = useState<{ id: number; item: ReturnItem } | undefined>(undefined);

  const fetchCustomerBalances = async (identifier: string, identifierType: 'email' | 'phone' = 'email'): Promise<CustomerBalances | null> => {
    try {
      const apiKey = import.meta.env.VITE_FLASK_API_KEY;
      const apiUrl = import.meta.env.VITE_FLASK_API_URL;
      
      const response = await fetch(`${apiUrl}/customer/balances`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey || '',
        },
        body: JSON.stringify({
          identifier: identifier,
          identifierType: identifierType
        })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch balances: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching customer balances:', error);
      return null;
    }
  };

  // Add this state variable with other useState declarations
  const [customerBalances, setCustomerBalances] = useState<CustomerBalances | null>(null);
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Add this useEffect to fetch balances when customer data is available
  useEffect(() => {
    const fetchBalances = async () => {
      if (data?.customer?.email) {
        setLoadingBalances(true);
        const balances = await fetchCustomerBalances(data.customer.email, 'email');
        setCustomerBalances(balances);
        setLoadingBalances(false);
      }
    };
    
    fetchBalances();
  }, [data?.customer?.email]);

  // Get the currently logged-in user
  const currentUser = getUserFromStorage();

  // Helper function to get agent name for activity logging
  const getAgentName = (): string => {
    if (currentUser?.name) {
      return currentUser.name;
    }
    // Fallback to email if name not available
    if (currentUser?.email) {
      return currentUser.email.split('@')[0];
    }
    return 'Unknown Agent';
  };

  useEffect(() => {
    fetchReturnDetails();
  }, [id]);

  const fetchReturnDetails = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const docRef = doc(db, 'returns', id);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const firestoreData = { id: docSnap.id, ...docSnap.data() } as ReturnData;

        if (firestoreData.orderId) {
          const shopifyOrder = await fetchShopifyOrder(firestoreData.orderId);
          if (shopifyOrder) {
            setShopifyOrderData(shopifyOrder);
            
            const shipping = shopifyOrder.shipping_address;
            const customer = shopifyOrder.customer;
            
            const shippingPhone = shipping?.phone || customer?.phone || shopifyOrder.phone || firestoreData.customer.phone;
            const shippingEmail = shopifyOrder.contact_email || shopifyOrder.email || customer?.email || firestoreData.customer.email;

            firestoreData.customer = {
              ...firestoreData.customer,
              email: shippingEmail,
              phone: shippingPhone,
              address: shipping ? [shipping.address1, shipping.address2].filter(Boolean).join(', ') : firestoreData.customer.address,
              city: shipping?.city || firestoreData.customer.city,
              state: shipping?.province || firestoreData.customer.state,
              zip: shipping?.zip || firestoreData.customer.zip,
              country: shipping?.country || firestoreData.customer.country,
            };
          }
        }
        setData(firestoreData);
        await fetchActivities(id);
      } else {
        setError('Return request not found.');
      }
    } catch (err) {
      console.error("Error fetching document:", err);
      setError('Failed to load return details.');
    } finally {
      setLoading(false);
    }
  };

  const fetchActivities = async (returnId: string) => {
    try {
      const activitiesRef = collection(db, 'returns', returnId, 'activities');
      const q = query(activitiesRef, orderBy('timestamp', 'desc'), limit(50));
      const querySnapshot = await getDocs(q);
      const activityList: ActivityItem[] = [];
      querySnapshot.forEach((doc) => activityList.push({ id: doc.id, ...doc.data() } as ActivityItem));
      setActivities(activityList);
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const addNote = async () => {
    if (!noteText.trim() || !data) return;
    setAddingNote(true);
    try {
      const activitiesRef = collection(db, 'returns', data.id, 'activities');
      await addDoc(activitiesRef, { 
        type: 'note', 
        title: 'Note Added', 
        description: noteText, 
        timestamp: Timestamp.now(), 
        user: getAgentName() // Use actual logged-in agent name
      });
      await fetchActivities(data.id);
      setNoteText('');
    } catch (error) {
      console.error('Error adding note:', error);
      alert('Failed to add note.');
    } finally {
      setAddingNote(false);
    }
  };

  const handleRejectConfirm = async (reason: string, allowResubmit: boolean, itemIdToReject?: number) => {
    if (!id || !data) return;

    try {
      const docRef = doc(db, 'returns', id);
      const agentName = getAgentName();

      if (itemIdToReject) {
        // ITEM-LEVEL REJECTION
        const itemToReject = data.items.find(item => item.lineItemId === itemIdToReject);
        if (!itemToReject) {
          throw new Error('Item not found');
        }

        const newRejectedItem: RejectedItem = {
          lineItemId: itemToReject.lineItemId,
          title: itemToReject.title,
          sku: itemToReject.sku,
          quantityReturned: itemToReject.quantityReturned,
          price: itemToReject.price,
          reason: reason,
          rejectedAt: Timestamp.now(),
          rejectedBy: agentName,
          rejectedByName: currentUser?.name || agentName
        };

        const currentRejected = data.rejectedItems || [];
        await updateDoc(docRef, {
          rejectedItems: [...currentRejected, newRejectedItem],
          updatedAt: serverTimestamp()
        });

        // Add activity log
        const activitiesRef = collection(db, 'returns', id, 'activities');
        await addDoc(activitiesRef, {
          type: 'warning',
          title: 'Item Rejected',
          description: `Item "${itemToReject.title}" (SKU: ${itemToReject.sku}) was rejected. Reason: ${reason}`,
          timestamp: Timestamp.now(),
          user: agentName,
          metadata: {
            lineItemId: itemIdToReject,
            sku: itemToReject.sku,
            title: itemToReject.title,
            reason: reason
          }
        });

        // Send email notification for item rejection
        await notifyItemRejection(data, itemToReject, reason);

        alert(`Item "${itemToReject.title}" has been rejected. It will be excluded from pickup and received processes.`);
        
      } else {
        // FULL REQUEST REJECTION (existing logic)
        const statusUpdate = allowResubmit ? 'Closed' : 'Denied';

        await updateDoc(docRef, {
          status: statusUpdate,
          rejectionReason: reason,
          allowResubmit: allowResubmit,
          updatedAt: serverTimestamp()
        });

        const activitiesRef = collection(db, 'returns', id, 'activities');
        await addDoc(activitiesRef, {
          type: allowResubmit ? 'info' : 'warning',
          title: `Request ${statusUpdate}`,
          description: `Reason: ${reason || 'No reason provided'}. ${allowResubmit ? 'User can reapply.' : 'Denied permanently.'}`,
          timestamp: Timestamp.now(),
          user: agentName
        });

        const returnData = {
          RAN: data.RAN,
          orderId: data.orderId,
          customer: data.customer,
          items: data.items,
          rejectionReason: reason,
          allowResubmit,
          status: statusUpdate
        };

        const emailSent = await notifyReturnRejection(returnData, reason, allowResubmit);

        const emailUpdateField = allowResubmit ? 'ClosedMailSent' : 'DeniedMailSent';
        await updateDoc(docRef, {
          [emailUpdateField]: emailSent,
          lastEmailAttempt: serverTimestamp(),
          ...(emailSent ? { emailSentAt: serverTimestamp() } : {})
        });
      }

      setIsRejectModalOpen(false);
      setItemToReject(undefined);
      fetchReturnDetails();

    } catch (err) {
      console.error("Error in rejection:", err);
      alert("Failed to process rejection");
    }
  };


  const getActiveItems = useCallback((items: ReturnItem[], rejectedItems: RejectedItem[] = []): ReturnItem[] => {
    const rejectedIds = new Set(rejectedItems.map(r => r.lineItemId));
    return items.filter(item => !rejectedIds.has(item.lineItemId));
  }, []);

  const handleMarkReceivedConfirm = async (category: string, restock: boolean) => {
    if (!id || !data) return;

    try {
      const docRef = doc(db, 'returns', id);
      const now = Timestamp.now();
      const agentName = getAgentName();
      
      // Get active items (exclude rejected ones)
      const activeItems = getActiveItems(data.items, data.rejectedItems);
      
      if (activeItems.length === 0) {
        alert('No active items to process. All items have been rejected.');
        setIsMarkReceivedModalOpen(false);
        return;
      }
      
      // Prepare restock items only from active items
      const restockItems = activeItems.map(item => ({
        lineItemId: item.lineItemId,
        quantityReturned: item.quantityReturned,
        sku: item.sku,
        title: item.title
      }));
      
      const updateData: any = {
        shipmentStatus: 'Received',
        itemCondition: category,
        returned_product_received: true,
        receivedAt: now,
        updatedAt: now
      };

      // Handle restock if checkbox is checked
      let restockRecord = null;
      if (restock && restockItems.length > 0) {
        try {
          restockRecord = await restockShopifyItems(
            restockItems,
            data.orderNumericId,
            id,
            data.RAN,
            agentName,
            category
          );
          
          updateData.isRestocked = true;
          updateData.restockStatus = 'Completed';
          updateData.restockedAt = now;
          updateData.restockedItems = restockRecord.items;
          updateData.totalQuantityRestocked = restockRecord.totalQuantityRestocked;
          
        } catch (restockError) {
          console.error("Restock failed:", restockError);
          updateData.isRestocked = false;
          updateData.restockStatus = 'Failed';
          updateData.restockErrorMessage = restockError instanceof Error ? restockError.message : 'Unknown error';
        }
      } else {
        updateData.isRestocked = false;
        updateData.restockStatus = 'Skipped';
      }

      // Update Firestore
      await updateDoc(docRef, updateData);

      // Add detailed activity log
      const activitiesRef = collection(db, 'returns', id, 'activities');
      await addDoc(activitiesRef, {
        type: 'success',
        title: 'Return Received',
        description: `${activeItems.length} item(s) marked as received. Condition: ${category}. ${restockRecord ? `Restocked ${restockRecord.totalQuantityRestocked} units.` : restock ? 'Restock attempted but failed.' : 'Not restocked.'}`,
        timestamp: now,
        user: agentName,
        metadata: {
          category,
          restocked: restock && restockRecord?.status === 'success',
          restockStatus: updateData.restockStatus,
          shipmentStatus: 'Received',
          totalQuantityRestocked: restockRecord?.totalQuantityRestocked || 0,
          restockRecordId: restockRecord?.id || null,
          processedItemCount: activeItems.length,
          rejectedItemCount: (data.rejectedItems?.length || 0)
        }
      });

      setIsMarkReceivedModalOpen(false);
      await fetchReturnDetails();

      const message = `Return marked as received successfully. Processed ${activeItems.length} item(s). ${restockRecord ? `Restocked ${restockRecord.totalQuantityRestocked} units.` : restock ? 'Restock failed. Please check logs.' : ''}`;
      alert(message);

    } catch (err) {
      console.error("Error marking received:", err);
      alert("Failed to update status. Please try again.");
    }
  };

  const calculateTotal = (items: ReturnItem[]) => 
    items.reduce((acc, item) => acc + (parseFloat(item.price.replace(/[^0-9.]/g, '')) || 0) * item.quantityReturned, 0).toFixed(2);

  const formatDate = (timestamp: any) => {
    if (!timestamp) return { month: '---', day: '--', full: 'N/A', time: '--:--', relative: '' };
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    return {
      month: date.toLocaleString('default', { month: 'short' }),
      day: date.getDate().toString().padStart(2, '0'),
      full: date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      relative: diffDays === 0 ? 'Today' : diffDays === 1 ? 'Yesterday' : `${diffDays} days ago`
    };
  };

  const ActionMenu = () => (
    <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-30 animate-fadeIn">
      {[
        { label: 'Create Pickup', icon: <Truck className="w-3.5 h-3.5" />, color: 'text-blue-600', action: 'pickup' },
        { label: 'Request Self Ship', icon: <Truck className="w-3.5 h-3.5" />, color: 'text-amber-600', action: 'self' },
        { label: 'Cancel Pickup', icon: <X className="w-3.5 h-3.5" />, color: 'text-red-600', action: 'cancel' },
      ].map((action, idx) => (
        <button 
          key={idx} 
          onClick={() => { 
            if (action.action === 'cancel') {
              setIsCancelPickupModalOpen(true);
            } else {
              setActiveAction(action.action);
            }
            setIsMenuOpen(false); 
          }} 
          className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-all duration-200 flex items-center gap-3 group"
        >
          <div className={`p-1.5 rounded-lg bg-slate-100 group-hover:bg-white ${action.color}`}>{action.icon}</div>
          <span className="flex-1">{action.label}</span>
          <ChevronDown className="w-3 h-3 text-slate-400 -rotate-90" />
        </button>
      ))}
    </div>
  );

  const filteredActivities = activities.filter(activity => 
    activeActivityTab === 'all' || 
    (activeActivityTab === 'notes' && activity.type === 'note') || 
    (activeActivityTab === 'notifications' && activity.type === 'notification')
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col items-center justify-center p-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center"><Package className="w-6 h-6 text-indigo-600 animate-pulse" /></div>
        </div>
        <p className="mt-4 text-slate-600 font-medium">Loading return details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white p-8 flex justify-center">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center max-w-md shadow-lg">
          <div className="w-16 h-16 bg-gradient-to-br from-red-50 to-pink-50 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-8 h-8 text-red-500" /></div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to Load Details</h2>
          <p className="text-sm text-slate-500 mb-6">{error}</p>
          <button onClick={() => navigate('/returns')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium">Go Back to Returns</button>
        </div>
      </div>
    );
  }

  const dateObj = formatDate(data.createdAt);
  const totalAmount = calculateTotal(data.items);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white p-4 sm:p-6">
      <div className="mb-8">
        
        {/* Back Button */}
        <button 
          onClick={() => navigate('/returns')} 
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors mb-6 font-medium w-fit group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Returns
        </button>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex flex-col items-center justify-center text-white shadow-lg">
                <span className="text-[11px] font-semibold uppercase tracking-wider">{dateObj.month}</span>
                <span className="text-xl font-bold leading-none">{dateObj.day}</span>
              </div>
              <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center"><Package className="w-3 h-3 text-white" /></div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                <span>Request Submitted • {dateObj.relative}</span><span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span><span>{dateObj.time}</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900">RAN {data.RAN}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">Order #{data.orderId}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setIsRejectModalOpen(true)} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-red-50 hover:text-red-600 text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-sm whitespace-nowrap"><X className="w-3.5 h-3.5" /> Reject</button>
            <button
              onClick={() => setIsExchangeModalOpen(true)}
              className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Convert to Exchange
            </button>
            <div className="relative">
              <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md whitespace-nowrap">
                <Truck className="w-3.5 h-3.5" /> Reverse Shipment <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isMenuOpen && <><div className="fixed inset-0 z-20" onClick={() => setIsMenuOpen(false)} /><ActionMenu /></>}
            </div>

            <button onClick={() => setIsMarkReceivedModalOpen(true)} className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5" /> Mark Received</button>
            <button onClick={() => setIsIssueRefundModalOpen(true)} className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md whitespace-nowrap"><CreditCard className="w-3.5 h-3.5" /> Issue Refund</button>
          </div>
        </div>

        {/* Three Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Return Status Card */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Return Status</div>
              <Package className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-center gap-2">
              <ReturnStatusBadge status={data.status} />
              {data.status === 'Completed' && (
                <span className="text-xs text-emerald-600 font-medium">✓ Completed</span>
              )}
            </div>
            {data.completedAt && (
              <div className="mt-2 text-[10px] text-slate-400">
                Completed: {formatDate(data.completedAt).full}
              </div>
            )}
          </div>

          {/* Shipment Status Card */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Shipment Status</div>
              <Truck className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-center gap-2">
              <ShipmentStatusBadge status={data.shipmentStatus} />
              {data.awb && (
                <span className="text-xs font-mono text-slate-500">{data.awb}</span>
              )}
            </div>
            {data.receivedAt ? (
              <div className="mt-2 text-[10px] text-slate-400">
                Received: {formatDate(data.receivedAt).full}
              </div>
            ) : data.pickupDate && (
              <div className="mt-2 text-[10px] text-slate-400">
                Pickup: {new Date(data.pickupDate).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Refund Status Card */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Refund Status</div>
              <CreditCard className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex items-center gap-2">
              <RefundStatusBadge status={data.refundStatus} method={data.requestedMethod} />
              <span className="text-xs text-slate-500 capitalize">{data.requestedMethod?.replace('_', ' ') || 'Original Payment'}</span>
            </div>
            {data.refundedAt ? (
              <div className="mt-2 text-[10px] text-slate-400">
                Refunded: {formatDate(data.refundedAt).full}
              </div>
            ) : data.refundStatus === 'Processing' && (
              <div className="mt-2 text-[10px] text-amber-600">
                Processing refund...
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 mb-1">Total Value</div>
            <div className="text-xl font-bold text-slate-900">₹{totalAmount}</div>
            <div className="text-xs text-slate-400 mt-1">for {data.items.length} item{data.items.length > 1 ? 's' : ''}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 mb-1">Refund Method</div>
            <div className="text-lg font-semibold text-slate-900 capitalize">{data.requestedMethod?.replace('_', ' ') || 'Original Payment'}</div>
            <div className="text-xs text-slate-400 mt-1 flex items-center gap-1"><CreditCard className="w-3 h-3" /> {data.paymentMethod || 'Prepaid'}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 mb-1">AWB Tracking</div>
            <div className="text-lg font-semibold text-slate-900">
              {data.awb || 'Not assigned'}
            </div>
            {data.shippingLabelUrl && (
              <button
                onClick={() => setLabelPreview(data.shippingLabelUrl ?? null)}
                className="mt-2 px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow-md whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                View Shipping Label
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 mb-1">Customer Contact</div>
            <div className="text-sm font-semibold text-slate-900 truncate" title={data.customer.name}>{data.customer.name}</div>
            <div className="text-xs text-slate-400 mt-1 truncate" title={data.customer.email}>{data.customer.email}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>Request Details</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Request Type</label>
                <div className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium w-fit">{data.type}</div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Return Status</label>
                <ReturnStatusBadge status={data.status} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Shipment Status</label>
                <ShipmentStatusBadge status={data.shipmentStatus} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Refund Status</label>
                <RefundStatusBadge status={data.refundStatus} method={data.requestedMethod} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Primary Reason</label>
                <p className="text-sm text-slate-800">{data.items[0]?.reason || 'Not specified'}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Refund Amount</label>
                <p className="text-lg font-bold text-emerald-600">₹{totalAmount}</p>
              </div>
              {data.refundEligibility && (
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Refund Eligibility</label>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${data.refundEligibility === 'Eligible' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{data.refundEligibility}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-lg flex items-center justify-center">
                <User className="w-4 h-4 text-indigo-600" />
              </div>
              Customer Info
            </h3>
            <div className="space-y-3">
              <InfoCard icon={<User className="w-4 h-4" />} label="Name" value={data.customer.name} color="indigo" />
              <InfoCard icon={<Mail className="w-4 h-4" />} label="Email" value={data.customer.email} isLink={true} color="blue" />
              <InfoCard icon={<Phone className="w-4 h-4" />} label="Phone" value={data.customer.phone || 'Not provided'} color="emerald" />
              <InfoCard icon={<MapPin className="w-4 h-4" />} label="Address" value={formatAddress(data.customer) || 'Not provided'} color="amber" />
              
              {/* Balances Section - Only show if customer found in Shopify */}
              {customerBalances && customerBalances.customer_found && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 bg-gradient-to-br from-emerald-100 to-green-100 rounded-lg flex items-center justify-center">
                      <Gift className="w-3.5 h-3.5 text-emerald-600" />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-700">Customer Balances</h4>
                  </div>
                  
                  {/* Store Credit Section */}
                  {customerBalances.store_credit_accounts && customerBalances.store_credit_accounts.length > 0 && (
                    <div className="mb-3 p-3 bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl border border-emerald-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-emerald-700 uppercase tracking-wide">💰 Store Credit</span>
                        <span className="text-[10px] text-emerald-600 bg-white px-2 py-0.5 rounded-full">
                          {customerBalances.store_credit_accounts.length} account{customerBalances.store_credit_accounts.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      {customerBalances.store_credit_accounts.map((account) => (
                        <div key={account.id} className="flex justify-between items-center">
                          <span className="text-sm text-emerald-800 font-medium">
                            ₹{account.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] text-emerald-600 bg-white/70 px-2 py-0.5 rounded-md font-mono">
                            {account.balance_currency}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Gift Cards Section */}
                  {customerBalances.gift_cards && customerBalances.gift_cards.length > 0 && (
                    <div className="p-3 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-purple-700 uppercase tracking-wide">🎁 Gift Cards</span>
                        <span className="text-[10px] text-purple-600 bg-white px-2 py-0.5 rounded-full">
                          {customerBalances.gift_cards.length} card{customerBalances.gift_cards.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {customerBalances.gift_cards.map((card) => (
                          <div key={card.id} className="bg-white/50 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-mono text-purple-700">
                                {card.code || '•••• •••• ••••'}
                              </span>
                              <span className="text-xs font-semibold text-purple-800">
                                ₹{card.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="text-[10px] text-purple-500">
                              {card.balance_currency}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* No Balances Message */}
                  {(!customerBalances.store_credit_accounts || customerBalances.store_credit_accounts.length === 0) &&
                  (!customerBalances.gift_cards || customerBalances.gift_cards.length === 0) && (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                      <p className="text-xs text-slate-500">No active gift cards or store credit available</p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Loading State for Balances */}
              {loadingBalances && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex items-center justify-center p-3">
                    <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <span className="ml-2 text-xs text-slate-500">Loading balances...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          
        </div>

        <div className="lg:col-span-9 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Items Comparison</h2>
              <span className="text-sm text-slate-500">{data.items.length} item{data.items.length > 1 ? 's' : ''}</span>
            </div>
            {data.items.map((item, index) => (
              <ItemComparisonCard 
                key={index} 
                item={item} 
                index={index} 
                RAN={data.RAN} 
                onRejectClick={(itemId, item) => {
                  setItemToReject({ id: itemId, item: item });
                  setIsRejectModalOpen(true);
                }}
              />
            ))}
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4 md:mb-0">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-100 to-orange-100 rounded-lg flex items-center justify-center"><Bell className="w-4 h-4 text-amber-600" /></div>
                Activity Timeline
              </h3>
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                {['all', 'notes', 'notifications'].map((tab) => (
                  <button key={tab} onClick={() => setActiveActivityTab(tab as any)} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 whitespace-nowrap ${activeActivityTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                    {tab === 'notes' && <FileText className="w-3 h-3" />}{tab === 'notifications' && <Bell className="w-3 h-3" />}
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === 'notes' && <span className="ml-1 px-1.5 py-0.5 bg-white text-xs rounded-full">{activities.filter(a => a.type === 'note').length}</span>}
                  </button>
                ))}
              </div>
            </div>

            {filteredActivities.length > 0 ? (
              <div className="overflow-x-auto pb-4 -mx-5 px-5">
                <div className="flex gap-4 min-w-max">
                  {filteredActivities.map((activity, index) => (
                    <React.Fragment key={activity.id}>
                      <HorizontalActivityItem 
                        type={activity.type as any} 
                        title={activity.title} 
                        description={activity.description} 
                        time={formatDate(activity.timestamp).full} 
                        timestamp={formatDate(activity.timestamp).time} 
                        user={activity.user || (activity.type === 'note' ? 'System' : undefined)}
                      />
                      {index < filteredActivities.length - 1 && <div className="w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent"></div>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3"><Bell className="w-6 h-6 text-slate-400" /></div>
                <p className="text-sm text-slate-500">No activities yet</p>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3"><Plus className="w-4 h-4 text-slate-400" /><label className="text-sm font-medium text-slate-700">Add Note</label></div>
              <div className="flex flex-col sm:flex-row gap-3">
                <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Type your note here..." className="flex-1 border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-200 outline-none resize-none h-20" rows={2} />
                <div className="flex flex-col sm:flex-row gap-2">
                  <button onClick={addNote} disabled={addingNote || !noteText.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">{addingNote ? 'Adding...' : 'Save Note'}</button>
                  <button onClick={() => setNoteText('')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CreatePickupModal
        isOpen={activeAction === 'pickup'}
        onClose={() => setActiveAction(null)}
        orderId={data.id}
        RAN={data.RAN}
        customer={data.customer as any}
        items={data.items}
        rejectedItems={data.rejectedItems} // Pass rejected items
        currentUser={currentUser}
      />

      <SelfShipModal
        isOpen={activeAction === 'self'}
        onClose={() => setActiveAction(null)}
        orderId={data?.orderId || ''}
        RAN={data?.RAN || ''}
        customerEmail={data?.customer?.email}
        customerName={data?.customer?.name}
        requestedMethod={data?.requestedMethod as 'gift_card' | 'refund' | undefined}
        currentUser={currentUser}      />

      <RejectRequestModal
        isOpen={isRejectModalOpen}
        onClose={() => {
          setIsRejectModalOpen(false);
          setItemToReject(undefined);
        }}
        onConfirm={handleRejectConfirm}
        orderId={data?.orderId}
        RAN={data?.RAN}
        customerName={data?.customer?.name}
        customerEmail={data?.customer?.email}
        currentUser={currentUser}
        itemIdToReject={itemToReject?.id}
        itemToReject={itemToReject?.item}
      />

      <ExchangeModal
        isOpen={isExchangeModalOpen}
        onClose={() => setIsExchangeModalOpen(false)}
        orderId={data.id}
        data={data}
        currentUser={currentUser}
        onSuccess={fetchReturnDetails}
      />

      <MarkReceivedModal
        isOpen={isMarkReceivedModalOpen}
        onClose={() => setIsMarkReceivedModalOpen(false)}
        onConfirm={handleMarkReceivedConfirm}
        currentUser={currentUser}
        items={getActiveItems(data?.items || [], data?.rejectedItems)}
        RAN={data?.RAN}
        orderId={data?.orderId}
        customerName={data?.customer?.name}
        customerEmail={data?.customer?.email}
        requestedMethod={data?.requestedMethod}
      />

      <IssueRefundModal
        isOpen={isIssueRefundModalOpen}
        onClose={() => setIsIssueRefundModalOpen(false)}
        orderId={data.id}
        data={data}
        shopifyOrder={shopifyOrderData}
        currentUser={currentUser} // Pass current user for tracking
      />

      <CancelPickupModal
        isOpen={isCancelPickupModalOpen}
        onClose={() => setIsCancelPickupModalOpen(false)}
        orderId={data.id}
        RAN={data.RAN}
        currentAWB={data.awb}
        customerEmail={data.customer?.email}
        currentUser={currentUser} // Pass current user for tracking
        onSuccess={() => {
          fetchReturnDetails();
        }}
      />

      {labelPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-[90%] h-[90%] relative shadow-2xl">
            <button
              onClick={() => setLabelPreview(null)}
              className="absolute top-3 right-3 bg-slate-100 hover:bg-slate-200 p-2 rounded-lg"
            >
              <X className="w-4 h-4"/>
            </button>
            <iframe
              src={labelPreview}
              className="w-full h-full rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};