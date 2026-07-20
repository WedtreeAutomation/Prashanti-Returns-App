import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Package, Clock, CheckCircle, XCircle, Truck, CreditCard, ChevronRight, RefreshCw, ChevronDown,
  AlertTriangle, RotateCcw, TrendingUp, TrendingDown,
  Minus, ShoppingBag, ArrowRight, Zap, Calendar,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { Link } from 'react-router-dom';
import { ReturnRequest } from '../../Interfaces/types';

// ─── Date preset config ────────────────────────────────────────────────────────
type PresetKey =
  | 'today' | 'yesterday'
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'last_7' | 'last_30'
  | 'all'
  | 'custom';

const startOf = (d: Date, unit: 'day' | 'week' | 'month'): Date => {
  const r = new Date(d);
  if (unit === 'day')   { r.setHours(0, 0, 0, 0); }
  if (unit === 'week')  { r.setDate(d.getDate() - ((d.getDay() + 6) % 7)); r.setHours(0, 0, 0, 0); }
  if (unit === 'month') { r.setDate(1); r.setHours(0, 0, 0, 0); }
  return r;
};

const endOf = (d: Date, unit: 'day' | 'week' | 'month'): Date => {
  const r = new Date(d);
  if (unit === 'day')   { r.setHours(23, 59, 59, 999); }
  if (unit === 'week')  { r.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 6); r.setHours(23, 59, 59, 999); }
  if (unit === 'month') { r.setMonth(d.getMonth() + 1, 0); r.setHours(23, 59, 59, 999); }
  return r;
};

interface DatePreset { key: PresetKey; label: string; getRange: () => { start: Date; end: Date }; }

const DATE_PRESETS: DatePreset[] = [
  { key: 'today',      label: 'Today',        getRange: () => { const n = new Date(); return { start: startOf(n,'day'),   end: endOf(n,'day') }; } },
  { key: 'yesterday',  label: 'Yesterday',    getRange: () => { const n = new Date(); n.setDate(n.getDate()-1); return { start: startOf(n,'day'), end: endOf(n,'day') }; } },
  { key: 'this_week',  label: 'This Week',    getRange: () => { const n = new Date(); return { start: startOf(n,'week'),  end: endOf(n,'week') }; } },
  { key: 'last_week',  label: 'Last Week',    getRange: () => { const n = new Date(); n.setDate(n.getDate()-7); return { start: startOf(n,'week'), end: endOf(n,'week') }; } },
  { key: 'this_month', label: 'This Month',   getRange: () => { const n = new Date(); return { start: startOf(n,'month'), end: endOf(n,'month') }; } },
  { key: 'last_month', label: 'Last Month',   getRange: () => { const n = new Date(); n.setMonth(n.getMonth()-1); return { start: startOf(n,'month'), end: endOf(n,'month') }; } },
  { key: 'last_7',     label: 'Last 7 Days',  getRange: () => { const n = new Date(); const s = new Date(n); s.setDate(n.getDate()-6); s.setHours(0,0,0,0); return { start: s, end: endOf(n,'day') }; } },
  { key: 'last_30',    label: 'Last 30 Days', getRange: () => { const n = new Date(); const s = new Date(n); s.setDate(n.getDate()-29); s.setHours(0,0,0,0); return { start: s, end: endOf(n,'day') }; } },
  { key: 'all',        label: 'All Time',     getRange: () => ({ start: new Date(0), end: new Date() }) },
  { key: 'custom',     label: 'Custom Range', getRange: () => ({ start: new Date(), end: new Date() }) }, // Placeholder
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 })
    .format(n).replace('₹', '₹ ');

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  try {
    if (ts?.toDate)  return ts.toDate();
    if (ts?.seconds) return new Date(ts.seconds * 1000);
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
};

const timeAgo = (ts: any): string => {
  const d = toDate(ts); if (!d) return 'N/A';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff/60000); const h = Math.floor(diff/3600000); const dy = Math.floor(diff/86400000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy < 7) return `${dy}d ago`;
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
};

const getAmt = (r: ReturnRequest): number => {
  const a = Number(r.refundAmount);       if (a > 0) return a;
  const b = Number(r.refundDetails?.finalAmount); if (b > 0) return b;
  return 0;
};

const isInRange = (ts: any, start: Date, end: Date): boolean => {
  const d = toDate(ts); return d ? d >= start && d <= end : false;
};

const REJECTED_SET  = new Set(['denied','Denied']);
const COMPLETED_SET = new Set(['completed','Completed']);
const CANCELLED_SET = new Set(['Cancelled','cancelled','closed','Closed']);

