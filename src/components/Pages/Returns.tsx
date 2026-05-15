import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Download, 
  ChevronDown, 
  Package,
  RefreshCw
} from 'lucide-react';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';

// Comprehensive interface with all three statuses
interface ReturnRequest {
  id: string;
  RAN: string;
  orderId: string;
  orderNumericId?: number;
  awb?: string;
  type: string;
  
  // 1️⃣ Return Status - Overall request state
  status: 'Open' | 'Approved' | 'Denied' | 'Closed' | 'Completed' | 'Pending';
  
  // 2️⃣ Shipment Status - Reverse logistics tracking
  shipmentStatus?: 'Not Created' | 'Pickup Created' | 'Pickup Scheduled' | 'In Transit' | 'Delivered' | 'Received' | 'Pickup Cancelled' | 'Failed';
  
  // 3️⃣ Refund Status - Money flow tracking
  refundStatus?: 'Pending' | 'Processing' | 'Refunded' | 'Failed' | 'Not Eligible' | 'Skipped';
  
  items: {
    title: string;
    productImage: string;
    reason: string;
    quantityReturned: number;
    price?: string;
  }[];
  
  requestedMethod?: 'refund' | 'gift_card' | 'store_credit';
  createdAt: any;
  completedAt?: any;
  refundedAt?: any;
  
  // Additional tracking fields
  itemCondition?: 'Fresh' | 'Seconds' | 'Defect / Damaged Item';
  isRestocked?: boolean;
}

