import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  ChevronDown, 
  Package,
  CreditCard,
  RefreshCw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';

interface ReturnRequest {
  id: string;
  RAN: string;
  orderId: string;
  orderNumericId?: number;
  awb?: string;
  type: string;
  status: 'Open' | 'Approved' | 'Denied' | 'Closed' | 'Completed' | 'Pending';
  shipmentStatus?: 'Not Created' | 'Pickup Created' | 'Pickup Scheduled' | 'In Transit' | 'Product Reached' | 'Pickup Exception' | 'Received' | 'Pickup Cancelled' | 'Failed';
  courierStatus?: string;
  refundStatus?: 'Pending' | 'Processing' | 'Refunded' | 'Failed' | 'Not Eligible' | 'Skipped';
  items: {
    title: string;
    productImage: string;
    reason: string;
    quantityReturned: number;
    price?: string;
  }[];
  customer?: {
    zip?: string;
    [key: string]: any;
  };
  requestedMethod?: 'refund' | 'gift_card' | 'store_credit' | 'manual';
  createdAt: any;
  completedAt?: any;
  refundedAt?: any;
  itemCondition?: 'Fresh' | 'Seconds' | 'Defect / Damaged Item';
  isRestocked?: boolean;
}

export const Returns = () => {
  const navigate = useNavigate();
  
  // State
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [serviceablePincodes, setServiceablePincodes] = useState<Record<string, boolean>>({});
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [, setTotalItems] = useState(0);
  
  // Filter States
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'active' | 'product_received' | 'received' | 'completed' | 'rejected' | 'failed'>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [shipmentFilter, setShipmentFilter] = useState<string>('all');
  const [refundFilter, setRefundFilter] = useState<string>('all');
  const [refundTypeFilter, setRefundTypeFilter] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "returns"), orderBy("createdAt", "desc"), limit(1000));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ReturnRequest[];
      setReturns(fetchedData);
      setTotalItems(fetchedData.length);
      setLoading(false);
      setRefreshing(false);
    }, (error) => {
      console.error("Error fetching returns:", error);
      setLoading(false);
      setRefreshing(false);
    });

    return () => unsubscribe();
  }, []);

  // Bulk Tracking Sync Logic
  const handleSyncTracking = async () => {
    setSyncing(true);
    try {
      const activeReturns = returns.filter(r => 
        r.awb && 
        ['pickup created', 'pickup scheduled', 'in transit', 'pickup exception'].includes(r.shipmentStatus?.toLowerCase() || '')
      );

      if (activeReturns.length === 0) {
        alert("No active shipments to sync.");
        setSyncing(false);
        return;
      }

      await Promise.all(activeReturns.map(async (ret) => {
        try {
          const API_URL = import.meta.env.VITE_FLASK_API_URL || '/api';
          const API_KEY = import.meta.env.VITE_FLASK_API_KEY;
          
          const response = await fetch(`${API_URL}/bluedart/tracking?awb=${ret.awb}`, {
            headers: { 'X-API-Key': API_KEY }
          });
          
          if (!response.ok) return;
          const data = await response.json();
          
          if (data.success && data.tracking) {
            const shipmentData = data.tracking?.ShipmentData;
            let shipment = null;
            
            if (Array.isArray(shipmentData)) {
              shipment = shipmentData[0]?.Shipment || shipmentData[0];
            } else if (shipmentData?.Shipment) {
               shipment = Array.isArray(shipmentData.Shipment) ? shipmentData.Shipment[0] : shipmentData.Shipment;
            } else {
               shipment = shipmentData; 
            }

            if (!shipment) return;

            const statusType = shipment.StatusType || '';
            const statusDescription = (shipment.Status || '').toUpperCase();
            
            let newShipmentStatus = ret.shipmentStatus;

            if (statusType === 'DL' || statusDescription.includes('DELIVERED') || statusDescription.includes('RECEIVED')) {
              newShipmentStatus = 'Product Reached';
            } 
            else if (
              statusDescription.includes('TRANSIT') || 
              statusDescription.includes('NETWORK') || 
              statusDescription.includes('HUB') || 
              statusDescription.includes('DISPATCHED') ||
              statusDescription.includes('OUT FOR DELIVERY') ||
              statusType === 'UD'
            ) {
              newShipmentStatus = 'In Transit';
            } 
            else if (
              statusDescription.includes('REGISTERED') || 
              statusDescription.includes('SCHEDULED')
            ) {
              newShipmentStatus = 'Pickup Scheduled';
            }
            else if (
              statusDescription.includes('NOT READY') || 
              statusDescription.includes('UNSUCCESSFUL') || 
              statusDescription.includes('PAPERWORK') ||
              statusDescription.includes('NEXT BUSINESS DAY')
            ) {
              newShipmentStatus = 'Pickup Exception';
            }
            else if (
              statusDescription.includes('CANCEL') || 
              statusDescription.includes('RETURNED') ||
              statusDescription.includes('DUPLICATE') ||
              statusDescription.includes('UNDELIVERED') ||
              statusDescription.includes('RTO')
            ) {
              newShipmentStatus = 'Failed';
            }
            
            if (newShipmentStatus !== ret.shipmentStatus || statusDescription !== ret.courierStatus) {
               const docRef = doc(db, 'returns', ret.id);
               await updateDoc(docRef, {
                 shipmentStatus: newShipmentStatus,
                 courierStatus: statusDescription,
                 updatedAt: new Date()
               });
            }
          }
        } catch (err) {
          console.error(`Failed tracking for ${ret.awb}`, err);
        }
      }));
      
    } catch (error) {
      console.error("Error syncing tracking:", error);
    } finally {
      setSyncing(false);
    }
  };

  // Status Helper Functions
  const isStatusOpen = (r: ReturnRequest) => {
    const s = r.status?.toLowerCase();
    const shipStatus = r.shipmentStatus?.toLowerCase();
    const hasOpenStatus = s === 'open' || s === 'pending' || s === 'approved';
    
    const shipmentNotStarted = !shipStatus || shipStatus === 'not created' || shipStatus === 'pickup cancelled';
    return hasOpenStatus && shipmentNotStarted;
  };

  const isShipmentActive = (r: ReturnRequest) => {
    const shipStatus = r.shipmentStatus?.toLowerCase();
    return shipStatus === 'pickup created' || 
           shipStatus === 'pickup scheduled' || 
           shipStatus === 'in transit' ||
           shipStatus === 'pickup exception' ||
           shipStatus === 'self ship requested';
  };

  const isProductReached = (r: ReturnRequest) => {
    const shipStatus = r.shipmentStatus?.toLowerCase();
    return shipStatus === 'product reached' && 
           r.status?.toLowerCase() !== 'completed' &&
           r.status?.toLowerCase() !== 'closed' &&
           r.status?.toLowerCase() !== 'denied';
  };

  const isReceived = (r: ReturnRequest) => {
    return r.shipmentStatus?.toLowerCase() === 'received' && 
           r.status?.toLowerCase() !== 'completed' &&
           r.status?.toLowerCase() !== 'closed' &&
           r.status?.toLowerCase() !== 'denied';
  };

  const isCompleted = (r: ReturnRequest) => {
    return r.status?.toLowerCase() === 'completed' || 
           (r.shipmentStatus?.toLowerCase() === 'received' && 
            r.refundStatus?.toLowerCase() === 'refunded');
  };

  const isRejected = (r: ReturnRequest) => {
    const mainStatus = r.status?.toLowerCase();
    return mainStatus === 'denied' || mainStatus === 'closed';
  };

  const isFailed = (r: ReturnRequest) => {
    const shipStatus = r.shipmentStatus?.toLowerCase();
    const refundStatus = r.refundStatus?.toLowerCase();
    
    return shipStatus === 'failed' || 
           shipStatus === 'cancelled' || 
           refundStatus === 'failed';
  };

  // Efficient Single-Pass Filtering Logic
  const filteredData = useMemo(() => {
    const searchLower = searchTerm ? searchTerm.toLowerCase() : '';
    const shipFilterLower = shipmentFilter !== 'all' ? shipmentFilter.toLowerCase() : '';
    const refundFilterLower = refundFilter !== 'all' ? refundFilter.toLowerCase() : '';
    const refundTypeFilterLower = refundTypeFilter !== 'all' ? refundTypeFilter.toLowerCase() : '';

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    let cutoffDate: Date | null = null;
    if (dateFilter === '7days') {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
    } else if (dateFilter === '30days') {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    } else if (dateFilter === '90days') {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
    }

    let customStart: Date | null = null;
    let customEnd: Date | null = null;
    if (dateFilter === 'custom') {
      if (customStartDate) {
        customStart = new Date(customStartDate);
        customStart.setHours(0, 0, 0, 0);
      }
      if (customEndDate) {
        customEnd = new Date(customEndDate);
        customEnd.setHours(23, 59, 59, 999);
      }
    }

    const filtered = returns.filter(r => {
      // Tab Filter
      if (activeTab === 'open' && !isStatusOpen(r)) return false;
      if (activeTab === 'active' && !isShipmentActive(r)) return false;
      if (activeTab === 'product_received' && !isProductReached(r)) return false;
      if (activeTab === 'received' && !isReceived(r)) return false;
      if (activeTab === 'completed' && !isCompleted(r)) return false;
      if (activeTab === 'rejected' && !isRejected(r)) return false;
      if (activeTab === 'failed' && !isFailed(r)) return false;

      // Search Filter
      if (searchLower) {
        const matchRAN = r.RAN?.toLowerCase().includes(searchLower);
        const matchOrder = r.orderId?.toLowerCase().includes(searchLower);
        const matchAWB = r.awb?.toLowerCase().includes(searchLower);
        if (!matchRAN && !matchOrder && !matchAWB) return false;
      }

      // Shipment Status Filter
      if (shipFilterLower && r.shipmentStatus?.toLowerCase() !== shipFilterLower) {
        return false;
      }

      // Refund Status Filter
      if (refundFilterLower && r.refundStatus?.toLowerCase() !== refundFilterLower) {
        return false;
      }

      // Refund Type Filter
      if (refundTypeFilterLower) {
        const method = r.requestedMethod?.toLowerCase() || 'refund';
        if (refundTypeFilterLower === 'original_payment' && method !== 'refund') return false;
        if (refundTypeFilterLower !== 'original_payment' && method !== refundTypeFilterLower) return false;
      }

      // Date Range Filter
      if (dateFilter !== 'all') {
        if (!r.createdAt) return false;
        const itemDate = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);

        if (dateFilter === 'today') {
          if (itemDate < startOfToday) return false;
        } else if (dateFilter === 'yesterday') {
          if (itemDate < startOfYesterday || itemDate >= startOfToday) return false;
        } else if (cutoffDate) {
          if (itemDate < cutoffDate) return false;
        } else if (dateFilter === 'custom') {
          if (customStart && itemDate < customStart) return false;
          if (customEnd && itemDate > customEnd) return false;
        }
      }
      return true;
    });

    return filtered;
  }, [returns, activeTab, searchTerm, dateFilter, shipmentFilter, refundFilter, refundTypeFilter, customStartDate, customEndDate]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredData.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchTerm, dateFilter, shipmentFilter, refundFilter, refundTypeFilter]);

  // Check Pincode Serviceability for the current page
  useEffect(() => {
    const checkPincodes = async () => {
      // Extract unique pincodes that haven't been checked yet
      const pincodesToCheck = Array.from(new Set(
        currentItems
          .map(item => item.customer?.zip)
          .filter(zip => zip && typeof serviceablePincodes[zip] === 'undefined')
      )) as string[];

      if (pincodesToCheck.length === 0) return;

      try {
        const API_URL = import.meta.env.VITE_FLASK_API_URL || '/api';
        const API_KEY = import.meta.env.VITE_FLASK_API_KEY;
        
        const response = await fetch(`${API_URL}/bluedart/serviceability`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY || ''
          },
          body: JSON.stringify({ pincodes: pincodesToCheck })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.results) {
            setServiceablePincodes(prev => ({ ...prev, ...data.results }));
          }
        }
      } catch (error) {
        console.error("Failed to check pincode serviceability:", error);
      }
    };

    checkPincodes();
  }, [currentItems, serviceablePincodes]); 

  // Counts
  const counts = useMemo(() => ({
    all: returns.length,
    open: returns.filter(isStatusOpen).length,
    active: returns.filter(isShipmentActive).length,
    product_received: returns.filter(isProductReached).length,
    received: returns.filter(isReceived).length,
    completed: returns.filter(isCompleted).length,
    rejected: returns.filter(isRejected).length,
    failed: returns.filter(isFailed).length,
  }), [returns]);

  const hasActiveFilters = searchTerm !== '' || dateFilter !== 'all' || shipmentFilter !== 'all' || refundFilter !== 'all' || refundTypeFilter !== 'all';

  const handleClearAll = () => {
    setSearchTerm('');
    setDateFilter('all');
    setShipmentFilter('all');
    setRefundFilter('all');
    setRefundTypeFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
  };
  
  const formatRefundType = (method?: string) => {
    switch (method) {
      case 'store_credit': return 'Store Credit';
      case 'gift_card': return 'Gift Card';
      case 'manual': return 'Manual Refund';
      case 'refund':
      default: return 'Original Payment';
    }
  };

  // Visibility Logic for Filters
  const showShipmentFilter = activeTab === 'all' || activeTab === 'failed' || activeTab === 'active';
  const showRefundStatusFilter = ['all', 'received', 'completed', 'failed', 'product_received'].includes(activeTab);
  const showRefundTypeFilter = ['all', 'received', 'completed', 'failed', 'product_received'].includes(activeTab);

  // Pagination handlers
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const goToPreviousPage = () => goToPage(currentPage - 1);
  const goToNextPage = () => goToPage(currentPage + 1);

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Returns & Exchanges</h1>
          <p className="text-slate-500 text-sm mt-1">Track and manage all return requests</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        
        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto custom-scrollbar">
          <TabButton label="All" count={counts.all} active={activeTab === 'all'} onClick={() => setActiveTab('all')} />
          <TabButton label="OPEN" count={counts.open} active={activeTab === 'open'} onClick={() => setActiveTab('open')} />
          <TabButton label="Active Shipments" count={counts.active} active={activeTab === 'active'} onClick={() => setActiveTab('active')} />
          <TabButton label="Product Reached" count={counts.product_received} active={activeTab === 'product_received'} onClick={() => setActiveTab('product_received')} />
          <TabButton label="Received" count={counts.received} active={activeTab === 'received'} onClick={() => setActiveTab('received')} />
          <TabButton label="Completed" count={counts.completed} active={activeTab === 'completed'} onClick={() => setActiveTab('completed')} />
          <TabButton label="Rejected" count={counts.rejected} active={activeTab === 'rejected'} onClick={() => setActiveTab('rejected')} />
          <TabButton label="Failed" count={counts.failed} active={activeTab === 'failed'} onClick={() => setActiveTab('failed')} />
        </div>

        {/* Dynamic Filter Toolbar */}
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/50">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search RAN, Order ID, AWB..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            />
          </div>
          
          {/* Always Show Date Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative group">
              <select 
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value);
                  if (e.target.value !== 'custom') {
                    setCustomStartDate('');
                    setCustomEndDate('');
                  }
                }}
                className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="90days">Last 90 days</option>
                <option value="custom">Custom Range</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>

            {dateFilter === 'custom' && (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                <input 
                  type="date" 
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="py-2 px-3 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
                />
                <span className="text-slate-400 text-sm">to</span>
                <input 
                  type="date" 
                  value={customEndDate}
                  min={customStartDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="py-2 px-3 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
            )}
          </div>

          {showShipmentFilter && (
            <div className="relative group">
              <select 
                value={shipmentFilter}
                onChange={(e) => setShipmentFilter(e.target.value)}
                className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
              >
                <option value="all">All Shipments</option>
                <option value="pickup created">Pickup Created</option>
                <option value="pickup scheduled">Pickup Scheduled</option>
                <option value="pickup exception">Pickup Exception</option>
                <option value="in transit">In Transit</option>
                <option value="product reached">Product Reached</option>
                <option value="received">Received</option>
                <option value="pickup cancelled">Cancelled</option>
                <option value="failed">Failed</option>
                <option value="self ship requested">Self Ship Requested</option> {/* <-- ADDED */}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
          )}

          {showRefundStatusFilter && (
            <div className="relative group">
              <select 
                value={refundFilter}
                onChange={(e) => setRefundFilter(e.target.value)}
                className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
              >
                <option value="all">All Refund Statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="refunded">Refunded</option>
                <option value="failed">Failed</option>
                <option value="not eligible">Not Eligible</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
          )}

          {showRefundTypeFilter && (
            <div className="relative group">
              <select 
                value={refundTypeFilter}
                onChange={(e) => setRefundTypeFilter(e.target.value)}
                className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
              >
                <option value="all">All Refund Types</option>
                <option value="store_credit">Store Credit</option>
                <option value="gift_card">Gift Card</option>
                <option value="original_payment">Original Payment</option>
                <option value="manual">Manual Refund</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
            </div>
          )}
          
          {hasActiveFilters && (
            <button onClick={handleClearAll} className="text-sm text-indigo-600 font-medium hover:underline cursor-pointer transition-all">
              Clear filters
            </button>
          )}

          <button 
            onClick={handleSyncTracking}
            disabled={syncing}
            className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
            {syncing ? 'Syncing...' : 'Sync Tracking'}
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="p-4 w-10"><input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /></th>
                <th className="p-4">Date</th>
                <th className="p-4">RAN</th>
                <th className="p-4">Order ID</th>
                <th className="p-4">AWB</th>
                <th className="p-4">Product</th>
                <th className="p-4">Return Status</th>
                <th className="p-4">Shipment Status</th>
                <th className="p-4">Courier Status</th>
                <th className="p-4">Refund Type</th>
                <th className="p-4">Refund Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={12} className="p-12 text-center text-slate-500">
                    <div className="flex justify-center items-center gap-2">
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      Loading requests...
                    </div>
                  </td>
                </tr>
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-12 text-center text-slate-500">
                    No return requests found matching your filters.
                  </td>
                </tr>
              ) : (
                currentItems.map((req) => {
                  const isServiceable = req.customer?.zip ? serviceablePincodes[req.customer.zip] : true;
                  const rowClass = 'hover:bg-slate-50 transition-colors group cursor-pointer';

                  return (
                    <tr 
                      key={req.id} 
                      onClick={() => navigate(`/returns/${req.id}`)}
                      className={rowClass}
                    >
                      <td className="p-4" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                      </td>
                      <td className="p-4 whitespace-nowrap text-slate-600">
                        {formatTimestamp(req.createdAt)}
                      </td>
                      <td className="p-4 font-medium text-indigo-600">
                        {req.RAN}
                        {isServiceable === false && (
                          <span title={`Pincode ${req.customer?.zip} is not serviceable by Blue Dart`} className="ml-2 inline-flex items-center justify-center w-4 h-4 bg-yellow-400 text-yellow-900 rounded-full text-[10px] font-bold cursor-help">!</span>
                        )}
                      </td>
                      <td className="p-4 text-slate-800 font-medium">{req.orderId}</td>
                      <td className="p-4 text-slate-500 font-mono text-xs">{req.awb || '-'}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-12 bg-slate-100 rounded overflow-hidden border border-slate-200 shrink-0">
                            {req.items[0]?.productImage ? (
                              <img src={req.items[0].productImage} alt="Product" className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex items-center justify-center h-full text-slate-300">
                                <Package className="w-5 h-5"/>
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-slate-500">
                            {req.items.length} item{req.items.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="p-4"><ReturnStatusBadge status={req.status} /></td>
                      <td className="p-4"><ShipmentStatusBadge status={req.shipmentStatus} /></td>
                      <td className="p-4">
                        <div 
                          className="text-[9px] leading-tight font-medium text-slate-500 uppercase tracking-wide max-w-[150px] truncate" 
                          title={req.courierStatus || 'Waiting for sync'}
                        >
                          {req.courierStatus || '-'}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          {formatRefundType(req.requestedMethod)}
                        </span>
                      </td>
                      <td className="p-4"><RefundStatusBadge status={req.refundStatus} method={req.requestedMethod} /></td>
                      <td className="p-4">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/returns/${req.id}`);
                          }}
                          className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {!loading && filteredData.length > 0 && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-4">
              <span>Showing {startIndex + 1} to {Math.min(endIndex, filteredData.length)} of {filteredData.length} results</span>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span><span>Completed: {counts.completed}</span>
                <span className="w-2 h-2 bg-emerald-500 rounded-full ml-2"></span><span>Received: {counts.received}</span>
                <span className="w-2 h-2 bg-yellow-500 rounded-full ml-2"></span><span>Active: {counts.active}</span>
                <span className="w-2 h-2 bg-orange-500 rounded-full ml-2"></span><span>Rejected: {counts.rejected}</span>
                <span className="w-2 h-2 bg-red-500 rounded-full ml-2"></span><span>Failed: {counts.failed}</span>
              </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousPage}
                disabled={currentPage === 1}
                className={`p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  currentPage === 1 ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNumber;
                  if (totalPages <= 7) {
                    pageNumber = i + 1;
                  } else if (currentPage <= 4) {
                    pageNumber = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    pageNumber = totalPages - 6 + i;
                  } else {
                    pageNumber = currentPage - 3 + i;
                  }
                  
                  return (
                    <button
                      key={i}
                      onClick={() => goToPage(pageNumber)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                        currentPage === pageNumber
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
                
                {totalPages > 7 && currentPage < totalPages - 3 && (
                  <span className="px-2 text-slate-400">...</span>
                )}
                {totalPages > 7 && currentPage < totalPages - 2 && (
                  <button
                    onClick={() => goToPage(totalPages)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === totalPages
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {totalPages}
                  </button>
                )}
              </div>
              
              <button
                onClick={goToNextPage}
                disabled={currentPage === totalPages}
                className={`p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  currentPage === totalPages ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Badge Components ---
const ReturnStatusBadge = ({ status }: { status: string }) => {
  const config: Record<string, { color: string; bg: string }> = {
    'open': { color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
    'pending': { color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
    'approved': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    'denied': { color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
    'closed': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
    'completed': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' }
  };
  const style = config[status?.toLowerCase()] || config.pending;
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${style.color} ${style.bg}`}>
      {status || 'Pending'}
    </span>
  );
};

const ShipmentStatusBadge = ({ status }: { status?: string }) => {
  if (!status) return <span className="text-xs text-slate-400">-</span>;
  const config: Record<string, { color: string; bg: string }> = {
    'pickup created': { color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
    'pickup scheduled': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    'in transit': { color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
    'pickup exception': { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
    'self ship requested': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    'product reached': { color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' },
    'received': { color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
    'pickup cancelled': { color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
    'failed': { color: 'text-red-700', bg: 'bg-red-50 border-red-200' }
  };
  const style = config[status?.toLowerCase()] || { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${style.color} ${style.bg}`}>
      {status}
    </span>
  );
};

const RefundStatusBadge = ({ status }: { status?: string; method?: string }) => {
  if (!status) return <span className="text-xs text-slate-400">-</span>;
  const config: Record<string, { color: string; bg: string }> = {
    'pending': { color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
    'processing': { color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
    'refunded': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
    'failed': { color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
    'not eligible': { color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
    'skipped': { color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' }
  };
  const style = config[status?.toLowerCase()] || config.pending;
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${style.color} ${style.bg} flex w-fit items-center`}>
      <span>{status}</span>
    </span>
  );
};

const TabButton = ({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`
      flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap
      ${active 
        ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50' 
        : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'}
    `}
  >
    {label}
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
      {count}
    </span>
  </button>
);

const formatTimestamp = (timestamp: any) => {
  if (!timestamp) return '-';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-GB', { 
      day: '2-digit', month: 'short', year: 'numeric'
    });
  } catch (e) {
    return '-';
  }
};