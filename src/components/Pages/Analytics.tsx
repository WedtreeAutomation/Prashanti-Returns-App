import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  RefreshCw, Download, Package, AlertCircle,
  ArrowUpRight, ArrowDownRight, ChevronDown,
  DollarSign, Clock, Users, XCircle, Calendar,
  TrendingUp, CreditCard, Gift, Wallet, BarChart2,
  ShieldAlert, Layers, AlertTriangle, Repeat,
} from 'lucide-react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { ResolutionData, ReasonData,
  CustomerReturnData, ProductReturnData, StateReturnData,
} from '../../Interfaces/types';

// ─── Status constants ──────────────────────────────────────────────────────────
const COMPLETED_STATUSES = new Set(['completed', 'Completed', 'Approved']);
const REJECTED_STATUSES  = new Set(['Denied', 'denied', 'Closed', 'closed', 'Cancelled', 'cancelled']);
const DEFECTIVE_REASONS  = new Set([
  'I received a defective item',
  'received a defective item',
  'Defective Item',
]);

// ─── Helpers ───────────────────────────────────────────────────────────────────
const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n).replace('₹', '₹ ');

const formatNumber = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const pct = (v: number, t: number) => (t === 0 ? 0 : (v / t) * 100);
const fmtIso = (d: Date) => d.toISOString().split('T')[0];

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts._seconds) return new Date(ts._seconds * 1000);
    if (ts.seconds) return new Date(ts.seconds * 1000);
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
};

// Robust amount helper — guarantees an amount if the return was refunded
const getAmt = (r: any): number => {
  let amt = Number(r.refundAmount);
  if (!isNaN(amt) && amt > 0) return amt;
  
  amt = Number(r.refundDetails?.finalAmount);
  if (!isNaN(amt) && amt > 0) return amt;

  // Fallback: If it's refunded but DB lacks the total amount, calculate from items
  if (r.refundStatus === 'Refunded' && r.items) {
    let itemTotal = 0;
    r.items.forEach((item: any) => {
      const price = parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')) || 0;
      itemTotal += price * (item.quantityReturned || 1);
    });
    if (itemTotal > 0) return itemTotal;
  }
  return 0;
};

const REASON_MAP: Record<string, string> = {
  'I received a defective item': 'Defective Item',
  'Wrong item shipped':          'Wrong Item',
  'Color mismatch':              'Color Mismatch',
  'Product quality issue':       'Quality Issue',
  'Delivery was delayed':        'Delivery Delay',
  'Other reason':                'Other',
  'product quality reason':      'Quality Issue',
  'color mismatch':              'Color Mismatch',
  'other reason':                'Other',
  'received a defective item':   'Defective Item',
  'wrong item shipped':          'Wrong Item',
  'delivery was delayed':        'Delivery Delay',
};
const getReasonLabel = (r: string) => REASON_MAP[r] ?? r;

// ─── Excel helper ──────────────────────────────────────────────────────────────
const addSheet = (
  wb: XLSX.WorkBook,
  name: string,
  headers: string[],
  rows: (string | number)[][],
) => {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 24 }));
  XLSX.utils.book_append_sheet(wb, ws, name);
};