const classifyStage = (r: ReturnRequest) => {
  if (COMPLETED_SET.has(r.status))   return 'completed';
  if (REJECTED_SET.has(r.status))    return 'rejected';
  if (CANCELLED_SET.has(r.status))   return 'cancelled';
  const ship = (r.shipmentStatus||'').toLowerCase();
  if (ship === 'item delivered')                          return 'delivered';
  if (ship === 'pickup created' || ship === 'in transit') return 'pickup';
  if ((r.status||'').toLowerCase() === 'approved')        return 'approved';
  return 'open';
};

// ─── Chart builder ─────────────────────────────────────────────────────────────
const buildChartData = (returns: ReturnRequest[], start: Date, end: Date, preset: PresetKey) => {
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);

  if (preset === 'today' || preset === 'yesterday') {
    const buckets = Array.from({length:12}, (_,i) => ({ label:`${i*2}:00`, count:0 }));
    returns.forEach(r => {
      const d = toDate(r.createdAt); if (!d || !isInRange(d,start,end)) return;
      buckets[Math.floor(d.getHours()/2)].count++;
    });
    return buckets;
  }

  if (diffDays <= 14) {
    const buckets: {label:string;date:Date;count:number}[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      buckets.push({ label: cur.toLocaleDateString('en-IN',{day:'numeric',month:'short'}), date: new Date(cur), count: 0 });
      cur.setDate(cur.getDate()+1);
    }
    returns.forEach(r => {
      const d = toDate(r.createdAt); if (!d || !isInRange(d,start,end)) return;
      const idx = Math.floor((d.getTime()-start.getTime())/86400000);
      if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
    });
    return buckets;
  }

  if (diffDays <= 90) {
    const buckets: {label:string;date:Date;count:number}[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      buckets.push({ label: cur.toLocaleDateString('en-IN',{day:'numeric',month:'short'}), date: new Date(cur), count: 0 });
      cur.setDate(cur.getDate()+7);
    }
    returns.forEach(r => {
      const d = toDate(r.createdAt); if (!d || !isInRange(d,start,end)) return;
      const weekIdx = Math.floor((d.getTime()-start.getTime())/(7*86400000));
      if (weekIdx >= 0 && weekIdx < buckets.length) buckets[weekIdx].count++;
    });
    return buckets;
  }

  // Monthly logic
  const buckets: {label:string;date:Date;count:number}[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    buckets.push({ label: cur.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}), date: new Date(cur), count: 0 });
    cur.setMonth(cur.getMonth()+1);
  }
  returns.forEach(r => {
    const d = toDate(r.createdAt); if (!d || !isInRange(d,start,end)) return;
    const yearDiff = d.getFullYear() - start.getFullYear();
    const monthDiff = d.getMonth() - start.getMonth();
    const idx = (yearDiff * 12) + monthDiff;
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
  });
  return buckets;
};

