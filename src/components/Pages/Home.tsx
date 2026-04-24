import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, 
  Clock,
  CheckCircle,
  XCircle,
  Truck,
  CreditCard,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Wallet,
  Gift
} from 'lucide-react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { Link } from 'react-router-dom';
import { ReturnRequest, RecentActivity, DashboardStats } from '../../Interfaces/types';

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace('₹', '₹ ');
};

const formatDate = (timestamp: any): string => {
  if (!timestamp) return 'N/A';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-IN', { 
      day: 'numeric', 
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return 'N/A';
  }
};

const getActivityIcon = (type: string) => {
  switch (type) {
    case 'return_submitted':
      return <Package className="w-4 h-4" />;
    case 'pickup_created':
      return <Truck className="w-4 h-4" />;
    case 'item_received':
      return <CheckCircle className="w-4 h-4" />;
    case 'refund_issued':
      return <CreditCard className="w-4 h-4" />;
    case 'return_rejected':
      return <XCircle className="w-4 h-4" />;
    case 'note_added':
      return <AlertCircle className="w-4 h-4" />;
    default:
      return <Clock className="w-4 h-4" />;
  }
};

const getActivityColor = (type: string) => {
  switch (type) {
    case 'return_submitted':
      return 'bg-blue-100 text-blue-600';
    case 'pickup_created':
      return 'bg-purple-100 text-purple-600';
    case 'item_received':
      return 'bg-emerald-100 text-emerald-600';
    case 'refund_issued':
      return 'bg-green-100 text-green-600';
    case 'return_rejected':
      return 'bg-red-100 text-red-600';
    case 'note_added':
      return 'bg-amber-100 text-amber-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

// ==========================================
// STAT CARD COMPONENT
// ==========================================
const StatCard = ({ 
  title, 
  value, 
  icon, 
  trend, 
  trendValue, 
  color = 'indigo',
  isLoading = false 
}: { 
  title: string; 
  value: string | number; 
  icon: React.ReactNode; 
  trend?: 'up' | 'down'; 
  trendValue?: string;
  color?: 'indigo' | 'pink' | 'emerald' | 'amber' | 'purple' | 'blue';
  isLoading?: boolean;
}) => {
  const colorClasses = {
    indigo: 'bg-indigo-50 text-indigo-600',
    pink: 'bg-pink-50 text-pink-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    blue: 'bg-blue-50 text-blue-600',
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:scale-[1.02]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-slate-900">{value}</p>
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              {trend === 'up' ? (
                <ArrowUp className="w-3 h-3 text-emerald-500" />
              ) : (
                <ArrowDown className="w-3 h-3 text-red-500" />
              )}
              <span className={`text-xs font-medium ${trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                {trendValue}
              </span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// ACTIVITY ITEM COMPONENT
// ==========================================
const ActivityItem = ({ activity }: { activity: RecentActivity }) => {
  const iconColor = getActivityColor(activity.type);
  
  return (
    <div className="flex items-start gap-4 py-3 px-2 hover:bg-slate-50 rounded-xl transition-colors group">
      <div className={`p-2.5 rounded-xl ${iconColor} shrink-0`}>
        {getActivityIcon(activity.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800 truncate">{activity.title}</p>
          <span className="text-xs text-slate-400 whitespace-nowrap">{formatDate(activity.timestamp)}</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{activity.description}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs font-mono text-indigo-600">{activity.RAN}</span>
          {activity.amount && (
            <>
              <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
              <span className="text-xs font-medium text-emerald-600">{formatCurrency(activity.amount)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN HOME COMPONENT
// ==========================================
export const Home = () => {
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);

  // Fetch data from Firebase
  const fetchData = async () => {
    try {
      // Fetch returns
      const q = query(collection(db, "returns"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      
      const fetchedReturns = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ReturnRequest[];

      setReturns(fetchedReturns);

      // Generate recent activities - ONLY TODAY'S ACTIVITIES
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const activities: RecentActivity[] = [];

      fetchedReturns.forEach(ret => {
        // Return submitted activity (only if created today)
        if (ret.createdAt) {
          const createdDate = ret.createdAt.toDate ? ret.createdAt.toDate() : new Date(ret.createdAt);
          if (createdDate >= today && createdDate < tomorrow) {
            activities.push({
              id: `${ret.id}-submitted`,
              RAN: ret.RAN,
              orderId: ret.orderId,
              type: 'return_submitted',
              title: 'Return Request Submitted',
              description: `${ret.items?.length || 0} item(s) - ${ret.customer?.name || 'Customer'}`,
              timestamp: ret.createdAt,
              amount: ret.refundAmount || ret.refundDetails?.finalAmount
            });
          }
        }

        // Item received activity
        if (ret.receivedAt) {
          const receivedDate = ret.receivedAt.toDate ? ret.receivedAt.toDate() : new Date(ret.receivedAt);
          if (receivedDate >= today && receivedDate < tomorrow) {
            activities.push({
              id: `${ret.id}-received`,
              RAN: ret.RAN,
              orderId: ret.orderId,
              type: 'item_received',
              title: 'Items Received',
              description: `${ret.items?.length || 0} item(s) received at warehouse`,
              timestamp: ret.receivedAt,
              amount: ret.refundAmount || ret.refundDetails?.finalAmount
            });
          }
        }

        // Refund issued activity
        if (ret.refundedAt || (ret.refundStatus === 'Refunded' && ret.completedAt)) {
          const refundDate = (ret.refundedAt || ret.completedAt).toDate ? 
            (ret.refundedAt || ret.completedAt).toDate() : 
            new Date(ret.refundedAt || ret.completedAt);
          if (refundDate >= today && refundDate < tomorrow) {
            activities.push({
              id: `${ret.id}-refunded`,
              RAN: ret.RAN,
              orderId: ret.orderId,
              type: 'refund_issued',
              title: `Refund Issued ${ret.requestedMethod ? `via ${ret.requestedMethod.replace('_', ' ')}` : ''}`,
              description: `Refund processed for ${ret.items?.length || 0} item(s)`,
              timestamp: ret.refundedAt || ret.completedAt,
              amount: ret.refundAmount || ret.refundDetails?.finalAmount,
              method: ret.requestedMethod
            });
          }
        }

        // Pickup created activity
        if (ret.awb && ret.createdAt) {
          const createdDate = ret.createdAt.toDate ? ret.createdAt.toDate() : new Date(ret.createdAt);
          if (createdDate >= today && createdDate < tomorrow) {
            activities.push({
              id: `${ret.id}-pickup`,
              RAN: ret.RAN,
              orderId: ret.orderId,
              type: 'pickup_created',
              title: 'Pickup Scheduled',
              description: `AWB: ${ret.awb}`,
              timestamp: ret.createdAt,
            });
          }
        }

        // Return rejected/closed activity
        if (ret.status === 'denied' || ret.status === 'closed') {
          const updatedAt = ret.updatedAt?.toDate ? ret.updatedAt.toDate() : 
                            ret.createdAt?.toDate ? ret.createdAt.toDate() : new Date();
          if (updatedAt >= today && updatedAt < tomorrow) {
            activities.push({
              id: `${ret.id}-rejected`,
              RAN: ret.RAN,
              orderId: ret.orderId,
              type: 'return_rejected',
              title: ret.status === 'denied' ? 'Return Denied' : 'Return Closed',
              description: ret.rejectionReason || 'No reason provided',
              timestamp: ret.updatedAt || ret.createdAt,
            });
          }
        }
      });

      // Sort by timestamp (newest first)
      activities.sort((a, b) => {
        const timeA = a.timestamp?.toDate?.()?.getTime() || 0;
        const timeB = b.timestamp?.toDate?.()?.getTime() || 0;
        return timeB - timeA;
      });

      setRecentActivities(activities);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Calculate statistics
  const stats = useMemo<DashboardStats>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let totalRefunded = 0;
    let todayRefunded = 0;
    let totalProcessingDays = 0;
    let completedCount = 0;

    // Active shipments: Returns that have pickup created/scheduled/in transit, not completed/received
    const activeShipments = returns.filter(r => {
      // Consider 'delivered' as active until received
      const isInTransit = (
        r.shipmentStatus?.toLowerCase() === 'pickup created' ||
        r.shipmentStatus?.toLowerCase() === 'pickup scheduled' ||
        r.shipmentStatus?.toLowerCase() === 'in transit' ||
        r.shipmentStatus?.toLowerCase() === 'delivered' // Add this if needed
      );
      
      const isNotCompleted = !['completed', 'denied', 'closed'].includes(r.status?.toLowerCase());
      const isNotReceived = !r.receivedAt;
      
      return isInTransit && isNotCompleted && isNotReceived;
    }).length;

    const openReturns = returns.filter(r => 
      (r.status?.toLowerCase() === 'open' || 
       r.status?.toLowerCase() === 'pending' ||
       r.status?.toLowerCase() === 'approved') &&
      r.status?.toLowerCase() !== 'completed' &&
      r.status?.toLowerCase() !== 'denied' &&
      r.status?.toLowerCase() !== 'closed'
    ).length;

    const pendingApproval = returns.filter(r => 
      r.status?.toLowerCase() === 'pending'
    ).length;

    const completedReturns = returns.filter(r => 
      r.status?.toLowerCase() === 'completed'
    ).length;

    const rejectedReturns = returns.filter(r => 
      r.status?.toLowerCase() === 'denied'
    ).length;

    const pendingRefunds = returns.filter(r => 
      (r.refundStatus?.toLowerCase() === 'pending' ||
       r.refundStatus?.toLowerCase() === 'processing') &&
      r.status?.toLowerCase() !== 'denied' &&
      r.status?.toLowerCase() !== 'closed'
    ).length;

    const giftCardReturns = returns.filter(r => 
      r.requestedMethod === 'gift_card' &&
      r.status?.toLowerCase() !== 'denied'
    ).length;

    const storeCreditReturns = returns.filter(r => 
      r.requestedMethod === 'store_credit' &&
      r.status?.toLowerCase() !== 'denied'
    ).length;

    const originalPaymentReturns = returns.filter(r => 
      (r.requestedMethod === 'refund' || !r.requestedMethod) &&
      r.status?.toLowerCase() !== 'denied'
    ).length;

    // Calculate refund amounts and average processing days
    returns.forEach(r => {
      const amount = r.refundAmount || r.refundDetails?.finalAmount || 0;
      if (amount > 0 && (r.refundStatus === 'Refunded' || r.status === 'completed')) {
        totalRefunded += amount;

        // Check if refunded today
        const refundedAt = r.refundedAt || r.completedAt;
        if (refundedAt) {
          const refundDate = refundedAt.toDate ? refundedAt.toDate() : new Date(refundedAt);
          if (refundDate >= today) {
            todayRefunded += amount;
          }
        }
      }

      if (r.createdAt && (r.completedAt || r.refundedAt) && r.status === 'completed') {
        const created = r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
        
        // Use the LATEST of completedAt or refundedAt as the end date
        let completed = null;
        if (r.completedAt && r.refundedAt) {
          // If both exist, take the later one
          const compDate = r.completedAt.toDate ? r.completedAt.toDate() : new Date(r.completedAt);
          const refDate = r.refundedAt.toDate ? r.refundedAt.toDate() : new Date(r.refundedAt);
          completed = compDate > refDate ? compDate : refDate;
        } else {
          completed = r.completedAt?.toDate ? r.completedAt.toDate() : 
                      r.refundedAt?.toDate ? r.refundedAt.toDate() : new Date();
        }
        
        // Calculate business days only (optional)
        let days = 0;
        let currentDate = new Date(created);
        while (currentDate < completed) {
          const dayOfWeek = currentDate.getDay();
          // Skip Sundays (0) and optionally Saturdays (6)
          if (dayOfWeek !== 0) { // Monday to Saturday
            days++;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
        
        if (days > 0) {
          totalProcessingDays += days;
          completedCount++;
        }
      }
    });

    return {
      totalReturns: returns.length,
      openReturns,
      pendingApproval,
      activeShipments,
      completedReturns,
      rejectedReturns,
      totalRefundedAmount: totalRefunded,
      todayRefundedAmount: todayRefunded,
      avgProcessingDays: completedCount > 0 ? Math.round(totalProcessingDays / completedCount) : 0,
      pendingRefunds,
      giftCardReturns,
      storeCreditReturns,
      originalPaymentReturns,
    };
  }, [returns]);

  // Quick links for navigation
  const quickLinks = [
    { label: 'All Returns', href: '/returns', count: stats.totalReturns, icon: <Package className="w-4 h-4" />, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Open Returns', href: '/returns?tab=open', count: stats.openReturns, icon: <Clock className="w-4 h-4" />, color: 'bg-amber-50 text-amber-600' },
    { label: 'Active Shipments', href: '/returns?tab=active', count: stats.activeShipments, icon: <Truck className="w-4 h-4" />, color: 'bg-purple-50 text-purple-600' },
    { label: 'Pending Refunds', href: '/returns?tab=refunds', count: stats.pendingRefunds, icon: <CreditCard className="w-4 h-4" />, color: 'bg-blue-50 text-blue-600' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8 animate-pulse">
            <div className="h-8 bg-slate-200 rounded w-48 mb-2"></div>
            <div className="h-4 bg-slate-200 rounded w-64"></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-3 flex-1">
                    <div className="h-4 bg-slate-200 rounded w-24"></div>
                    <div className="h-8 bg-slate-200 rounded w-32"></div>
                    <div className="h-4 bg-slate-200 rounded w-20"></div>
                  </div>
                  <div className="w-12 h-12 bg-slate-200 rounded-xl"></div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="h-6 bg-slate-200 rounded w-48 mb-4"></div>
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-200 rounded-xl"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                        <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="h-6 bg-slate-200 rounded w-40 mb-4"></div>
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 bg-slate-200 rounded w-full"></div>
                    <div className="h-3 bg-slate-200 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <StatCard
            title="Total Returns"
            value={stats.totalReturns}
            icon={<Package className="w-6 h-6" />}
            color="indigo"
            trend={stats.totalReturns > 0 ? 'up' : undefined}
            trendValue={`${stats.openReturns} open`}
          />
          <StatCard
            title="Total Refunded"
            value={formatCurrency(stats.totalRefundedAmount)}
            icon={<CreditCard className="w-6 h-6" />}
            color="emerald"
            trend={stats.todayRefundedAmount > 0 ? 'up' : undefined}
            trendValue={`${formatCurrency(stats.todayRefundedAmount)} today`}
          />
          <StatCard
            title="Active Shipments"
            value={stats.activeShipments}
            icon={<Truck className="w-6 h-6" />}
            color="purple"
            trend={stats.activeShipments > 0 ? 'up' : 'down'}
            trendValue={`${stats.pendingApproval} pending`}
          />
          <StatCard
            title="Avg. Processing"
            value={`${stats.avgProcessingDays} days`}
            icon={<Clock className="w-6 h-6" />}
            color="amber"
            trend={stats.avgProcessingDays > 3 ? 'down' : 'up'}
            trendValue={stats.avgProcessingDays > 3 ? 'Needs improvement' : 'On track'}
          />
        </div>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 to-white p-4 rounded-xl border border-indigo-100">
            <p className="text-xs text-indigo-600 font-medium mb-1">Open Returns</p>
            <p className="text-2xl font-bold text-indigo-900">{stats.openReturns}</p>
            <p className="text-xs text-indigo-500 mt-1">Pending review</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-white p-4 rounded-xl border border-emerald-100">
            <p className="text-xs text-emerald-600 font-medium mb-1">Completed</p>
            <p className="text-2xl font-bold text-emerald-900">{stats.completedReturns}</p>
            <p className="text-xs text-emerald-500 mt-1">Successfully processed</p>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-white p-4 rounded-xl border border-amber-100">
            <p className="text-xs text-amber-600 font-medium mb-1">Refund Methods</p>
            <div className="space-y-1 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <Wallet className="w-3 h-3 text-amber-600" /> Store Credit
                </span>
                <span className="font-medium">{stats.storeCreditReturns}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <Gift className="w-3 h-3 text-purple-600" /> Gift Card
                </span>
                <span className="font-medium">{stats.giftCardReturns}</span>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-xl border border-blue-100">
            <p className="text-xs text-blue-600 font-medium mb-1">Today's Activity</p>
            <p className="text-2xl font-bold text-blue-900">{recentActivities.length}</p>
            <p className="text-xs text-blue-500 mt-1">New updates</p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Activity - Left Column (spans 2 columns) */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">Today's Activity</h2>
                <Link 
                  to="/returns" 
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                >
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
            
            {/* Scrollable Activity List */}
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto custom-scrollbar">
              {recentActivities.length > 0 ? (
                recentActivities.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))
              ) : (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Clock className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-slate-500 font-medium">No activity today</p>
                  <p className="text-sm text-slate-400 mt-1">New returns will appear here</p>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions & Summary - Right Column */}
          <div className="space-y-6">
            {/* Quick Links */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Quick Links</h3>
              <div className="space-y-2">
                {quickLinks.map((link, idx) => (
                  <Link
                    key={idx}
                    to={link.href}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${link.color}`}>
                        {link.icon}
                      </div>
                      <span className="text-sm font-medium text-slate-700">{link.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{link.count}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Refund Summary */}
            <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-xl">
              <h3 className="text-sm font-medium opacity-80 mb-2">Total Refunded (30 Days)</h3>
              <p className="text-3xl font-bold mb-1">{formatCurrency(stats.totalRefundedAmount)}</p>
              
              {stats.todayRefundedAmount > 0 && (
                <div className="flex items-center gap-1 text-sm text-emerald-300 mt-2">
                  <ArrowUp className="w-4 h-4" />
                  <span>{formatCurrency(stats.todayRefundedAmount)} refunded today</span>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-white/20">
                <div className="flex items-center justify-between text-sm">
                  <span className="opacity-80">Open Returns</span>
                  <span className="font-bold">{stats.openReturns}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="opacity-80">Pending Refunds</span>
                  <span className="font-bold">{stats.pendingRefunds}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="opacity-80">Active Shipments</span>
                  <span className="font-bold">{stats.activeShipments}</span>
                </div>
              </div>

              <Link
                to="/returns?tab=open"
                className="mt-4 w-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                Process Returns <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Pending Returns Alert */}
            {stats.pendingApproval > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-amber-800">Pending Approval</h4>
                    <p className="text-sm text-amber-700 mt-1">
                      {stats.pendingApproval} return{stats.pendingApproval > 1 ? 's' : ''} waiting for review
                    </p>
                    <Link
                      to="/returns?tab=open"
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900"
                    >
                      Review now <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
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