export const Returns = () => {
  const navigate = useNavigate();
  
  // State
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Filter States - Added 'rejected' to activeTab
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'active' | 'completed' | 'rejected' | 'failed'>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [shipmentFilter, setShipmentFilter] = useState<string>('all');
  const [refundFilter, setRefundFilter] = useState<string>('all');

  // Fetch Data with Refresh Capability
  const fetchReturns = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    
    try {
      const q = query(collection(db, "returns"), orderBy("createdAt", "desc"), limit(100));
      const snapshot = await getDocs(q);
      
      const fetchedData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReturnRequest[];

      setReturns(fetchedData);
    } catch (error) {
      console.error("Error fetching returns:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, []);

  // Status Helper Functions
  const isStatusOpen = (r: ReturnRequest) => {
    const s = r.status?.toLowerCase();
    const shipStatus = r.shipmentStatus?.toLowerCase();

    // 1. General status must be open/pending/approved
    const hasOpenStatus = s === 'open' || s === 'pending' || s === 'approved';

    // 2. Shipment must NOT have started yet
    // We check for 'not created' or null/undefined
    const shipmentNotStarted = !shipStatus || shipStatus === 'not created';

    return hasOpenStatus && shipmentNotStarted;
  };

  const isShipmentActive = (r: ReturnRequest) => {
    const shipStatus = r.shipmentStatus?.toLowerCase();
    return shipStatus === 'pickup created' || 
           shipStatus === 'pickup scheduled' || 
           shipStatus === 'in transit';
  };

  const isCompleted = (r: ReturnRequest) => {
    return r.status?.toLowerCase() === 'completed' || 
           (r.shipmentStatus?.toLowerCase() === 'delivered' && 
            r.refundStatus?.toLowerCase() === 'refunded');
  };

  // NEW: Check if request is rejected (Denied or Closed)
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

  // Filtering Logic
  const filteredData = useMemo(() => {
    let filtered = returns;

    // Tab Filter
    if (activeTab === 'open') {
      filtered = filtered.filter(isStatusOpen);
    } else if (activeTab === 'active') {
      filtered = filtered.filter(r => isShipmentActive(r) && !isCompleted(r));
    } else if (activeTab === 'completed') {
      filtered = filtered.filter(isCompleted);
    } else if (activeTab === 'rejected') {
      filtered = filtered.filter(isRejected);
    } else if (activeTab === 'failed') {
      filtered = filtered.filter(isFailed);
    }

    // Search Filter
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      filtered = filtered.filter(r => 
        r.RAN?.toLowerCase().includes(lower) || 
        r.orderId?.toLowerCase().includes(lower) ||
        r.awb?.toLowerCase().includes(lower)
      );
    }

    // Shipment Status Filter
    if (shipmentFilter !== 'all') {
      filtered = filtered.filter(r => 
        r.shipmentStatus?.toLowerCase() === shipmentFilter.toLowerCase()
      );
    }

    // Refund Status Filter
    if (refundFilter !== 'all') {
      filtered = filtered.filter(r => 
        r.refundStatus?.toLowerCase() === refundFilter.toLowerCase()
      );
    }

    // Date Range Filter
    if (dateFilter !== 'all') {
      const cutoffDate = new Date();
      if (dateFilter === '7days') cutoffDate.setDate(cutoffDate.getDate() - 7);
      if (dateFilter === '30days') cutoffDate.setDate(cutoffDate.getDate() - 30);
      if (dateFilter === '90days') cutoffDate.setDate(cutoffDate.getDate() - 90);
      
      filtered = filtered.filter(r => {
        if (!r.createdAt) return false;
        const itemDate = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        return itemDate >= cutoffDate;
      });
    }

    return filtered;
  }, [returns, activeTab, searchTerm, dateFilter, shipmentFilter, refundFilter]);

  // Counts - Added rejected count
  const counts = useMemo(() => ({
    all: returns.length,
    open: returns.filter(isStatusOpen).length,
    active: returns.filter(r => isShipmentActive(r) && !isCompleted(r)).length,
    completed: returns.filter(isCompleted).length,
    rejected: returns.filter(isRejected).length,
    failed: returns.filter(isFailed).length,
  }), [returns]);

  const hasActiveFilters = searchTerm !== '' || dateFilter !== 'all' || shipmentFilter !== 'all' || refundFilter !== 'all';

  const handleClearAll = () => {
    setSearchTerm('');
    setDateFilter('all');
    setShipmentFilter('all');
    setRefundFilter('all');
  };

  const handleRefresh = () => {
    fetchReturns(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      
      {/* Header with Refresh */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Returns & Exchanges</h1>
          <p className="text-slate-500 text-sm mt-1">Track and manage all return requests</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        
        {/* Tabs with Counts - Added Rejected tab before Failed/Cancelled */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          <TabButton 
            label="All Requests" 
            count={counts.all} 
            active={activeTab === 'all'} 
            onClick={() => setActiveTab('all')} 
          />
          <TabButton 
            label="OPEN" 
            count={counts.open} 
            active={activeTab === 'open'} 
            onClick={() => setActiveTab('open')} 
          />
          <TabButton 
            label="Active Shipments" 
            count={counts.active} 
            active={activeTab === 'active'} 
            onClick={() => setActiveTab('active')} 
          />
          <TabButton 
            label="Completed" 
            count={counts.completed} 
            active={activeTab === 'completed'} 
            onClick={() => setActiveTab('completed')} 
          />
          <TabButton 
            label="Rejected" 
            count={counts.rejected} 
            active={activeTab === 'rejected'} 
            onClick={() => setActiveTab('rejected')} 
          />
          <TabButton 
            label="Failed/Cancelled" 
            count={counts.failed} 
            active={activeTab === 'failed'} 
            onClick={() => setActiveTab('failed')} 
          />
        </div>

        {/* Advanced Filter Toolbar */}
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
          
          {/* Date Range Dropdown */}
          <div className="relative group">
            <select 
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
            >
              <option value="all">All Dates</option>
              <option value="7days">Last 7 days</option>
              <option value="30days">Last 30 days</option>
              <option value="90days">Last 90 days</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>

          {/* Shipment Status Filter */}
          <div className="relative group">
            <select 
              value={shipmentFilter}
              onChange={(e) => setShipmentFilter(e.target.value)}
              className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
            >
              <option value="all">All Shipments</option>
              <option value="pickup created">Pickup Created</option>
              <option value="in transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="received">Received</option>
              <option value="pickup cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>

          {/* Refund Status Filter */}
          <div className="relative group">
            <select 
              value={refundFilter}
              onChange={(e) => setRefundFilter(e.target.value)}
              className="appearance-none flex items-center gap-2 pr-8 pl-3 py-2 border border-slate-300 bg-white text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 focus:outline-none focus:border-indigo-400 cursor-pointer"
            >
              <option value="all">All Refunds</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
              <option value="not eligible">Not Eligible</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>
          
          {/* Clear All Button */}
          {hasActiveFilters && (
            <button 
              onClick={handleClearAll}
              className="text-sm text-indigo-600 font-medium hover:underline cursor-pointer transition-all"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Enhanced Table with All Three Statuses */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="p-4 w-10"><input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /></th>
                <th className="p-4">Date</th>
                <th className="p-4">RAN</th>
                <th className="p-4">Order ID</th>
                <th className="p-4">AWB</th>
                <th className="p-4">Product</th>
                <th className="p-4">Reason</th>
                <th className="p-4">Return Status</th>
                <th className="p-4">Shipment Status</th>
                <th className="p-4">Refund Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-12 text-center text-slate-500">
                    <div className="flex justify-center items-center gap-2">
                      <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      Loading requests...
                    </div>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-12 text-center text-slate-500">
                    No return requests found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredData.map((req) => (
                  <tr 
                    key={req.id} 
                    onClick={() => navigate(`/returns/${req.id}`)}
                    className="hover:bg-slate-50 transition-colors group cursor-pointer"
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                    <td className="p-4 whitespace-nowrap text-slate-600">
                      {formatTimestamp(req.createdAt)}
                    </td>
                    <td className="p-4 font-medium text-indigo-600">
                      {req.RAN}
                    </td>
                    <td className="p-4 text-slate-800 font-medium">
                      {req.orderId}
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-xs">
                      {req.awb || '-'}
                    </td>
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
                    <td className="p-4 max-w-[150px]">
                      <span className="text-xs text-slate-600 truncate block" title={req.items[0]?.reason}>
                        {req.items[0]?.reason || 'N/A'}
                      </span>
                    </td>
                    <td className="p-4">
                      <ReturnStatusBadge status={req.status} />
                    </td>
                    <td className="p-4">
                      <ShipmentStatusBadge status={req.shipmentStatus} />
                    </td>
                    <td className="p-4">
                      <RefundStatusBadge status={req.refundStatus} method={req.requestedMethod} />
                    </td>
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
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer with Stats - Added rejected to stats */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span>Showing {filteredData.length} of {returns.length} results</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span>Completed: {counts.completed}</span>
              <span className="w-2 h-2 bg-yellow-500 rounded-full ml-2"></span>
              <span>Active: {counts.active}</span>
              <span className="w-2 h-2 bg-orange-500 rounded-full ml-2"></span>
              <span>Rejected: {counts.rejected}</span>
              <span className="w-2 h-2 bg-red-500 rounded-full ml-2"></span>
              <span>Failed: {counts.failed}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-slate-200 bg-white rounded hover:bg-slate-50 disabled:opacity-50" disabled>Previous</button>
            <button className="px-3 py-1 border border-slate-200 bg-white rounded hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Status Badge Components
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
    'delivered': { color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
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

const RefundStatusBadge = ({ status, method }: { status?: string; method?: string }) => {
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
  const methodLabel = method === 'gift_card' ? '🎁' : method === 'store_credit' ? '💳' : '💰';
  
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${style.color} ${style.bg} flex items-center gap-1`}>
      <span>{methodLabel}</span>
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
      day: '2-digit', 
      month: 'short', 
      year: 'numeric'
    });
  } catch (e) {
    return '-';
  }
};