// ─── Custom Date Range Picker ──────────────────────────────────────────────────
const CustomDateRangePicker = ({
  startDate, endDate, onChange, onClose,
}: {
  startDate: string; endDate: string;
  onChange: (s: string, e: string) => void;
  onClose: () => void;
}) => {
  const [ls, setLs] = useState(startDate);
  const [le, setLe] = useState(endDate);

  const quick = (days: number) => {
    const end = new Date(); const start = new Date();
    start.setDate(end.getDate() - days); start.setHours(0, 0, 0, 0);
    setLs(fmtIso(start)); setLe(fmtIso(end));
  };

  return (
    <div className="absolute top-full right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 p-4 w-80">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {([
          ['Last 7 days', 7], ['Last 30 days', 30],
          ['Last 90 days', 90], ['Last 6 months', 180], ['Last year', 365],
        ] as [string, number][]).map(([l, d]) => (
          <button key={d} onClick={() => quick(d)}
            className="text-xs px-2 py-1.5 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 border border-slate-200 font-medium">
            {l}
          </button>
        ))}
      </div>
      <div className="space-y-3 mb-4">
        {([['Start Date', ls, setLs], ['End Date', le, setLe]] as [string, string, React.Dispatch<React.SetStateAction<string>>][]).map(([label, val, setter]) => (
          <div key={label}>
            <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">{label}</label>
            <input type="date" value={val} onChange={e => setter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-200 outline-none" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onClose}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button onClick={() => { onChange(ls, le); onClose(); }}
          className="flex-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium">
          Apply
        </button>
      </div>
    </div>
  );
};

// ─── Metric Card ───────────────────────────────────────────────────────────────
type CardColor = 'blue' | 'purple' | 'orange' | 'emerald' | 'pink' | 'indigo' | 'amber' | 'red' | 'cyan' | 'teal';

const GRAD: Record<CardColor, string> = {
  blue:    'from-blue-500 to-blue-600',
  purple:  'from-purple-500 to-purple-600',
  orange:  'from-orange-500 to-pink-500',
  emerald: 'from-emerald-500 to-green-500',
  pink:    'from-pink-500 to-rose-500',
  indigo:  'from-indigo-500 to-purple-500',
  amber:   'from-amber-500 to-orange-500',
  red:     'from-red-500 to-rose-600',
  cyan:    'from-cyan-500 to-blue-500',
  teal:    'from-teal-500 to-emerald-500',
};

const MetricCard = ({
  title, value, trend, trendValue, icon, color = 'blue',
  isLoading = false, highlight = false, badge,
}: {
  title: string;
  value: string | number;
  trend?: 'up' | 'down';
  trendValue?: string;
  icon: React.ReactNode;
  color?: CardColor;
  isLoading?: boolean;
  highlight?: boolean;
  badge?: { label: string; variant: 'warn' | 'ok' | 'info' };
}) => {
  if (isLoading) return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm animate-pulse">
      <div className="space-y-3">
        <div className="h-4 bg-slate-200 rounded w-24" />
        <div className="h-8 bg-slate-200 rounded w-32" />
        <div className="h-4 bg-slate-200 rounded w-20" />
      </div>
    </div>
  );

  const badgeCls =
    badge?.variant === 'warn' ? 'bg-amber-100 text-amber-700' :
    badge?.variant === 'info' ? 'bg-blue-100 text-blue-700' :
    'bg-emerald-100 text-emerald-700';

  return (
    <div className={`bg-white rounded-2xl border p-6 shadow-sm hover:shadow-md transition-all duration-300 relative overflow-hidden group
      ${highlight ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'}`}>
      <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${GRAD[color]} rounded-full blur-3xl opacity-10 -mr-10 -mt-10 group-hover:opacity-20 transition-opacity`} />
      <div className="relative flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-slate-900 truncate tabular-nums">{value}</p>
          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              {trend === 'up'
                ? <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                : <ArrowDownRight className="w-4 h-4 text-red-500" />}
              <span className={`text-xs font-medium ${trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
                {trendValue}
              </span>
            </div>
          )}
          {badge && (
            <span className={`inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeCls}`}>
              {badge.label}
            </span>
          )}
        </div>
        <div className={`p-3 rounded-xl bg-gradient-to-br ${GRAD[color]} text-white shrink-0 ml-3`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

// ─── Progress Bar ──────────────────────────────────────────────────────────────
const BAR_CLR: Record<string, string> = {
  blue: 'bg-blue-500', purple: 'bg-purple-500', orange: 'bg-orange-500',
  emerald: 'bg-emerald-500', pink: 'bg-pink-500', indigo: 'bg-indigo-500',
  amber: 'bg-amber-500', red: 'bg-red-500',
};

const ProgressBar = ({
  label, value, percentage, color = 'blue',
}: {
  label: string; value: number; percentage: number; color?: string;
}) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900 tabular-nums">{value} ({percentage.toFixed(1)}%)</span>
    </div>
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${BAR_CLR[color] ?? 'bg-blue-500'} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  </div>
);

// ─── Refund Method Comparison Card ────────────────────────────────────────────
const BAR_HEX = (c: string) =>
  c.includes('emerald') ? '#10b981' : c.includes('purple') ? '#8b5cf6' :
  c.includes('blue')    ? '#3b82f6' : c.includes('amber')  ? '#f59e0b' : '#6366f1';

const RefundMethodComparison = ({
  title, data, icon, colorScheme,
}: {
  title: string;
  data: { label: string; count: number; value: number; color: string; icon: React.ReactNode }[];
  icon: React.ReactNode;
  colorScheme: string;
}) => {
  const totalCount = data.reduce((s, d) => s + d.count, 0);
  const totalValue = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className={`p-2 rounded-xl ${colorScheme}`}>{icon}</div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <span className="ml-auto text-sm text-slate-500">{formatNumber(totalCount)} returns</span>
      </div>
      <div className="space-y-4">
        {data.map((item, idx) => {
          const p = pct(item.count, totalCount);
          return (
            <div key={idx} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${item.color}`}>
                    {item.icon}
                  </div>
                  <span className="text-sm font-medium text-slate-700">{item.label}</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900 tabular-nums">
                    {item.count} <span className="font-normal text-slate-400">({p.toFixed(1)}%)</span>
                  </div>
                  <div className="text-xs text-emerald-600 font-semibold tabular-nums">
                    {formatCurrency(item.value)}
                  </div>
                </div>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${p}%`, background: BAR_HEX(item.color) }} />
              </div>
            </div>
          );
        })}
      </div>
      {totalValue > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm text-slate-500">Total Value</span>
          <span className="text-base font-bold text-slate-900 tabular-nums">{formatCurrency(totalValue)}</span>
        </div>
      )}
    </div>
  );
};

