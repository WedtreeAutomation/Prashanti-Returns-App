import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Download,
  Package,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  DollarSign,
  Clock,
  Users
} from 'lucide-react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { ReturnRequest, ResolutionData, ReasonData, CustomerReturnData, ProductReturnData, StateReturnData } from '../../Interfaces/types';

// ==========================================
// HELPER FUNCTIONS
// ==========================================
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace('₹', '₹ ');
};

const formatNumber = (num: number): string => {
  return new Intl.NumberFormat('en-IN').format(num);
};

const calculatePercentage = (value: number, total: number): number => {
  if (total === 0) return 0;
  return (value / total) * 100;
};

const getReasonLabel = (reason: string): string => {
  const reasonMap: Record<string, string> = {
    'I received a defective item': 'Defective Item',
    'Wrong item shipped': 'Wrong Item',
    'Color mismatch': 'Color Mismatch',
    'Product quality issue': 'Quality Issue',
    'Delivery was delayed': 'Delivery Delay',
    'Other reason': 'Other',
    'product quality reason': 'Quality Issue',
    'color mismatch': 'Color Mismatch',
    'other reason': 'Other',
    'received a defective item': 'Defective Item',
    'wrong item shipped': 'Wrong Item',
    'delivery was delayed': 'Delivery Delay',
  };
  return reasonMap[reason] || reason;
};