// ─── Small components ──────────────────────────────────────────────────────────
const Trend = ({ current, previous, show = true }: {current:number; previous:number; show?: boolean}) => {
  if (!show) return <span className="text-[10px] text-slate-400">—</span>;
  if (previous === 0 && current === 0) return <span className="text-[10px] text-slate-400">—</span>;
  if (previous === 0) return <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-0.5"><TrendingUp className="w-3 h-3"/>New</span>;
  const diff = current - previous;
  const pct  = Math.abs(Math.round((diff/previous)*100));
  if (diff === 0) return <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Minus className="w-3 h-3"/>Same</span>;
  return (
    <span className={`text-[10px] font-medium flex items-center gap-0.5 ${diff > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
      {diff > 0 ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
      {pct}% vs prior period
    </span>
  );
};

const ChartTooltip = ({active, payload, label}: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p:any, i:number) => (
        <p key={i} style={{color:p.color}} className="font-medium">{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

const ACTIVITY_STYLE: Record<string,{bg:string;icon:React.ReactNode}> = {
  return_submitted: { bg:'bg-blue-100 text-blue-600',      icon:<Package    className="w-3.5 h-3.5"/> },
  pickup_created:   { bg:'bg-indigo-100 text-indigo-600',  icon:<Truck      className="w-3.5 h-3.5"/> },
  item_received:    { bg:'bg-emerald-100 text-emerald-600',icon:<CheckCircle className="w-3.5 h-3.5"/> },
  refund_issued:    { bg:'bg-green-100 text-green-600',    icon:<CreditCard className="w-3.5 h-3.5"/> },
  return_rejected:  { bg:'bg-red-100 text-red-600',        icon:<XCircle    className="w-3.5 h-3.5"/> },
};

const SLA_DAYS = 14;

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════
export const Home = () => {
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allReturns, setAllReturns] = useState<ReturnRequest[]>([]);
  const [preset, setPreset]         = useState<PresetKey>('all');
  const [showPresets, setShowPresets] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
  const dropRef = useRef<HTMLDivElement>(null);
  const customPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e:MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowPresets(false);
      if (customPickerRef.current && !customPickerRef.current.contains(e.target as Node)) setShowCustomPicker(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const snap = await getDocs(query(collection(db,'returns'), orderBy('createdAt','desc')));
      setAllReturns(snap.docs.map(d => ({id:d.id,...d.data()})) as ReturnRequest[]);
    } catch(e) { console.error('Home fetchData', e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  // Handle custom range selection
  const applyCustomRange = () => {
    if (customStartDate && customEndDate && customStartDate <= customEndDate) {
      setPreset('custom');
      setShowCustomPicker(false);
      setShowPresets(false);
    }
  };

  // Get current range based on preset
  const { curStart, curEnd, prevStart, prevEnd } = useMemo(() => {
    if (preset === 'all') {
      let s = new Date();
      allReturns.forEach(r => {
        const d = toDate(r.createdAt);
        if (d && d < s) s = d;
      });
      const earliest = new Date(s.getFullYear(), s.getMonth(), 1);
      return {
        curStart: earliest, curEnd: new Date(),
        prevStart: new Date(0), prevEnd: new Date(0)
      };
    }
    
    if (preset === 'custom') {
      // For custom range, no prior period comparison
      return {
        curStart: customStartDate,
        curEnd: customEndDate,
        prevStart: new Date(0),
        prevEnd: new Date(0)
      };
    }
    
    const { start, end } = DATE_PRESETS.find(p => p.key === preset)!.getRange();
    const span = end.getTime() - start.getTime();
    return {
      curStart: start, curEnd: end,
      prevStart: new Date(start.getTime() - span - 1),
      prevEnd:   new Date(start.getTime() - 1),
    };
  }, [preset, allReturns, customStartDate, customEndDate]);

  const curReturns  = useMemo(() => allReturns.filter(r => isInRange(r.createdAt, curStart, curEnd)),   [allReturns,curStart,curEnd]);
  const prevReturns = useMemo(() => allReturns.filter(r => isInRange(r.createdAt, prevStart, prevEnd)), [allReturns,prevStart,prevEnd]);

  // ── KPIs (Optimized to Single O(N) Loop) ───────────────────────────────────
  const kpis = useMemo(() => {
    const calc = (arr: ReturnRequest[]) => {
      let open = 0, approved = 0, pickup = 0, delivered = 0, completed = 0;
      let rejected = 0, cancelled = 0, refunded = 0, refundValue = 0;
      
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        const stage = classifyStage(r);
        
        if (stage === 'open') open++;
        if (stage === 'approved' || stage === 'pickup' || stage === 'delivered') approved++;
        if (stage === 'pickup') pickup++;
        if (stage === 'delivered') delivered++;
        if (stage === 'completed') completed++;
        
        if (REJECTED_SET.has(r.status)) rejected++;
        if (CANCELLED_SET.has(r.status)) cancelled++;
        
        if (r.refundStatus === 'Refunded') {
          refunded++;
          refundValue += getAmt(r);
        }
      }
      return { total: arr.length, open, approved, pickup, delivered, completed, rejected, cancelled, refunded, refundValue };
    };
    return { cur: calc(curReturns), prev: calc(prevReturns) };
  }, [curReturns, prevReturns]);

  // ── Today KPIs (always today regardless of filter) ─────────────────────────
  const todayKpis = useMemo(() => {
    const {start,end} = DATE_PRESETS.find(p => p.key==='today')!.getRange();
    let submitted = 0, refunds = 0, refundAmount = 0;

    for (let i = 0; i < allReturns.length; i++) {
      const r = allReturns[i];
      if (isInRange(r.createdAt, start, end)) submitted++;
      if (r.refundStatus === 'Refunded' && (isInRange(r.refundedAt, start, end) || isInRange(r.completedAt, start, end))) {
        refunds++;
        refundAmount += getAmt(r);
      }
    }
    return { submitted, refunds, refundAmount };
  }, [allReturns]);

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = useMemo(() =>
    buildChartData(allReturns, curStart, curEnd, preset),
  [allReturns, curStart, curEnd, preset]);

  // ── Status distribution ────────────────────────────────────────────────────
  const statusDist = useMemo(() => [
    { name:'Open',      value:kpis.cur.open,       color:'#f59e0b' },
    { name:'Pickup',    value:kpis.cur.pickup,     color:'#6366f1' },
    { name:'Delivered', value:kpis.cur.delivered,  color:'#8b5cf6' },
    { name:'Completed', value:kpis.cur.completed,  color:'#10b981' },
    { name:'Rejected',  value:kpis.cur.rejected,   color:'#ef4444' },
    { name:'Cancelled', value:kpis.cur.cancelled,  color:'#94a3b8' },
  ].filter(d => d.value > 0), [kpis]);

  // ── Today's activity feed (always today) ──────────────────────────────────
  const todayActivities = useMemo(() => {
    const {start,end} = DATE_PRESETS.find(p => p.key==='today')!.getRange();
    const acts: {id:string;RAN:string;orderId:string;type:string;title:string;description:string;timestamp:any;amount?:number}[] = [];

    allReturns.forEach(ret => {
      const add = (ts:any, type:string, title:string, desc:string, amt?:number) => {
        if (isInRange(ts,start,end))
          acts.push({id:`${ret.id}-${type}`,RAN:ret.RAN,orderId:ret.orderId,type,title,description:desc,timestamp:ts,amount:amt});
      };
      add(ret.createdAt,'return_submitted','Return Submitted',`${ret.items?.length||0} item(s) · ${ret.customer?.name||''}`,getAmt(ret)||undefined);
      add(ret.receivedAt,'item_received','Items Received',`${ret.items?.length||0} item(s) at warehouse`,getAmt(ret)||undefined);
      if (ret.refundStatus==='Refunded')
        add(ret.refundedAt||ret.completedAt,'refund_issued',
          `Refund · ${(ret.refundMethod||ret.requestedMethod||'').replace(/_/g,' ')}`,
          formatCurrency(getAmt(ret)), getAmt(ret)||undefined);
      if (ret.awb)
        add((ret as any).awbCreatedAt||ret.updatedAt,'pickup_created','Pickup Scheduled',`AWB: ${ret.awb}`);
      if (REJECTED_SET.has(ret.status||''))
        add(ret.updatedAt,'return_rejected','Return Rejected',ret.rejectionReason||'No reason');
    });

    return acts
      .sort((a,b) => (toDate(b.timestamp)?.getTime()??0)-(toDate(a.timestamp)?.getTime()??0))
      .slice(0,25);
  }, [allReturns]);

  // ── SLA breaches (always all-time) ────────────────────────────────────────
  const slaBreaches = useMemo(() =>
    allReturns.filter(r => {
      const d = toDate(r.createdAt); if (!d) return false;
      return classifyStage(r)==='open' && Math.floor((Date.now()-d.getTime())/86400000) > SLA_DAYS;
    }),
  [allReturns]);

  // ── Awaiting restock (always all-time) ────────────────────────────────────
  const awaitingRestock = useMemo(() =>
    allReturns.filter(r =>
      (r.shipmentStatus||'').toLowerCase()==='item delivered' &&
      !(r as any).isRestocked &&
      !COMPLETED_SET.has(r.status)
    ),
  [allReturns]);

  // ── Top product this week ──────────────────────────────────────────────────
  const topProduct = useMemo(() => {
    const {start} = DATE_PRESETS.find(p=>p.key==='this_week')!.getRange();
    const map = new Map<string,{title:string;count:number;sku:string}>();
    allReturns.forEach(r => {
      const d = toDate(r.createdAt); if (!d||d<start) return;
      r.items?.forEach((item:any) => {
        const key = (item.sku&&item.sku!=='N/A') ? item.sku : item.title;
        if (!key) return;
        const ex = map.get(key)||{title:item.title||key,count:0,sku:item.sku||''};
        map.set(key,{...ex,count:ex.count+(item.quantityReturned||1)});
      });
    });
    return map.size ? Array.from(map.values()).sort((a,b)=>b.count-a.count)[0] : null;
  }, [allReturns]);

  const activePreset = DATE_PRESETS.find(p=>p.key===preset)!;
  
  // Get display label for custom range
  const getCustomRangeLabel = () => {
    if (preset !== 'custom') return activePreset.label;
    return `${customStartDate.toLocaleDateString('en-IN')} - ${customEndDate.toLocaleDateString('en-IN')}`;
  };
  
  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-5 animate-pulse">
        <div className="flex justify-between items-center">
          <div className="space-y-2"><div className="h-7 bg-slate-200 rounded w-48"/><div className="h-4 bg-slate-200 rounded w-64"/></div>
          <div className="h-9 bg-slate-200 rounded w-44"/>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_,i)=><div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 h-32"/>)}
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_,i)=><div key={i} className="bg-white rounded-xl border border-slate-200 p-4 h-20"/>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 h-72"/>
          <div className="bg-white rounded-2xl border border-slate-200 h-72"/>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[...Array(2)].map((_,i)=><div key={i} className="bg-white rounded-2xl border border-slate-200 h-48"/>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 h-96"/>
          <div className="bg-white rounded-2xl border border-slate-200 h-96"/>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={dropRef}>
              <button onClick={()=>setShowPresets(!showPresets)}
                className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-colors">
                {getCustomRangeLabel()}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showPresets?'rotate-180':''}`}/>
              </button>
              {showPresets && (
                <div className="absolute top-full right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 p-2 w-56">
                  {DATE_PRESETS.map(p => (
                    p.key !== 'custom' ? (
                      <button key={p.key} onClick={()=>{setPreset(p.key);setShowPresets(false);}}
                        className={`w-full text-left px-3 py-2 text-sm rounded-xl transition-colors ${
                          preset===p.key ? 'bg-slate-900 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'
                        }`}>
                        {p.label}
                      </button>
                    ) : (
                      <button key="custom" onClick={()=>{setShowCustomPicker(true);setShowPresets(false);}}
                        className={`w-full text-left px-3 py-2 text-sm rounded-xl transition-colors ${
                          preset==='custom' ? 'bg-slate-900 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'
                        }`}>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4"/>
                          Custom Range
                        </div>
                      </button>
                    )
                  ))}
                </div>
              )}
            </div>
            <button onClick={()=>fetchData(true)} disabled={refreshing}
              className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-50 shadow-sm">
              <RefreshCw className={`w-4 h-4 ${refreshing?'animate-spin':''}`}/>
            </button>
          </div>
        </div>

        {/* Custom Date Range Picker Modal */}
        {showCustomPicker && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowCustomPicker(false)}>
            <div ref={customPickerRef} className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 mb-4">Select Custom Range</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={customStartDate.toISOString().split('T')[0]}
                    onChange={(e) => setCustomStartDate(new Date(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
                  <input
                    type="date"
                    value={customEndDate.toISOString().split('T')[0]}
                    onChange={(e) => setCustomEndDate(new Date(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowCustomPicker(false)}
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyCustomRange}
                    disabled={customStartDate > customEndDate}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Apply Range
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Row 1: 4 primary KPI cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {([
            {
              title:'Returns Received',
              value: kpis.cur.total,
              prev:  kpis.prev.total,
              sub:   `${todayKpis.submitted} submitted today`,
              icon:  <Package className="w-5 h-5"/>,
              accent:'bg-blue-50 text-blue-600',
              glow:  'from-blue-400 to-indigo-500',
            },
            {
              title:'Approved / In Progress',
              value: kpis.cur.approved,
              prev:  kpis.prev.approved,
              sub:   `${kpis.cur.pickup} pickup · ${kpis.cur.delivered} delivered`,
              icon:  <CheckCircle className="w-5 h-5"/>,
              accent:'bg-emerald-50 text-emerald-600',
              glow:  'from-emerald-400 to-teal-500',
            },
            {
              title:'Rejected / Closed',
              value: kpis.cur.rejected + kpis.cur.cancelled,
              prev:  kpis.prev.rejected + kpis.prev.cancelled,
              sub:   `${kpis.cur.rejected} denied · ${kpis.cur.cancelled} closed`,
              icon:  <XCircle className="w-5 h-5"/>,
              accent:'bg-red-50 text-red-600',
              glow:  'from-red-400 to-rose-500',
            },
            {
              title:'Completed',
              value: kpis.cur.completed,
              prev:  kpis.prev.completed,
              sub:   formatCurrency(kpis.cur.refundValue) + ' refunded',
              icon:  <CreditCard className="w-5 h-5"/>,
              accent:'bg-violet-50 text-violet-600',
              glow:  'from-violet-400 to-purple-500',
            },
          ] as const).map((card, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all overflow-hidden relative group flex flex-col">
              <div className={`absolute -top-10 -right-10 w-24 h-24 bg-gradient-to-br ${card.glow} opacity-0 group-hover:opacity-10 rounded-full blur-2xl transition-opacity`}/>
              
              <div className="relative flex-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight pr-2">{card.title}</p>
                  <div className={`p-1.5 rounded-lg shrink-0 ${card.accent}`}>{card.icon}</div>
                </div>
                <p className="text-3xl font-bold text-slate-900 tabular-nums">{card.value}</p>
              </div>

              <div className="relative flex items-center justify-between mt-2 pt-2 border-t border-slate-50 gap-2 flex-wrap">
                <p className="text-xs text-slate-400 truncate">{card.sub}</p>
                <Trend current={card.value} previous={card.prev} show={preset !== 'all' && preset !== 'custom'}/>
              </div>
            </div>
          ))}
        </div>

        {/* ── Row 2: 6 secondary mini-KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label:'Open',             value:kpis.cur.open,         color:'text-amber-700',   bg:'bg-amber-50 border-amber-100' },
            { label:'Pickup Created',   value:kpis.cur.pickup,       color:'text-indigo-700',  bg:'bg-indigo-50 border-indigo-100' },
            { label:'Item Delivered',   value:kpis.cur.delivered,    color:'text-purple-700',  bg:'bg-purple-50 border-purple-100' },
            { label:'Refunds Issued',   value:kpis.cur.refunded,     color:'text-emerald-700', bg:'bg-emerald-50 border-emerald-100' },
            { label:'Submitted Today',  value:todayKpis.submitted,   color:'text-blue-700',    bg:'bg-blue-50 border-blue-100' },
            { label:"Today's Refunds",  value:todayKpis.refunds,     color:'text-green-700',   bg:'bg-green-50 border-green-100',
              sub: formatCurrency(todayKpis.refundAmount) },
          ].map((item,i) => (
            <div key={i} className={`rounded-xl border p-3 ${item.bg}`}>
              <p className={`text-[10px] font-semibold ${item.color} opacity-70 mb-1 leading-snug`}>{item.label}</p>
              <p className={`text-2xl font-bold ${item.color} tabular-nums`}>{item.value}</p>
              {(item as any).sub && (
                <p className={`text-[10px] font-medium ${item.color} opacity-60 mt-0.5 truncate`}>{(item as any).sub}</p>
              )}
            </div>
          ))}
        </div>

        {/* ── Row 3: Volume chart + Status distribution ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Volume chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Returns Volume</h2>
                <p className="text-xs text-slate-400 mt-0.5">{getCustomRangeLabel()}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-900 tabular-nums">{kpis.cur.total}</p>
                <Trend current={kpis.cur.total} previous={kpis.prev.total} show={preset !== 'all' && preset !== 'custom'}/>
              </div>
            </div>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data for this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{top:4,right:4,left:-24,bottom:0}}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                  <XAxis dataKey="label" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                  <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} allowDecimals={false}/>
                  <Tooltip content={<ChartTooltip/>}/>
                  <Area type="monotone" dataKey="count" name="Returns" stroke="#6366f1" strokeWidth={2.5}
                    fill="url(#volGrad)" dot={false} activeDot={{r:5,fill:'#6366f1',strokeWidth:0}}/>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Status distribution */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">By Status</h2>
            <p className="text-xs text-slate-400 mb-4">{getCustomRangeLabel()}</p>

            {statusDist.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data</div>
            ) : (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden mb-5 bg-slate-100">
                  {statusDist.map((d,i) => (
                    <div key={i} className="h-full transition-all duration-500"
                      style={{width:`${(d.value/kpis.cur.total)*100}%`,background:d.color}}/>
                  ))}
                </div>
                <div className="space-y-2.5">
                  {statusDist.map((d,i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{background:d.color}}/>
                        <span className="text-sm text-slate-600">{d.name}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{width:`${(d.value/kpis.cur.total)*100}%`,background:d.color}}/>
                        </div>
                        <span className="text-sm font-bold text-slate-900 tabular-nums w-5 text-right">{d.value}</span>
                        <span className="text-[10px] text-slate-400 w-9 text-right tabular-nums">
                          {((d.value/kpis.cur.total)*100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2">
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                    <p className="text-[10px] text-emerald-600 font-semibold mb-0.5">Approval Rate</p>
                    <p className="text-xl font-bold text-emerald-700 tabular-nums">
                      {kpis.cur.total > 0 ? `${Math.round((kpis.cur.approved/kpis.cur.total)*100)}%` : '—'}
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                    <p className="text-[10px] text-red-600 font-semibold mb-0.5">Rejection Rate</p>
                    <p className="text-xl font-bold text-red-700 tabular-nums">
                      {kpis.cur.total > 0 ? `${Math.round(((kpis.cur.rejected+kpis.cur.cancelled)/kpis.cur.total)*100)}%` : '—'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Row 4: Refund methods + Approved vs Rejected ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Refund methods chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-900 mb-5">Requested Refund Methods</h2>
            {(() => {
              const data = [
                {name:'Store Credit', count:curReturns.filter(r=>r.requestedMethod==='store_credit').length, color:'#10b981'},
                {name:'Gift Card',    count:curReturns.filter(r=>r.requestedMethod==='gift_card').length,    color:'#8b5cf6'},
                {name:'Original Pay', count:curReturns.filter(r=>r.requestedMethod==='refund'||!r.requestedMethod).length, color:'#3b82f6'},
              ].filter(d=>d.count>0);
              if (!data.length) return <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data for this period</div>;
              return (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={data} layout="vertical" margin={{left:8,right:32,top:0,bottom:0}}>
                    <XAxis type="number" tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} allowDecimals={false}/>
                    <YAxis type="category" dataKey="name" tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false} width={90}/>
                    <Tooltip content={<ChartTooltip/>} cursor={{fill:'#f8fafc'}}/>
                    <Bar dataKey="count" name="Returns" radius={[0,4,4,0]}>
                      {data.map((d,i)=><Cell key={i} fill={d.color}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Approved vs Rejected */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">Approved vs Rejected</h2>
            <p className="text-xs text-slate-400 mb-5">{getCustomRangeLabel()}</p>
            {(() => {
              const approvedN = kpis.cur.approved + kpis.cur.completed;
              const rejectedN = kpis.cur.rejected + kpis.cur.cancelled;
              const total = approvedN + rejectedN || 1;
              const data = [
                {name:'Approved', value:approvedN, color:'#10b981'},
                {name:'Rejected', value:rejectedN, color:'#ef4444'},
              ];
              return (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={data} margin={{left:0,right:16,top:0,bottom:0}}>
                      <XAxis dataKey="name" tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:'#94a3b8'}} axisLine={false} tickLine={false} allowDecimals={false}/>
                      <Tooltip content={<ChartTooltip/>} cursor={{fill:'#f8fafc'}}/>
                      <Bar dataKey="value" name="Count" radius={[4,4,0,0]}>
                        {data.map((d,i)=><Cell key={i} fill={d.color}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500 transition-all" style={{width:`${(approvedN/total)*100}%`}}/>
                      <div className="h-full bg-red-500 transition-all"     style={{width:`${(rejectedN/total)*100}%`}}/>
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap tabular-nums shrink-0">
                      {approvedN} : {rejectedN}
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* ── Row 5: Activity + Alerts ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Today's activity */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Today's Activity</h2>
                <p className="text-xs text-slate-400 mt-0.5">{todayActivities.length} event{todayActivities.length!==1?'s':''} today</p>
              </div>
              <Link to="/returns" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
                All returns <ChevronRight className="w-3.5 h-3.5"/>
              </Link>
            </div>
            <div className="divide-y divide-slate-50 max-h-[420px] overflow-y-auto custom-scrollbar">
              {todayActivities.length > 0 ? todayActivities.map(act => {
                const style = ACTIVITY_STYLE[act.type] || ACTIVITY_STYLE.return_rejected;
                return (
                  <div key={act.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                    <div className={`p-2 rounded-xl ${style.bg} shrink-0 mt-0.5`}>{style.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800 truncate capitalize">{act.title}</p>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">{timeAgo(act.timestamp)}</span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{act.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{act.RAN}</span>
                        {act.amount && act.amount > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-600">{formatCurrency(act.amount)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                    <Clock className="w-6 h-6 text-slate-400"/>
                  </div>
                  <p className="text-sm font-medium text-slate-500">No activity today</p>
                  <p className="text-xs text-slate-400 mt-1">New returns will appear here</p>
                </div>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">

            {/* SLA Breach */}
            {slaBreaches.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0"/>
                  <div>
                    <p className="text-sm font-bold text-red-800">SLA Breached</p>
                    <p className="text-[10px] text-red-600 leading-snug">
                      {slaBreaches.length} return{slaBreaches.length>1?'s':''} open &gt;{SLA_DAYS} days — no pickup created yet
                    </p>
                  </div>
                </div>
                <div className="p-3 max-h-52 overflow-y-auto custom-scrollbar space-y-2">
                  {slaBreaches.slice(0,5).map(r => {
                    const d = toDate(r.createdAt);
                    const days = d ? Math.floor((Date.now()-d.getTime())/86400000) : 0;
                    return (
                      <Link key={r.id} to={`/returns/${r.orderId}`}
                        className="flex items-center justify-between p-2.5 bg-red-50 rounded-xl border border-red-100 hover:bg-red-100 transition-colors">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-red-800 truncate">{r.RAN}</p>
                          <p className="text-[10px] text-red-600 truncate">{r.customer?.name} · {r.orderId}</p>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <p className="text-xs font-bold text-red-700">{days}d</p>
                          <p className="text-[10px] text-red-500">overdue</p>
                        </div>
                      </Link>
                    );
                  })}
                  {slaBreaches.length > 5 && (
                    <p className="text-[10px] text-center text-red-500 py-1">+{slaBreaches.length-5} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Awaiting restock */}
            {awaitingRestock.length > 0 && (
              <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-amber-600 shrink-0"/>
                  <div>
                    <p className="text-sm font-bold text-amber-800">Awaiting Restock</p>
                    <p className="text-[10px] text-amber-600">{awaitingRestock.length} delivered but not restocked</p>
                  </div>
                </div>
                <div className="p-3 max-h-44 overflow-y-auto custom-scrollbar space-y-2">
                  {awaitingRestock.slice(0,4).map(r => (
                    <Link key={r.id} to={`/returns/${r.orderId}`}
                      className="flex items-center justify-between p-2.5 bg-amber-50 rounded-xl border border-amber-100 hover:bg-amber-100 transition-colors">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-amber-800 truncate">{r.RAN}</p>
                        <p className="text-[10px] text-amber-600">{r.items?.length||0} item(s) ready</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-amber-500 shrink-0"/>
                    </Link>
                  ))}
                  {awaitingRestock.length > 4 && (
                    <p className="text-[10px] text-center text-amber-500 py-1">+{awaitingRestock.length-4} more</p>
                  )}
                </div>
              </div>
            )}

            {/* Today's refunds dark card */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white shadow-xl">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-white/10 rounded-lg">
                  <Zap className="w-4 h-4 text-emerald-400"/>
                </div>
                <p className="text-xs font-semibold opacity-70">Today's Refunds Processed</p>
              </div>
              {todayKpis.refunds > 0 ? (
                <>
                  <p className="text-3xl font-bold tabular-nums">{formatCurrency(todayKpis.refundAmount)}</p>
                  <p className="text-xs text-emerald-400 font-medium mt-1">
                    {todayKpis.refunds} refund{todayKpis.refunds!==1?'s':''} completed
                  </p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold opacity-30 tabular-nums">₹ 0</p>
                  <p className="text-xs opacity-40 mt-1">No refunds processed today</p>
                </>
              )}
              <div className="mt-4 pt-3 border-t border-white/10 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="opacity-60">Submitted today</span>
                  <span className="font-bold">{todayKpis.submitted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">SLA breaches</span>
                  <span className={`font-bold ${slaBreaches.length>0?'text-red-400':'text-emerald-400'}`}>
                    {slaBreaches.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">Awaiting restock</span>
                  <span className={`font-bold ${awaitingRestock.length>0?'text-amber-400':'text-emerald-400'}`}>
                    {awaitingRestock.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Top product this week */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-indigo-50 rounded-lg">
                  <ShoppingBag className="w-4 h-4 text-indigo-600"/>
                </div>
                <p className="text-sm font-bold text-slate-800">Top Returned · This Week</p>
              </div>
              {topProduct ? (
                <>
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 mb-3">
                    <p className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug mb-2">{topProduct.title}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Returns this week</span>
                      <span className="text-xl font-bold text-indigo-600 tabular-nums">{topProduct.count}</span>
                    </div>
                    {topProduct.sku && topProduct.sku !== 'N/A' && (
                      <p className="text-[10px] text-slate-400 font-mono mt-1">SKU: {topProduct.sku}</p>
                    )}
                  </div>
                  <Link to="/analytics" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                    Full breakdown <ArrowRight className="w-3 h-3"/>
                  </Link>
                </>
              ) : (
                <div className="flex flex-col items-center py-6 text-center">
                  <ShoppingBag className="w-7 h-7 text-slate-300 mb-1.5"/>
                  <p className="text-xs text-slate-400">No returns this week yet</p>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar       { width:5px; height:5px; }
        .custom-scrollbar::-webkit-scrollbar-track  { background:#f8fafc; border-radius:10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb  { background:#cbd5e1; border-radius:10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background:#94a3b8; }
      `}</style>
    </div>
  );
};