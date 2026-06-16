import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Download, 
  ChevronDown, 
  Package,
  RefreshCw,
  CreditCard
} from 'lucide-react';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';

interface ReturnRequest {
  id: string;
  RAN: string;
  orderId: string;
  orderNumericId?: number;
  awb?: string;
  type: string;
  status: 'Open' | 'Approved' | 'Denied' | 'Closed' | 'Completed' | 'Pending';
  // Removed 'Delivered'
  shipmentStatus?: 'Not Created' | 'Pickup Created' | 'Pickup Scheduled' | 'In Transit' | 'Received' | 'Pickup Cancelled' | 'Failed';
  refundStatus?: 'Pending' | 'Processing' | 'Refunded' | 'Failed' | 'Not Eligible' | 'Skipped';
  items: {
    title: string;
    productImage: string;
    reason: string;
    quantityReturned: number;
    price?: string;
  }[];
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
  const [refreshing, setRefreshing] = useState(false);
  
  // Filter States
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'active' | 'received' | 'completed' | 'rejected' | 'failed'>('open');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [shipmentFilter, setShipmentFilter] = useState<string>('all');
  const [refundFilter, setRefundFilter] = useState<string>('all');
  const [refundTypeFilter, setRefundTypeFilter] = useState<string>('all');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

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
    const hasOpenStatus = s === 'open' || s === 'pending' || s === 'approved';
    const shipmentNotStarted = !shipStatus || shipStatus === 'not created';
    return hasOpenStatus && shipmentNotStarted;
  };

  const isShipmentActive = (r: ReturnRequest) => {
    const shipStatus = r.shipmentStatus?.toLowerCase();
    return shipStatus === 'pickup created' || 
           shipStatus === 'pickup scheduled' || 
           shipStatus === 'in transit';
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
           shipStatus === 'pickup cancelled' ||
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

    return returns.filter(r => {
      // Tab Filter
      if (activeTab === 'open' && !isStatusOpen(r)) return false;
      if (activeTab === 'active' && !isShipmentActive(r)) return false;
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
        const method = r.requestedMethod?.toLowerCase() || 'refund'; // 'refund' is original payment
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
  }, [returns, activeTab, searchTerm, dateFilter, shipmentFilter, refundFilter, refundTypeFilter, customStartDate, customEndDate]);

  // Counts
  const counts = useMemo(() => ({
    all: returns.length,
    open: returns.filter(isStatusOpen).length,
    active: returns.filter(isShipmentActive).length,
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
  
  const handleRefresh = () => fetchReturns(true);

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
  const showShipmentFilter = activeTab === 'all' || activeTab === 'failed';
  const showRefundStatusFilter = ['all', 'received', 'completed', 'failed'].includes(activeTab);
  const showRefundTypeFilter = ['all', 'received', 'completed', 'failed'].includes(activeTab);

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6">
      {/* Header */}
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
        
        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto custom-scrollbar">
          <TabButton label="All" count={counts.all} active={activeTab === 'all'} onClick={() => setActiveTab('all')} />
          <TabButton label="OPEN" count={counts.open} active={activeTab === 'open'} onClick={() => setActiveTab('open')} />
          <TabButton label="Active Shipments" count={counts.active} active={activeTab === 'active'} onClick={() => setActiveTab('active')} />
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
                <option value="in transit">In Transit</option>
                <option value="received">Received</option>
                <option value="pickup cancelled">Cancelled</option>
                <option value="failed">Failed</option>
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
                <th className="p-4">Refund Type</th>
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
                    <td className="p-4 font-medium text-indigo-600">{req.RAN}</td>
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
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer with Stats */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-4">
            <span>Showing {filteredData.length} of {returns.length} results</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span><span>Completed: {counts.completed}</span>
              <span className="w-2 h-2 bg-emerald-500 rounded-full ml-2"></span><span>Received: {counts.received}</span>
              <span className="w-2 h-2 bg-yellow-500 rounded-full ml-2"></span><span>Active: {counts.active}</span>
              <span className="w-2 h-2 bg-orange-500 rounded-full ml-2"></span><span>Rejected: {counts.rejected}</span>
              <span className="w-2 h-2 bg-red-500 rounded-full ml-2"></span><span>Failed: {counts.failed}</span>
            </div>
          </div>
        </div>
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