// ==========================================
// METRIC CARD COMPONENT
// ==========================================
const MetricCard = ({ 
  title, 
  value, 
  trend, 
  trendValue, 
  icon, 
  color = 'blue',
  isLoading = false 
}: { 
  title: string; 
  value: string | number; 
  trend?: 'up' | 'down'; 
  trendValue?: string;
  icon: React.ReactNode;
  color?: 'blue' | 'purple' | 'orange' | 'emerald' | 'pink' | 'indigo' | 'amber';
  isLoading?: boolean;
}) => {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-pink-500',
    emerald: 'from-emerald-500 to-green-500',
    pink: 'from-pink-500 to-rose-500',
    indigo: 'from-indigo-500 to-purple-500',
    amber: 'from-amber-500 to-orange-500',
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm animate-pulse">
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <div className="h-4 bg-slate-200 rounded w-24"></div>
            <div className="h-8 bg-slate-200 rounded w-32"></div>
            <div className="h-4 bg-slate-200 rounded w-20"></div>
          </div>
          <div className="w-12 h-12 bg-slate-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group">
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${colorClasses[color]} rounded-full blur-3xl opacity-10 -mr-10 -mt-10 group-hover:opacity-20 transition-opacity`}></div>
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
            <p className="text-3xl font-bold text-slate-900">{value}</p>
            {trend && trendValue && (
              <div className="flex items-center gap-1 mt-2">
                {trend === 'up' ? (
                  <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-500" />
                )}
                <span className={`text-xs font-medium ${trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {trendValue}
                </span>
              </div>
            )}
          </div>
          <div className={`p-3 rounded-xl bg-gradient-to-br ${colorClasses[color]} bg-opacity-10 text-white`}>
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// PROGRESS BAR COMPONENT
// ==========================================
const ProgressBar = ({ 
  label, 
  value, 
  percentage, 
  color = 'blue',
  showValue = true 
}: { 
  label: string; 
  value: number; 
  percentage: number;
  color?: 'blue' | 'purple' | 'orange' | 'emerald' | 'pink' | 'indigo' | 'amber';
  showValue?: boolean;
}) => {
  const colorClasses = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
    emerald: 'bg-emerald-500',
    pink: 'bg-pink-500',
    indigo: 'bg-indigo-500',
    amber: 'bg-amber-500',
  };

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-sm">
        <span className="text-slate-600">{label}</span>
        {showValue && (
          <span className="font-medium text-slate-900">
            {typeof value === 'number' && value % 1 === 0 ? value : value.toFixed(1)} ({percentage.toFixed(1)}%)
          </span>
        )}
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div 
          className={`h-full ${colorClasses[color]} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
};

// ==========================================
// TABLE COMPONENT WITH SCROLLBAR
// ==========================================
const DataTable = ({ 
  headers, 
  data, 
  renderRow,
  emptyMessage = "No data available",
  maxHeight = "400px"
}: { 
  headers: string[]; 
  data: any[]; 
  renderRow: (item: any, index: number) => React.ReactNode;
  emptyMessage?: string;
  maxHeight?: string;
}) => {
  if (data.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Package className="w-8 h-8 text-slate-400" />
        </div>
        <p className="text-slate-500 font-medium">{emptyMessage}</p>
        <p className="text-sm text-slate-400 mt-1">You'll start getting insights as customers submit returns</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className={`max-h-[${maxHeight}] overflow-y-auto custom-scrollbar`}>
        <table className="w-full">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {headers.map((header, idx) => (
                <th key={idx} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((item, idx) => renderRow(item, idx))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ==========================================
// MAIN ANALYTICS COMPONENT
// ==========================================
export const Analytics = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [dateRange, setDateRange] = useState<'30days' | '90days' | 'year' | 'all'>('30days');

  // Fetch data
  const fetchData = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const q = query(collection(db, "returns"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      
      const fetchedReturns = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReturnRequest[];

      setReturns(fetchedReturns);
    } catch (error) {
      console.error("Error fetching analytics data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter returns by date range
  const filteredReturns = useMemo(() => {
    if (dateRange === 'all') return returns;

    const now = new Date();
    const cutoffDate = new Date();
    
    if (dateRange === '30days') cutoffDate.setDate(now.getDate() - 30);
    if (dateRange === '90days') cutoffDate.setDate(now.getDate() - 90);
    if (dateRange === 'year') cutoffDate.setFullYear(now.getFullYear() - 1);

    return returns.filter(r => {
      if (!r.createdAt) return false;
      const createdDate = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
      return createdDate >= cutoffDate;
    });
  }, [returns, dateRange]);

  // ==========================================
  // KPI CALCULATIONS
  // ==========================================
  const kpis = useMemo(() => {
    const totalReturns = filteredReturns.length;
    
    // Total exchanges (if you have an exchange type)
    const totalExchanges = filteredReturns.filter(r => (r as any).type?.toLowerCase() === 'exchange').length;
    
    // Total Refund Value
    let totalRefundValue = 0;
    filteredReturns.forEach(r => {
      const amount = r.refundAmount || r.refundDetails?.finalAmount || 0;
      totalRefundValue += amount;
    });
    
    const returnValuePerOrder = totalReturns > 0 ? totalRefundValue / totalReturns : 0;
    
    // Revenue saved - sum of store credits and gift cards (non-cash refunds)
    let revenueSaved = 0;
    filteredReturns.forEach(r => {
      if (r.requestedMethod === 'store_credit' || r.requestedMethod === 'gift_card') {
        const amount = r.refundAmount || r.refundDetails?.finalAmount || 0;
        revenueSaved += amount;
      }
    });

    // Unique Customers
    const uniqueCustomers = new Set(filteredReturns.map(r => r.customer.email)).size;

    // Average Processing Time (in days)
    let totalProcessingDays = 0;
    let completedCount = 0;
    filteredReturns.forEach(r => {
      if (r.createdAt && (r.completedAt || r.refundedAt)) {
        const created = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        const completed = r.completedAt?.toDate ? r.completedAt.toDate() : 
                         r.refundedAt?.toDate ? r.refundedAt.toDate() : new Date();
        const days = Math.ceil((completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        totalProcessingDays += days;
        completedCount++;
      }
    });
    const avgProcessingTime = completedCount > 0 ? Math.round(totalProcessingDays / completedCount) : 0;

    // Return Rate (% of total orders) - Placeholder
    const returnRate = totalReturns > 0 ? Math.min(totalReturns / 100, 15) : 0;

    return {
      totalReturns,
      totalExchanges,
      totalRefundValue,
      returnValuePerOrder,
      revenueSaved,
      uniqueCustomers,
      avgProcessingTime,
      returnRate
    };
  }, [filteredReturns]);

  // ==========================================
  // RESOLUTION BREAKDOWN
  // ==========================================
  const resolutionData = useMemo(() => {
    const resolutions: ResolutionData[] = [
      { type: 'Refund to Original Payment', count: 0, percentage: 0, totalValue: 0 },
      { type: 'Store Credit', count: 0, percentage: 0, totalValue: 0 },
      { type: 'Gift Card', count: 0, percentage: 0, totalValue: 0 },
      { type: 'Exchange (Same Item)', count: 0, percentage: 0, totalValue: 0 },
      { type: 'Exchange (Different Item)', count: 0, percentage: 0, totalValue: 0 },
    ];

    let totalResolutions = 0;

    filteredReturns.forEach(r => {
      const amount = r.refundAmount || r.refundDetails?.finalAmount || 0;
      totalResolutions++;

      if (r.requestedMethod === 'refund' || !r.requestedMethod) {
        resolutions[0].count++;
        resolutions[0].totalValue += amount;
      } else if (r.requestedMethod === 'store_credit') {
        resolutions[1].count++;
        resolutions[1].totalValue += amount;
      } else if (r.requestedMethod === 'gift_card') {
        resolutions[2].count++;
        resolutions[2].totalValue += amount;
      }
    });

    // Calculate percentages
    resolutions.forEach(r => {
      r.percentage = calculatePercentage(r.count, totalResolutions);
    });

    return resolutions;
  }, [filteredReturns]);

  // ==========================================
  // TOP RETURN REASONS
  // ==========================================
  const topReasons = useMemo(() => {
    const reasonMap = new Map<string, { count: number; value: number }>();
    let totalReasons = 0;

    filteredReturns.forEach(ret => {
      ret.items.forEach(item => {
        if ((item as any).reason) {
          const reason = getReasonLabel((item as any).reason);
          const current = reasonMap.get(reason) || { count: 0, value: 0 };
          const price = parseFloat((item.price || '0').replace(/[^0-9.]/g, '')) || 0;
          const itemValue = price * item.quantityReturned;
          
          reasonMap.set(reason, {
            count: current.count + 1,
            value: current.value + itemValue
          });
          totalReasons++;
        }
      });
    });

    const reasons: ReasonData[] = Array.from(reasonMap.entries())
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        percentage: calculatePercentage(data.count, totalReasons),
        totalValue: data.value
      }))
      .sort((a, b) => b.count - a.count);

    return reasons;
  }, [filteredReturns]);

  // ==========================================
  // MOST RETURNED PRODUCTS
  // ==========================================
  const mostReturnedProducts = useMemo(() => {
    const productMap = new Map<string, ProductReturnData>();

    filteredReturns.forEach(ret => {
      ret.items.forEach(item => {
        const variantId = (item as any).sku || `variant-${(item as any).lineItemId || Math.random()}`;
        const price = parseFloat((item.price || '0').replace(/[^0-9.]/g, '')) || 0;
        const itemValue = price * item.quantityReturned;

        const existing = productMap.get(variantId);
        
        if (existing) {
          existing.returnCount += item.quantityReturned;
          existing.totalQuantity += item.quantityReturned;
          existing.totalValue += itemValue;
          
          if ((item as any).reason) {
            const reason = getReasonLabel((item as any).reason);
            existing.reasons[reason] = (existing.reasons[reason] || 0) + 1;
          }
        } else {
          productMap.set(variantId, {
            variantId,
            title: item.title,
            sku: (item as any).sku || 'N/A',
            price,
            image: (item as any).productImage,
            returnCount: item.quantityReturned,
            totalQuantity: item.quantityReturned,
            totalValue: itemValue,
            reasons: (item as any).reason ? { [getReasonLabel((item as any).reason)]: 1 } : {},
            returnRate: 0
          });
        }
      });
    });

    return Array.from(productMap.values())
      .sort((a, b) => b.returnCount - a.returnCount)
      .slice(0, 10);
  }, [filteredReturns]);

  // ==========================================
  // CUSTOMERS THAT RETURN THE MOST
  // ==========================================
  const topReturningCustomers = useMemo(() => {
    const customerMap = new Map<string, CustomerReturnData>();

    filteredReturns.forEach(ret => {
      const customerId = ret.customer.email || `cust-${ret.customer.name}`;
      const existing = customerMap.get(customerId);
      const amount = ret.refundAmount || ret.refundDetails?.finalAmount || 0;

      if (existing) {
        existing.returnCount++;
        existing.totalValue += amount;
      } else {
        customerMap.set(customerId, {
          customerId,
          name: ret.customer.name || 'Unknown',
          email: ret.customer.email,
          returnCount: 1,
          totalValue: amount,
          phone: (ret.customer as any).phone
        });
      }
    });

    return Array.from(customerMap.values())
      .sort((a, b) => b.returnCount - a.returnCount)
      .slice(0, 10);
  }, [filteredReturns]);

  // ==========================================
  // RETURN RATE BY STATE/REGION
  // ==========================================
  const returnsByState = useMemo(() => {
    const stateMap = new Map<string, StateReturnData>();

    filteredReturns.forEach(ret => {
      const state = (ret.customer as any).state || 'Unknown';
      
      const existing = stateMap.get(state) || {
        state,
        returnCount: 0,
        totalValue: 0,
        uniqueCustomers: 0
      };

      const amount = ret.refundAmount || ret.refundDetails?.finalAmount || 0;
      
      stateMap.set(state, {
        ...existing,
        returnCount: existing.returnCount + 1,
        totalValue: existing.totalValue + amount
      });
    });

    return Array.from(stateMap.values())
      .sort((a, b) => b.returnCount - a.returnCount);
  }, [filteredReturns]);

  // Handle export
  const handleExport = () => {
    const csvData = [
      ['Metric', 'Value'],
      ['Total Returns', kpis.totalReturns],
      ['Total Exchanges', kpis.totalExchanges],
      ['Total Refund Value', kpis.totalRefundValue],
      ['Return Value Per Order', kpis.returnValuePerOrder],
      ['Revenue Saved', kpis.revenueSaved],
      ['Unique Customers', kpis.uniqueCustomers],
      ['Avg Processing Time (days)', kpis.avgProcessingTime],
      ['Return Rate', `${kpis.returnRate.toFixed(1)}%`],
      [],
      ['Top Return Reasons'],
      ...topReasons.map(r => [r.reason, r.count, `${r.percentage.toFixed(1)}%`, formatCurrency(r.totalValue)]),
      [],
      ['Most Returned Products'],
      ...mostReturnedProducts.map(p => [p.title, p.sku, p.returnCount, formatCurrency(p.totalValue)]),
      [],
      ['Returns by State'],
      ...returnsByState.map(s => [s.state, s.returnCount, formatCurrency(s.totalValue)]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-8 animate-pulse">
            <div>
              <div className="h-8 bg-slate-200 rounded w-48 mb-2"></div>
              <div className="h-4 bg-slate-200 rounded w-64"></div>
            </div>
            <div className="h-10 bg-slate-200 rounded w-32"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse">
                <div className="space-y-3">
                  <div className="h-4 bg-slate-200 rounded w-24"></div>
                  <div className="h-8 bg-slate-200 rounded w-32"></div>
                  <div className="h-4 bg-slate-200 rounded w-20"></div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 h-80 animate-pulse">
                <div className="h-6 bg-slate-200 rounded w-48 mb-4"></div>
                <div className="space-y-3">
                  {[...Array(5)].map((_, j) => (
                    <div key={j} className="h-4 bg-slate-200 rounded w-full"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Analytics</h1>
            <p className="text-sm text-slate-500 mt-1">
              Insights to help you reduce returns and improve profits
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as any)}
                className="appearance-none bg-white border border-slate-200 rounded-xl px-4 py-2 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
                <option value="year">Last Year</option>
                <option value="all">All Time</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>

            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              Download Report
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <MetricCard
            title="Total Returns"
            value={formatNumber(kpis.totalReturns)}
            trend={kpis.totalReturns > 0 ? 'up' : undefined}
            trendValue={`${kpis.totalExchanges} exchanges`}
            icon={<Package className="w-6 h-6" />}
            color="blue"
          />
          <MetricCard
            title="Total Refund Value"
            value={formatCurrency(kpis.totalRefundValue)}
            icon={<DollarSign className="w-6 h-6" />}
            color="emerald"
          />
          <MetricCard
            title="Unique Customers"
            value={formatNumber(kpis.uniqueCustomers)}
            trend="up"
            trendValue={`${((kpis.uniqueCustomers / kpis.totalReturns) * 100 || 0).toFixed(0)}% of returns`}
            icon={<Users className="w-6 h-6" />}
            color="purple"
          />
          <MetricCard
            title="Avg Processing Time"
            value={`${kpis.avgProcessingTime} days`}
            trend={kpis.avgProcessingTime > 3 ? 'down' : 'up'}
            trendValue={kpis.avgProcessingTime > 3 ? 'Needs improvement' : 'On track'}
            icon={<Clock className="w-6 h-6" />}
            color="amber"
          />
        </div>

        {/* Revenue Saved & Resolution Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Saved Card */}
          <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-xl">
            <h3 className="text-sm font-medium opacity-80 mb-2">Revenue Saved</h3>
            <p className="text-4xl font-bold mb-4">{formatCurrency(kpis.revenueSaved)}</p>
            <p className="text-sm opacity-90 mb-4">Overall (Non-cash refunds)</p>
            
            <div className="space-y-3">
              {resolutionData.map((res, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="opacity-90">{res.type}</span>
                    <span className="font-medium">{res.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-white rounded-full"
                      style={{ width: `${res.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Return Reasons */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm lg:col-span-2">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Top Return Reasons</h3>
            <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
              {topReasons.slice(0, 6).map((reason, idx) => (
                <ProgressBar
                  key={idx}
                  label={reason.reason}
                  value={reason.count}
                  percentage={reason.percentage}
                  color={idx === 0 ? 'blue' : idx === 1 ? 'purple' : idx === 2 ? 'orange' : 'pink'}
                />
              ))}
            </div>
            
            {topReasons.length === 0 && (
              <div className="text-center py-8">
                <p className="text-slate-500">No return reason data available</p>
              </div>
            )}
          </div>
        </div>

        {/* Most Returned Products Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Most Returned Products</h3>
            <p className="text-sm text-slate-500 mt-1">Last {dateRange === '30days' ? '30 days' : dateRange === '90days' ? '90 days' : dateRange === 'year' ? 'year' : 'all time'}</p>
          </div>
          
          <DataTable
            headers={['Product Variant', 'SKU', 'No. of Returns', 'Return Rate', 'Return Value', 'Top Reasons']}
            data={mostReturnedProducts}
            maxHeight="400px"
            renderRow={(product, idx) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {product.image ? (
                      <img src={product.image} alt={product.title} className="w-10 h-12 object-cover rounded-lg border border-slate-200" />
                    ) : (
                      <div className="w-10 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-slate-400" />
                      </div>
                    )}
                    <span className="text-sm font-medium text-slate-800 line-clamp-2">{product.title}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm font-mono text-slate-600">{product.sku}</td>
                <td className="py-3 px-4 text-sm font-semibold text-slate-900">{product.returnCount}</td>
                <td className="py-3 px-4 text-sm text-slate-600">{((product.returnCount / kpis.totalReturns) * 100 || 0).toFixed(1)}%</td>
                <td className="py-3 px-4 text-sm font-semibold text-emerald-600">{formatCurrency(product.totalValue)}</td>
                <td className="py-3 px-4 text-sm text-slate-600">
                  {Object.keys(product.reasons).slice(0, 2).join(', ') || 'NA'}
                </td>
              </tr>
            )}
            emptyMessage="No product return data available"
          />
        </div>

        {/* Customers That Return The Most & Return Rate By Region */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Customers Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Customers That Return The Most</h3>
            </div>
            
            <DataTable
              headers={['Customer', 'Returns', 'Return Value']}
              data={topReturningCustomers}
              maxHeight="400px"
              renderRow={(customer, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{customer.name}</p>
                      <p className="text-xs text-slate-500">{customer.email}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm font-semibold text-slate-900">{customer.returnCount}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-emerald-600">{formatCurrency(customer.totalValue)}</td>
                </tr>
              )}
              emptyMessage="No customer return data available"
            />
          </div>

          {/* Return Rate By Region */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Return Rate By Region</h3>
            </div>
            
            <DataTable
              headers={['State', 'Returns', 'Return Value']}
              data={returnsByState}
              maxHeight="400px"
              renderRow={(state, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-slate-800">{state.state}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-slate-900">{state.returnCount}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-emerald-600">{formatCurrency(state.totalValue)}</td>
                </tr>
              )}
              emptyMessage="No regional data available"
            />
          </div>
        </div>

        {/* Return Rate Card */}
        {kpis.totalReturns > 0 && (
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-blue-900">Return Rate Analysis</h3>
                <p className="text-sm text-blue-700 mt-1">Based on your current return volume</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-blue-900">{((kpis.totalReturns / 100) * 100).toFixed(1)}%</p>
                <p className="text-xs text-blue-700 mt-1">of total orders (estimated)</p>
              </div>
            </div>
            <div className="mt-4 w-full h-2 bg-blue-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 rounded-full"
                style={{ width: `${Math.min((kpis.totalReturns / 100) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer note */}
        {filteredReturns.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
            <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-amber-800 mb-2">No Data Available</h3>
            <p className="text-amber-700">
              You'll start getting interesting insights as customers start submitting returns.
            </p>
          </div>
        )}
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
};