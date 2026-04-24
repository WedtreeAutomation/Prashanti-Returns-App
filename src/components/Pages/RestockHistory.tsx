import { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { RestockRecord } from '../../Interfaces/api';
import { 
  RefreshCw, Search, Package, Calendar, Filter, 
  ChevronLeft, ChevronRight, Tag 
} from 'lucide-react';

export const RestockHistory = () => {
  const [history, setHistory] = useState<RestockRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [conditionFilter, setConditionFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const restockRef = collection(db, 'restock_history');
      const q = query(restockRef, orderBy('restockedAt', 'desc'));
      
      const querySnapshot = await getDocs(q);
      const historyData: RestockRecord[] = [];
      
      querySnapshot.forEach((doc) => {
        historyData.push({ id: doc.id, ...doc.data() } as RestockRecord);
      });
      
      setHistory(historyData);
    } catch (error) {
      console.error('Failed to fetch restock history:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to format date for the HTML date input comparison (YYYY-MM-DD)
  const toISODate = (dateObj: any) => {
    if (!dateObj) return '';
    const d = dateObj.toDate ? dateObj.toDate() : new Date(dateObj);
    return d.toISOString().split('T')[0];
  };

  // 1. Apply Filters
  const filteredHistory = history.filter(record => {
    // Search Filter
    const matchesSearch = 
      record.RAN.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.orderId.includes(searchTerm) ||
      record.items.some(item => item.sku?.toLowerCase().includes(searchTerm.toLowerCase()));

    // Condition Filter
    const matchesCondition = conditionFilter === 'All' || record.condition === conditionFilter;

    // Date Filter
    const matchesDate = !dateFilter || toISODate(record.restockedAt) === dateFilter;

    return matchesSearch && matchesCondition && matchesDate;
  });

  // 2. Apply Pagination
  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);
  const currentData = filteredHistory.slice(
    (currentPage - 1) * itemsPerPage, 
    currentPage * itemsPerPage
  );

  // Reset to page 1 if filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, conditionFilter, dateFilter]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getConditionColor = (condition: string) => {
    switch (condition?.toLowerCase()) {
      case 'fresh': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'seconds': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'defect / damaged item': return 'bg-red-50 text-red-700 border-red-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-100px)]">
        <RefreshCw className="w-8 h-8 text-pink-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Restock History</h1>
        <p className="text-sm text-slate-500 mt-1">Track items returned to Shopify inventory</p>
      </div>

      {/* Filters Section (Pink Theme) */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col md:flex-row gap-4">
        
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search RAN, Order, or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-shadow"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        </div>

        {/* Condition Filter */}
        <div className="relative w-full md:w-56">
          <select
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 bg-white"
          >
            <option value="All">All Conditions</option>
            <option value="Fresh">Fresh</option>
            <option value="Seconds">Seconds</option>
            <option value="Defect / Damaged Item">Defect / Damaged</option>
          </select>
          <Tag className="w-4 h-4 text-pink-500 absolute left-3 top-3" />
        </div>

        {/* Date Filter */}
        <div className="relative w-full md:w-48">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 text-slate-600"
          />
          <Filter className="w-4 h-4 text-pink-500 absolute left-3 top-3" />
        </div>

        {/* Clear Filters */}
        {(searchTerm || conditionFilter !== 'All' || dateFilter) && (
          <button 
            onClick={() => { setSearchTerm(''); setConditionFilter('All'); setDateFilter(''); }}
            className="px-4 py-2 text-sm font-medium text-pink-600 bg-pink-50 hover:bg-pink-100 rounded-lg transition-colors whitespace-nowrap"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Table Section */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold text-slate-700">Date</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Reference</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Items Restocked</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Condition</th>
                <th className="px-6 py-4 font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentData.length > 0 ? (
                currentData.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        {formatDate(record.restockedAt)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-pink-600">{record.RAN}</div>
                      <div className="text-xs text-slate-500 font-medium">Order: #{record.orderId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="w-4 h-4 text-slate-400" />
                        <span className="font-semibold text-slate-800">{record.totalQuantityRestocked} units</span>
                      </div>
                      <div className="text-xs text-slate-500 line-clamp-1 max-w-[200px]" title={record.items.map(i => i.sku).join(', ')}>
                        {record.items.map(i => `${i.sku || 'Unknown'} (x${i.quantityReturned})`).join(', ')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${getConditionColor(record.condition || 'Unknown')}`}>
                        {record.condition || 'Not Specified'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        record.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                        record.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Package className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">No restock records found</p>
                    <p className="text-sm text-slate-400 mt-1">Try adjusting your search or filters</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
            <p className="text-sm text-slate-500 font-medium">
              Showing <span className="text-slate-900 font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="text-slate-900 font-semibold">{Math.min(currentPage * itemsPerPage, filteredHistory.length)}</span> of <span className="text-slate-900 font-semibold">{filteredHistory.length}</span> results
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              {/* Page Numbers */}
              <div className="flex gap-1">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                      currentPage === i + 1 
                      ? 'bg-pink-600 text-white shadow-sm' 
                      : 'text-slate-600 hover:bg-pink-50 hover:text-pink-600'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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