// ─── Data Table ────────────────────────────────────────────────────────────────
const DataTable = ({
  headers, data, renderRow, emptyMessage = 'No data available', maxHeight = '400px',
}: {
  headers: string[];
  data: any[];
  renderRow: (item: any, idx: number) => React.ReactNode;
  emptyMessage?: string;
  maxHeight?: string;
}) => {
  if (!data.length) return (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Package className="w-8 h-8 text-slate-400" />
      </div>
      <p className="text-slate-500 font-medium">{emptyMessage}</p>
      <p className="text-sm text-slate-400 mt-1">
        You'll start getting insights as customers submit returns
      </p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div style={{ maxHeight }} className="overflow-y-auto custom-scrollbar">
        <table className="w-full">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-slate-200">
              {headers.map((h, i) => (
                <th key={i} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {h}
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

// ─── Returns Over Time Chart ───────────────────────────────────────────────────
const ReturnsOverTimeChart = ({
  data, granularity, onGranularityChange,
}: {
  data: { label: string; returns: number; value: number }[];
  granularity: 'daily' | 'weekly';
  onGranularityChange: (g: 'daily' | 'weekly') => void;
}) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
    <div className="flex items-center justify-between mb-6">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Returns Over Time</h3>
        <p className="text-sm text-slate-500 mt-0.5">Volume trend for selected period</p>
      </div>
      <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
        {(['daily', 'weekly'] as const).map(g => (
          <button key={g} onClick={() => onGranularityChange(g)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize
              ${granularity === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {g}
          </button>
        ))}
      </div>
    </div>
    {data.length === 0
      ? <div className="h-52 flex items-center justify-center text-slate-400 text-sm">No data for selected period</div>
      : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', fontSize: 12 }}
              formatter={(value: number, name: string) =>
                name === 'returns' ? [value, 'Returns'] : [formatCurrency(value), 'Refund Value']}
            />
            <Area type="monotone" dataKey="returns" stroke="#6366f1" strokeWidth={2.5}
              fill="url(#aGrad)" dot={false} activeDot={{ r: 5, fill: '#6366f1' }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
  </div>
);

// ─── Main Analytics Component ──────────────────────────────────────────────────
export const Analytics = () => {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allReturns, setAllReturns] = useState<any[]>([]);

  // Default set to 'all' to match the Home.tsx default dashboard count
  const [dateRange, setDateRange]   = useState<'7days' | '30days' | '90days' | 'year' | 'all' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [chartGranularity, setChartGranularity] = useState<'daily' | 'weekly'>('daily');
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node))
        setShowDatePicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Firestore fetch ──────────────────────────────────────────────────────────
  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'returns'), orderBy('createdAt', 'desc')));
      setAllReturns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('Analytics: fetchData error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // ── Date filter ──────────────────────────────────────────────────────────────
  const filteredReturns = useMemo(() => {
    if (dateRange === 'all') return allReturns;

    if (dateRange === 'custom' && customStart && customEnd) {
      const start = new Date(customStart); start.setHours(0, 0, 0, 0);
      const end   = new Date(customEnd);   end.setHours(23, 59, 59, 999);
      return allReturns.filter(r => {
        const d = toDate(r.createdAt) || (r.submittedAt ? new Date(r.submittedAt) : null);
        return d ? d >= start && d <= end : true; // Include if parsing fails so data isn't lost
      });
    }

    const now    = new Date();
    const cutoff = new Date();
    if (dateRange === '7days')  cutoff.setDate(now.getDate() - 7);
    if (dateRange === '30days') cutoff.setDate(now.getDate() - 30);
    if (dateRange === '90days') cutoff.setDate(now.getDate() - 90);
    if (dateRange === 'year')   cutoff.setFullYear(now.getFullYear() - 1);
    cutoff.setHours(0, 0, 0, 0);

    return allReturns.filter(r => {
      const d = toDate(r.createdAt) || (r.submittedAt ? new Date(r.submittedAt) : null);
      return d ? d >= cutoff : true;
    });
  }, [allReturns, dateRange, customStart, customEnd]);

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalReturns    = filteredReturns.length;
    const rejectedReturns = filteredReturns.filter(r => REJECTED_STATUSES.has(r.status)).length;
    const rejectionRate   = pct(rejectedReturns, totalReturns);
    
    // Explicitly track fully processed returns to prove they are included
    const completedReturns = filteredReturns.filter(r => COMPLETED_STATUSES.has(r.status) || r.refundStatus === 'Refunded').length;

    const EXCLUDE_FROM_PENDING = new Set(['Cancelled', 'cancelled', 'Pickup Cancelled']);
    const pendingRefunds = filteredReturns.filter(r =>
      r.refundStatus !== 'Refunded' &&
      !REJECTED_STATUSES.has(r.status) &&
      !EXCLUDE_FROM_PENDING.has(r.status)
    ).length;

    let totalRefundValue = 0;
    let revenueSaved     = 0;
    filteredReturns.forEach(r => {
      const amt = getAmt(r);
      totalRefundValue += amt;
      if (r.requestedMethod === 'store_credit' || r.requestedMethod === 'gift_card')
        revenueSaved += amt;
    });

    const uniqueCustomers = new Set(
      filteredReturns.map(r => r.customer?.email).filter(Boolean)
    ).size;

    let totalDays = 0; let completedCount = 0;
    filteredReturns.forEach(r => {
      if (!COMPLETED_STATUSES.has(r.status)) return;
      const created = toDate(r.createdAt);
      const done    = toDate(r.completedAt) || toDate(r.refundedAt);
      if (created && done) {
        totalDays += Math.ceil((done.getTime() - created.getTime()) / 86400000);
        completedCount++;
      }
    });
    const avgProcessingTime = completedCount > 0 ? Math.round(totalDays / completedCount) : 0;

    const totalItems = filteredReturns.reduce((s, r) =>
      s + (r.items?.reduce((si: number, i: any) => si + (i.quantityReturned || 1), 0) ?? 0), 0);
    const avgItemsPerReturn = totalReturns > 0
      ? parseFloat((totalItems / totalReturns).toFixed(1)) : 0;

    let defectiveItems = 0;
    filteredReturns.forEach(r => {
      r.items?.forEach((item: any) => {
        if (item.reason && DEFECTIVE_REASONS.has(item.reason))
          defectiveItems += (item.quantityReturned || 1);
      });
    });
    const defectiveRate = pct(defectiveItems, totalItems);

    const customerCounts = new Map<string, number>();
    filteredReturns.forEach(r => {
      const id = r.customer?.email || r.customer?.name || 'unknown';
      customerCounts.set(id, (customerCounts.get(id) || 0) + 1);
    });
    const repeatReturners = Array.from(customerCounts.values()).filter(c => c >= 3).length;

    return {
      totalReturns, rejectedReturns, rejectionRate,
      pendingRefunds, totalRefundValue, revenueSaved,
      uniqueCustomers, avgProcessingTime, completedReturns,
      avgItemsPerReturn, defectiveRate, defectiveItems, totalItems,
      repeatReturners,
    };
  }, [filteredReturns]);

  // ── Returns Over Time ────────────────────────────────────────────────────────
  const returnsOverTime = useMemo(() => {
    const map = new Map<string, { date: Date; returns: number; value: number }>();

    filteredReturns.forEach(r => {
      const d = toDate(r.createdAt) || (r.submittedAt ? new Date(r.submittedAt) : null); 
      if (!d) return;
      const amt = getAmt(r);

      let key: string; let keyDate: Date;
      if (chartGranularity === 'weekly') {
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        mon.setHours(0, 0, 0, 0);
        key     = mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        keyDate = mon;
      } else {
        keyDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        key     = keyDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      }

      const ex = map.get(key) || { date: keyDate, returns: 0, value: 0 };
      map.set(key, { date: ex.date, returns: ex.returns + 1, value: ex.value + amt });
    });

    return Array.from(map.entries())
      .map(([label, v]) => ({ label, returns: v.returns, value: v.value, _d: v.date }))
      .sort((a, b) => a._d.getTime() - b._d.getTime())
      .map(({ label, returns, value }) => ({ label, returns, value }));
  }, [filteredReturns, chartGranularity]);

  // ── Requested method breakdown ───────────────────────────────────────────────
  const requestedMethodData = useMemo(() => {
    let sc = { count: 0, value: 0 };
    let gc = { count: 0, value: 0 };
    let rf = { count: 0, value: 0 };

    filteredReturns.forEach(r => {
      const amt = getAmt(r);
      if (r.requestedMethod === 'store_credit')      { sc.count++; sc.value += amt; }
      else if (r.requestedMethod === 'gift_card')    { gc.count++; gc.value += amt; }
      else                                           { rf.count++; rf.value += amt; }
    });

    return [
      { label: 'Store Credit',     count: sc.count, value: sc.value, color: 'bg-emerald-100 text-emerald-600', icon: <Wallet     className="w-3.5 h-3.5" /> },
      { label: 'Gift Card',        count: gc.count, value: gc.value, color: 'bg-purple-100 text-purple-600',   icon: <Gift       className="w-3.5 h-3.5" /> },
      { label: 'Original Payment', count: rf.count, value: rf.value, color: 'bg-blue-100 text-blue-600',       icon: <CreditCard className="w-3.5 h-3.5" /> },
    ];
  }, [filteredReturns]);

  // ── Applied refund method ────────────────────────────────────────────────────
  const appliedRefundData = useMemo(() => {
    let sc = { count: 0, value: 0 };
    let gc = { count: 0, value: 0 };
    let op = { count: 0, value: 0 };
    let mn = { count: 0, value: 0 };

    filteredReturns.forEach(r => {
      // Extremely robust fallback for identifying the applied method
      let method = r.refundMethod || r.refundDetails?.method;
      if (!method && r.refundStatus === 'Refunded') {
        method = r.requestedMethod === 'refund' ? 'original' : r.requestedMethod;
      }
      
      const amt = getAmt(r);
      if (!method) return;

      if (method === 'store_credit')                             { sc.count++; sc.value += amt; }
      else if (method === 'giftcard' || method === 'gift_card') { gc.count++; gc.value += amt; }
      else if (method === 'original' || method === 'original_payment' || method === 'refund') { op.count++; op.value += amt; }
      else if (method === 'manual')                             { mn.count++; mn.value += amt; }
    });

    return [
      { label: 'Store Credit',     count: sc.count, value: sc.value, color: 'bg-emerald-100 text-emerald-600', icon: <Wallet     className="w-3.5 h-3.5" /> },
      { label: 'Gift Card',        count: gc.count, value: gc.value, color: 'bg-purple-100 text-purple-600',   icon: <Gift       className="w-3.5 h-3.5" /> },
      { label: 'Original Payment', count: op.count, value: op.value, color: 'bg-blue-100 text-blue-600',       icon: <CreditCard className="w-3.5 h-3.5" /> },
      { label: 'Manual',           count: mn.count, value: mn.value, color: 'bg-amber-100 text-amber-600',     icon: <DollarSign className="w-3.5 h-3.5" /> },
    ];
  }, [filteredReturns]);

  // ── Revenue saved resolution breakdown ──────────────────────────────────────
  const resolutionData = useMemo(() => {
    const res: ResolutionData[] = [
      { type: 'Original Payment Refund', count: 0, percentage: 0, totalValue: 0 },
      { type: 'Store Credit',            count: 0, percentage: 0, totalValue: 0 },
      { type: 'Gift Card',               count: 0, percentage: 0, totalValue: 0 },
    ];

    filteredReturns.forEach(r => {
      const amt = getAmt(r);
      if (!r.requestedMethod || r.requestedMethod === 'refund') { res[0].count++; res[0].totalValue += amt; }
      else if (r.requestedMethod === 'store_credit')            { res[1].count++; res[1].totalValue += amt; }
      else if (r.requestedMethod === 'gift_card')               { res[2].count++; res[2].totalValue += amt; }
    });

    res.forEach(r => { r.percentage = pct(r.count, filteredReturns.length); });
    return res;
  }, [filteredReturns]);

  // ── Top return reasons ───────────────────────────────────────────────────────
  const topReasons = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    let total = 0;

    filteredReturns.forEach(ret => {
      ret.items?.forEach((item: any) => {
        if (!item.reason) return;
        const reason = getReasonLabel(item.reason);
        const price  = parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')) || 0;
        const cur    = map.get(reason) || { count: 0, value: 0 };
        map.set(reason, {
          count: cur.count + 1,
          value: cur.value + price * (item.quantityReturned || 1),
        });
        total++;
      });
    });

    return Array.from(map.entries())
      .map(([reason, d]) => ({
        reason,
        count: d.count,
        percentage: pct(d.count, total),
        totalValue: d.value,
      } as ReasonData))
      .sort((a, b) => b.count - a.count);
  }, [filteredReturns]);

  // ── Most returned products ───────────────────────────────────────────────────
  const mostReturnedProducts = useMemo(() => {
    const map = new Map<string, ProductReturnData>();

    filteredReturns.forEach(ret => {
      ret.items?.forEach((item: any) => {
        const key   = item.sku || `variant-${item.lineItemId || Math.random()}`;
        const price = parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')) || 0;
        const qty   = item.quantityReturned || 1;
        const ex    = map.get(key);

        if (ex) {
          ex.returnCount   += qty;
          ex.totalQuantity += qty;
          ex.totalValue    += price * qty;
          if (item.reason) {
            const r = getReasonLabel(item.reason);
            ex.reasons[r] = (ex.reasons[r] || 0) + 1;
          }
        } else {
          map.set(key, {
            variantId: key, title: item.title || 'Unknown',
            sku: item.sku || 'N/A', price,
            image: item.productImage,
            returnCount: qty, totalQuantity: qty,
            totalValue: price * qty,
            reasons: item.reason ? { [getReasonLabel(item.reason)]: 1 } : {},
            returnRate: 0,
          });
        }
      });
    });

    return Array.from(map.values())
      .sort((a, b) => b.returnCount - a.returnCount)
      .slice(0, 10);
  }, [filteredReturns]);

  // ── Top customers ────────────────────────────────────────────────────────────
  const topReturningCustomers = useMemo(() => {
    const map = new Map<string, CustomerReturnData & { isRepeat: boolean }>();

    filteredReturns.forEach(ret => {
      const id  = ret.customer?.email || `cust-${ret.customer?.name}`;
      const amt = getAmt(ret);
      const ex  = map.get(id);

      if (ex) {
        ex.returnCount++;
        ex.totalValue += amt;
        ex.isRepeat    = ex.returnCount >= 3;
      } else {
        map.set(id, {
          customerId: id,
          name:        ret.customer?.name  || 'Unknown',
          email:       ret.customer?.email || '',
          returnCount: 1,
          totalValue:  amt,
          phone:       (ret.customer as any)?.phone,
          isRepeat:    false,
        });
      }
    });

    return Array.from(map.values())
      .sort((a, b) => b.returnCount - a.returnCount)
      .slice(0, 10);
  }, [filteredReturns]);

  // ── Returns by state ─────────────────────────────────────────────────────────
  const returnsByState = useMemo(() => {
    const map = new Map<string, StateReturnData>();

    filteredReturns.forEach(ret => {
      const state = (ret.customer as any)?.state || 'Unknown';
      const amt   = getAmt(ret);
      const ex    = map.get(state) || { state, returnCount: 0, totalValue: 0, uniqueCustomers: 0 };
      map.set(state, { ...ex, returnCount: ex.returnCount + 1, totalValue: ex.totalValue + amt });
    });

    return Array.from(map.values()).sort((a, b) => b.returnCount - a.returnCount);
  }, [filteredReturns]);

  // ── Date range label ─────────────────────────────────────────────────────────
  const dateRangeLabel = useMemo(() => {
    if (dateRange === 'custom' && customStart && customEnd) {
      const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
      return `${new Date(customStart).toLocaleDateString('en-IN', o)} – ${new Date(customEnd).toLocaleDateString('en-IN', { ...o, year: 'numeric' })}`;
    }
    return ({
      '7days':  'Last 7 Days',
      '30days': 'Last 30 Days',
      '90days': 'Last 90 Days',
      year:     'Last Year',
      all:      'All Time',
    } as Record<string, string>)[dateRange] ?? 'Custom Range';
  }, [dateRange, customStart, customEnd]);

  // ── Excel export ─────────────────────────────────────────────────────────────
  const handleExport = () => {
    const wb = XLSX.utils.book_new();

    addSheet(wb, 'Summary', ['Metric', 'Value', 'Period'], [
      ['Total Returns',            kpis.totalReturns,                            dateRangeLabel],
      ['Completed Returns',        kpis.completedReturns,                        dateRangeLabel],
      ['Rejected Returns',         kpis.rejectedReturns,                         dateRangeLabel],
      ['Rejection Rate (%)',       parseFloat(kpis.rejectionRate.toFixed(1)),   dateRangeLabel],
      ['Pending Refunds',          kpis.pendingRefunds,                          dateRangeLabel],
      ['Total Refund Value (INR)', kpis.totalRefundValue,                        dateRangeLabel],
      ['Revenue Saved (INR)',      kpis.revenueSaved,                            dateRangeLabel],
      ['Unique Customers',         kpis.uniqueCustomers,                         dateRangeLabel],
      ['Repeat Returners (3+)',    kpis.repeatReturners,                         dateRangeLabel],
      ['Avg Processing Time (d)',  kpis.avgProcessingTime,                       dateRangeLabel],
      ['Avg Items Per Return',     kpis.avgItemsPerReturn,                       dateRangeLabel],
      ['Defective Item Rate (%)',  parseFloat(kpis.defectiveRate.toFixed(1)),   dateRangeLabel],
    ]);

    addSheet(wb, 'Returns Over Time', ['Period', 'Returns', 'Refund Value (INR)'],
      returnsOverTime.map(d => [d.label, d.returns, d.value]));

    addSheet(wb, 'Requested Method', ['Method', 'Count', 'Value (INR)', '% Share'],
      requestedMethodData.map(d => [d.label, d.count, d.value, parseFloat(pct(d.count, kpis.totalReturns).toFixed(1))]));

    const appliedTotal = appliedRefundData.reduce((s, x) => s + x.count, 0);
    addSheet(wb, 'Applied Refunds', ['Method', 'Count', 'Value (INR)', '% Share'],
      appliedRefundData.map(d => [d.label, d.count, d.value, parseFloat(pct(d.count, appliedTotal).toFixed(1))]));

    addSheet(wb, 'Return Reasons', ['Reason', 'Count', '% Share', 'Est. Value (INR)'],
      topReasons.map(r => [r.reason, r.count, parseFloat(r.percentage.toFixed(1)), r.totalValue]));

    addSheet(wb, 'Top Products', ['Title', 'SKU', 'Returns', 'Return Rate (%)', 'Value (INR)', 'Top Reason'],
      mostReturnedProducts.map(p => [
        p.title, p.sku, p.returnCount,
        parseFloat(pct(p.returnCount, kpis.totalReturns).toFixed(1)),
        p.totalValue,
        Object.keys(p.reasons)[0] || 'N/A',
      ]));

    addSheet(wb, 'Top Customers', ['Name', 'Email', 'Returns', 'Total Value (INR)', 'Repeat'],
      topReturningCustomers.map(c => [c.name, c.email, c.returnCount, c.totalValue, (c as any).isRepeat ? 'Yes' : 'No']));

    addSheet(wb, 'By Region', ['State', 'Returns', 'Total Value (INR)'],
      returnsByState.map(s => [s.state, s.returnCount, s.totalValue]));

    addSheet(wb, 'Raw Returns',
      [
        'RAN', 
        'Order ID', 
        'Customer Name', 
        'Email',
        'Return Type',
        'Expected Order Status',
        'Return Status', 
        'Refund Status', 
        'Requested Method', 
        'Applied Method', 
        'Total Product Value (INR)',
        'Shipping Refund Addition (INR)',
        'Restocking Fee Deducted (INR)',
        'Reverse Shipment Deducted (INR)',
        'Forward Shipment Deducted (INR)',
        'Adjustment Applied (INR)',
        'Taxes Deducted (INR)',
        'Final Refund Amount (INR)', 
        'Items Count', 
        'Item Details & Notes', 
        'Original Product Images',
        'Customer Uploaded Images',
        'Created At'
      ],
      filteredReturns.map(r => {
        const d = toDate(r.createdAt) || (r.submittedAt ? new Date(r.submittedAt) : null);
        
        // 1. Calculate Base Values and Deductions
        let baseValue = r.refundDetails?.baseAmount;
        if (baseValue === undefined) {
          baseValue = r.items?.reduce((sum: number, item: any) => sum + ((parseFloat((item.price || '0').toString().replace(/[^0-9.]/g, '')) || 0) * (item.quantityReturned || 1)), 0) || 0;
        }

        const shippingRefund = r.refundDetails?.shippingRefundAddition || 0;
        const deductions = r.refundDetails?.deductions || {};
        
        // 2. Format detailed item strings (using \n for Excel multi-line cells)
        const itemDetails = r.items?.map((i: any) => 
          `[${i.sku || 'No SKU'}] ${i.title} (Qty: ${i.quantityReturned}) | Reason: ${i.reason || 'N/A'} | Note: ${i.note || 'None'}`
        ).join('\n') || '';

        const originalImages = r.items?.map((i: any) => 
          i.productImage ? i.productImage : 'No original image'
        ).join('\n') || '';

        const customerImages = r.items?.map((i: any) => 
          i.customerImages && i.customerImages.length > 0 
            ? i.customerImages.join(' , ') 
            : 'No customer uploads'
        ).join('\n') || '';

        // 3. Determine Return Type and Expected Status based on saved metadata
        const returnType = r.returnType || r.refundDetails?.returnType || 'Unknown';
        let expectedStatus = 'Pending';
        if (returnType === 'Full Return') {
            expectedStatus = 'Cancelled, Refunded, Unfulfilled';
        } else if (returnType === 'Partial Return') {
            expectedStatus = 'Refunded, Partially Fulfilled';
        }

        return [
          (r as any).RAN || '', 
          r.orderId || '',
          r.customer?.name || '', 
          r.customer?.email || '',
          returnType,                                 // Appended: Full or Partial
          expectedStatus,                             // Appended: Expected Status text
          r.status || '', 
          r.refundStatus || '',
          r.requestedMethod || '',
          r.refundMethod || r.refundDetails?.method || '',
          baseValue,                                  // Total Product Value
          shippingRefund,                             // Shipping Addition
          deductions.restocking || 0,                 // Restocking Deduction
          deductions.reverseShipment || 0,            // Reverse Shipment Deduction
          deductions.forwardShipment || 0,            // Forward Shipment Deduction
          deductions.adjustment || 0,                 // Manual Adjustment
          deductions.taxes || 0,                      // Tax Deduction
          getAmt(r),                                  // Final Final Amount
          r.items?.length || 0,                       // Item count
          itemDetails,                                // Granular Details & Notes
          originalImages,                             // Shopify Images
          customerImages,                             // Firebase Images
          d ? d.toLocaleDateString('en-IN') : ''
        ];
      })
    );

    const safeName = dateRangeLabel.replace(/[^a-zA-Z0-9\- ]/g, '').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `Prashanti_Returns_${safeName}.xlsx`);
  };

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="flex justify-between">
          <div className="h-8 bg-slate-200 rounded w-48" />
          <div className="h-9 bg-slate-200 rounded w-44" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 h-28" />
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 h-64" />
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Analytics</h1>
            <p className="text-sm text-slate-500 mt-1">
              Insights to reduce returns and improve profits ·{' '}
              <span className="font-semibold text-slate-700">{allReturns.length}</span> total returns in DB
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Date range selector */}
            <div className="relative">
              <select
                value={dateRange === 'custom' ? 'custom' : dateRange}
                onChange={e => {
                  const v = e.target.value;
                  if (v === 'custom') {
                    setCustomStart(fmtIso(new Date(Date.now() - 30 * 86400000)));
                    setCustomEnd(fmtIso(new Date()));
                    setDateRange('custom');
                    setShowDatePicker(true);
                  } else {
                    setDateRange(v as any);
                  }
                }}
                className="appearance-none bg-white border border-slate-200 rounded-xl px-4 py-2 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="90days">Last 90 Days</option>
                <option value="year">Last Year</option>
                <option value="all">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>

            {/* Custom date picker trigger */}
            {dateRange === 'custom' && (
              <div className="relative" ref={datePickerRef}>
                <button
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-300 rounded-xl text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  <Calendar className="w-4 h-4" />{dateRangeLabel}
                </button>
                {showDatePicker && (
                  <CustomDateRangePicker
                    startDate={customStart} endDate={customEnd}
                    onChange={(s, e) => { setCustomStart(s); setCustomEnd(e); }}
                    onClose={() => setShowDatePicker(false)}
                  />
                )}
              </div>
            )}

            <button
              onClick={() => fetchData(true)} disabled={refreshing}
              className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium shadow-sm transition-colors"
            >
              <Download className="w-4 h-4" />Export Excel
            </button>
          </div>
        </div>

        {/* KPI Row 1 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Total Returns"
            value={formatNumber(kpis.totalReturns)}
            trendValue={dateRange !== 'all' ? `${kpis.completedReturns} completed` : undefined}
            trend={dateRange !== 'all' ? 'up' : undefined}
            icon={<Package className="w-6 h-6" />} color="blue" />
          <MetricCard title="Total Refund Value"  value={formatCurrency(kpis.totalRefundValue)}
            icon={<DollarSign className="w-6 h-6" />} color="emerald" />
          <MetricCard title="Unique Customers"    value={formatNumber(kpis.uniqueCustomers)}
            icon={<Users className="w-6 h-6" />} color="purple" />
          <MetricCard title="Avg Processing Time" value={`${kpis.avgProcessingTime}d`}
            trend={kpis.avgProcessingTime > 3 ? 'down' : 'up'}
            trendValue={kpis.avgProcessingTime > 3 ? 'Needs improvement' : 'On track'}
            icon={<Clock className="w-6 h-6" />} color="amber" />
        </div>

        {/* KPI Row 2 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Rejection Rate"    value={`${kpis.rejectionRate.toFixed(1)}%`}
            trend={kpis.rejectionRate > 10 ? 'down' : 'up'}
            trendValue={`${kpis.rejectedReturns} rejected`}
            icon={<XCircle className="w-6 h-6" />} color="red"
            highlight={kpis.rejectionRate > 10} />
          <MetricCard title="Pending Refunds"   value={formatNumber(kpis.pendingRefunds)}
            badge={kpis.pendingRefunds > 0
              ? { label: 'Needs action', variant: 'warn' }
              : { label: 'All clear',    variant: 'ok' }}
            icon={<AlertTriangle className="w-6 h-6" />} color="orange"
            highlight={kpis.pendingRefunds > 5} />
          <MetricCard title="Defective Item Rate" value={`${kpis.defectiveRate.toFixed(1)}%`}
            trend={kpis.defectiveRate > 20 ? 'down' : 'up'}
            trendValue={`${kpis.defectiveItems} of ${kpis.totalItems} items`}
            icon={<ShieldAlert className="w-6 h-6" />} color="pink" />
          <MetricCard title="Avg Items / Return" value={kpis.avgItemsPerReturn}
            badge={kpis.avgItemsPerReturn > 2
              ? { label: 'Bulk returns detected', variant: 'warn' }
              : undefined}
            icon={<Layers className="w-6 h-6" />} color="indigo" />
        </div>

        {/* Repeat returners banner */}
        {kpis.repeatReturners > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
              <Repeat className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">
                {kpis.repeatReturners} repeat returner{kpis.repeatReturners > 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                {kpis.repeatReturners} customer{kpis.repeatReturners > 1 ? 's have' : ' has'} 3+ returns in this period
              </p>
            </div>
            <span className="text-2xl font-bold text-amber-700 tabular-nums shrink-0">
              {kpis.repeatReturners}
            </span>
          </div>
        )}

        {/* Returns Over Time chart */}
        <ReturnsOverTimeChart
          data={returnsOverTime}
          granularity={chartGranularity}
          onGranularityChange={setChartGranularity}
        />

        {/* Actual Refunds Issued */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-bold text-slate-900 mb-5">Actual Refunds Issued by Method</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Store Credit',     icon: <Wallet     className="w-5 h-5" />, bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100' },
              { label: 'Gift Card',        icon: <Gift       className="w-5 h-5" />, bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-100' },
              { label: 'Original Payment', icon: <CreditCard className="w-5 h-5" />, bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-100' },
              { label: 'Manual',           icon: <DollarSign className="w-5 h-5" />, bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-100' },
            ].map((item, idx) => {
              const match = appliedRefundData.find(d => d.label === item.label) || { count: 0, value: 0 };
              return (
                <div key={idx} className={`${item.bg} border ${item.border} rounded-2xl p-4`}>
                  <div className={`${item.text} mb-3`}>{item.icon}</div>
                  <p className="text-xs font-semibold text-slate-500 mb-1">{item.label}</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">{formatCurrency(match.value)}</p>
                  <p className={`text-xs font-medium ${item.text} mt-1`}>{match.count} returns</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Revenue Saved + Top Reasons */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Saved */}
          <div className="bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-6 text-white shadow-xl">
            <h3 className="text-sm font-medium opacity-80 mb-2">Revenue Saved</h3>
            <p className="text-4xl font-bold mb-1 tabular-nums">{formatCurrency(kpis.revenueSaved)}</p>
            <p className="text-sm opacity-70 mb-5">Store credit + gift card refunds</p>
            <div className="space-y-3">
              {resolutionData.map((res, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="opacity-90">{res.type}</span>
                    <span className="font-medium tabular-nums">{res.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full transition-all duration-500"
                      style={{ width: `${res.percentage}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Reasons */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm lg:col-span-2">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Top Return Reasons</h3>
            <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
              {topReasons.slice(0, 6).map((reason, idx) => (
                <ProgressBar
                  key={idx} label={reason.reason} value={reason.count} percentage={reason.percentage}
                  color={(['blue', 'purple', 'orange', 'pink', 'indigo', 'amber'] as const)[idx] || 'blue'}
                />
              ))}
              {!topReasons.length && (
                <p className="text-slate-500 text-center py-8">No reason data yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Requested vs Applied */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RefundMethodComparison
            title="Requested Refund Method" data={requestedMethodData}
            icon={<TrendingUp className="w-4 h-4 text-indigo-600" />} colorScheme="bg-indigo-50"
          />
          <RefundMethodComparison
            title="Applied Refund Method" data={appliedRefundData}
            icon={<BarChart2 className="w-4 h-4 text-emerald-600" />} colorScheme="bg-emerald-50"
          />
        </div>

        {/* Most Returned Products */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Most Returned Products</h3>
            <p className="text-sm text-slate-500 mt-1">{dateRangeLabel}</p>
          </div>
          <DataTable
            headers={['Product', 'SKU', 'Returns', 'Return Rate', 'Return Value', 'Top Reason']}
            data={mostReturnedProducts}
            maxHeight="400px"
            renderRow={(product, idx) => (
              <tr key={idx} className="hover:bg-slate-50 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {product.image
                      ? <img src={product.image} alt={product.title} className="w-10 h-12 object-cover rounded-lg border border-slate-200" />
                      : <div className="w-10 h-12 bg-slate-100 rounded-lg flex items-center justify-center"><Package className="w-5 h-5 text-slate-400" /></div>}
                    <span className="text-sm font-medium text-slate-800 line-clamp-2">{product.title}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm font-mono text-slate-600">{product.sku}</td>
                <td className="py-3 px-4 text-sm font-semibold text-slate-900 tabular-nums">{product.returnCount}</td>
                <td className="py-3 px-4 text-sm text-slate-600 tabular-nums">{pct(product.returnCount, kpis.totalReturns).toFixed(1)}%</td>
                <td className="py-3 px-4 text-sm font-semibold text-emerald-600 tabular-nums">{formatCurrency(product.totalValue)}</td>
                <td className="py-3 px-4 text-sm text-slate-600">{Object.keys(product.reasons).slice(0, 2).join(', ') || 'N/A'}</td>
              </tr>
            )}
            emptyMessage="No product return data yet"
          />
        </div>

        {/* Customers + Region */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top customers */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Customers That Return The Most</h3>
              {kpis.repeatReturners > 0 && (
                <p className="text-xs text-amber-600 mt-1 font-medium">
                  🔁 {kpis.repeatReturners} repeat returner{kpis.repeatReturners > 1 ? 's' : ''} (3+ returns) flagged below
                </p>
              )}
            </div>
            <DataTable
              headers={['Customer', 'Returns', 'Value', 'Flag']}
              data={topReturningCustomers}
              maxHeight="400px"
              renderRow={(c, idx) => (
                <tr key={idx} className={`hover:bg-slate-50 transition-colors ${(c as any).isRepeat ? 'bg-amber-50/40' : ''}`}>
                  <td className="py-3 px-4">
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.email}</p>
                  </td>
                  <td className="py-3 px-4 text-sm font-semibold text-slate-900 tabular-nums">{c.returnCount}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-emerald-600 tabular-nums">{formatCurrency(c.totalValue)}</td>
                  <td className="py-3 px-4">
                    {(c as any).isRepeat
                      ? <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                          <Repeat className="w-3 h-3" />Repeat
                        </span>
                      : <span className="text-[10px] text-slate-400">—</span>}
                  </td>
                </tr>
              )}
              emptyMessage="No customer data yet"
            />
          </div>

          {/* By region */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Return Rate By Region</h3>
            </div>
            <DataTable
              headers={['State', 'Returns', 'Return Value']}
              data={returnsByState}
              maxHeight="400px"
              renderRow={(s, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-sm font-medium text-slate-800">{s.state}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-slate-900 tabular-nums">{s.returnCount}</td>
                  <td className="py-3 px-4 text-sm font-semibold text-emerald-600 tabular-nums">{formatCurrency(s.totalValue)}</td>
                </tr>
              )}
              emptyMessage="No regional data yet"
            />
          </div>
        </div>

        {/* Empty state */}
        {filteredReturns.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
            <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-amber-800 mb-2">No Data for {dateRangeLabel}</h3>
            <p className="text-amber-700">
              {allReturns.length > 0
                ? `You have ${allReturns.length} returns in total — try a wider date range.`
                : 'No returns have been submitted yet.'}
            </p>
          </div>
        )}

      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar       { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track  { background: #f1f1f1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb  { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
};