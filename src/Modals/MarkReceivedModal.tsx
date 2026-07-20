import React, { useEffect, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Package, PackageX } from 'lucide-react';
import { MarkReceivedModalProps, MarkReceivedItemDecision } from '../Interfaces/types';
import { notifyReturnReceived } from '../Interfaces/api';

const CONDITIONS = [
  { value: 'Fresh', label: 'Fresh', description: 'Like new, unused condition' },
  { value: 'Seconds', label: 'Seconds', description: 'Minor defects, slightly used' },
  { value: 'Defect / Damaged Item', label: 'Defect / Damaged', description: 'Significant damage, cannot be resold' }
];

interface ItemState {
  condition: string;
  restock: boolean;
  restockQty: number;
}

export const MarkReceivedModal: React.FC<MarkReceivedModalProps> = ({
  isOpen, onClose, onConfirm, items = [], RAN = '', orderId = '',
  customerName = '', customerEmail = '', requestedMethod = 'store_credit'
}) => {
  const [itemStates, setItemStates] = useState<Record<number, ItemState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset per-item state whenever the modal opens with a fresh item list
  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<number, ItemState> = {};
    items.forEach(item => {
      initial[item.lineItemId] = { condition: '', restock: false, restockQty: item.quantityReturned || 0 };
    });
    setItemStates(initial);
    setError('');
  }, [isOpen, items]);

  if (!isOpen) return null;

  const updateItemState = (lineItemId: number, patch: Partial<ItemState>) => {
    setItemStates(prev => ({ ...prev, [lineItemId]: { ...prev[lineItemId], ...patch } }));
  };

  const allConditionsSelected = items.length > 0 && items.every(item => !!itemStates[item.lineItemId]?.condition);

  const totalItems = items.reduce((sum, item) => sum + (item.quantityReturned || 0), 0);
  const totalValue = items.reduce((sum, item) => {
    const price = parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0');
    return sum + (price * (item.quantityReturned || 0));
  }, 0);
  const totalToRestock = items.reduce((sum, item) => {
    const state = itemStates[item.lineItemId];
    return sum + (state?.restock ? (state.restockQty || 0) : 0);
  }, 0);

  const handleSubmit = async () => {
    if (!allConditionsSelected) {
      setError('Please select a condition for every item');
      return;
    }

    const decisions: MarkReceivedItemDecision[] = items.map(item => {
      const state = itemStates[item.lineItemId];
      return {
        lineItemId: item.lineItemId,
        condition: state.condition,
        restock: state.restock,
        restockQuantity: state.restock ? Math.min(Math.max(state.restockQty || 0, 0), item.quantityReturned) : 0
      };
    });

    setLoading(true);
    setError('');

    try {
      await onConfirm(decisions);

      if (customerEmail && items.length > 0) {
        try {
          const uniqueConditions = Array.from(new Set(decisions.map(d => d.condition)));
          const overallCondition = uniqueConditions.length === 1 ? uniqueConditions[0] : 'Mixed';

          await notifyReturnReceived({
            RAN, orderId,
            customer: { name: customerName || 'Customer', email: customerEmail },
            items,
            requestedMethod,
            itemCondition: overallCondition,
            restockInfo: {
              restocked: decisions.some(d => d.restock && d.restockQuantity > 0),
              totalQuantityRestocked: decisions.reduce((sum, d) => sum + (d.restock ? d.restockQuantity : 0), 0)
            }
          });
        } catch (emailError) {
          console.error('Failed to send return received email:', emailError);
        }
      }

      setItemStates({});
      onClose();
    } catch (err) {
      console.error('Error in mark received:', err);
      setError('Failed to process. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { setItemStates({}); setError(''); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white z-10 flex justify-between items-center p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Mark as Received</h2>
              <p className="text-xs text-slate-500 mt-0.5">Set condition & restock per item</p>
            </div>
          </div>
          <button onClick={handleClose} disabled={loading} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {RAN && (
            <div className="mb-4 pb-3 border-b border-slate-100">
              <p className="text-xs text-slate-500">Return Authorization Number</p>
              <p className="text-sm font-mono font-semibold text-indigo-600">{RAN}</p>
            </div>
          )}

          {(orderId || customerName || customerEmail) && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              {orderId && <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Order ID:</span><span className="font-medium text-slate-700">{orderId}</span></div>}
              {customerName && <div className="flex justify-between text-xs mb-1"><span className="text-slate-500">Customer:</span><span className="font-medium text-slate-700">{customerName}</span></div>}
              {customerEmail && <div className="flex justify-between text-xs"><span className="text-slate-500">Email:</span><span className="font-medium text-slate-700 truncate max-w-[200px]">{customerEmail}</span></div>}
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {(!items || items.length === 0) ? (
            <div className="mb-6 bg-amber-50 rounded-xl p-4 border border-amber-200">
              <div className="flex items-start gap-3">
                <PackageX className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">No Items to Process</p>
                  <p className="text-xs text-amber-700 mt-1">All items in this return have been rejected or there are no active items to mark as received.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-700">Items to Receive</h3>
                </div>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{items.length} item{items.length !== 1 ? 's' : ''}</span>
              </div>

              {items.map((item) => {
                const state = itemStates[item.lineItemId] || { condition: '', restock: false, restockQty: item.quantityReturned };
                return (
                  <div key={item.lineItemId} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800 line-clamp-2">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">SKU: {item.sku || 'N/A'}</p>
                      </div>
                      <span className="inline-flex items-center justify-center bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-1 rounded-full min-w-[50px]">
                        Qty: {item.quantityReturned}
                      </span>
                    </div>

                    {item.reason && (
                      <p className="text-[10px] text-slate-400 pb-1 border-b border-slate-100">
                        <span className="font-medium">Return Reason:</span> {item.reason}
                      </p>
                    )}

                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-2">Condition <span className="text-red-500">*</span></p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {CONDITIONS.map(cond => (
                          <label key={cond.value} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${state.condition === cond.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                            <input
                              type="radio"
                              name={`condition-${item.lineItemId}`}
                              value={cond.value}
                              checked={state.condition === cond.value}
                              onChange={() => updateItemState(item.lineItemId, { condition: cond.value })}
                              disabled={loading}
                              className="text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="font-medium text-slate-700">{cond.label}</span>
                            <span className="text-slate-400">— {cond.description}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={state.restock}
                          onChange={(e) => updateItemState(item.lineItemId, {
                            restock: e.target.checked,
                            restockQty: e.target.checked ? (state.restockQty || item.quantityReturned) : state.restockQty
                          })}
                          disabled={loading}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-xs font-medium text-slate-700">Restock this item</span>
                      </label>

                      {state.restock && (
                        <div className="mt-2 ml-6 flex items-center gap-2">
                          <label className="text-xs text-slate-500">Quantity to restock:</label>
                          <input
                            type="number"
                            min={0}
                            max={item.quantityReturned}
                            value={state.restockQty}
                            onChange={(e) => {
                              let val = parseInt(e.target.value, 10);
                              if (isNaN(val)) val = 0;
                              val = Math.min(Math.max(val, 0), item.quantityReturned);
                              updateItemState(item.lineItemId, { restockQty: val });
                            }}
                            disabled={loading}
                            className="w-20 px-2 py-1 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          <span className="text-[10px] text-slate-400">of {item.quantityReturned} returned</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="pt-3 border-t border-slate-200 space-y-1">
                <div className="flex justify-between items-center text-sm"><span className="text-slate-600 font-medium">Total Quantity Received:</span><span className="font-bold text-slate-800">{totalItems} units</span></div>
                <div className="flex justify-between items-center text-sm"><span className="text-slate-600 font-medium">Total Value:</span><span className="font-bold text-emerald-600">₹{totalValue.toFixed(2)}</span></div>
                <div className="flex justify-between items-center text-sm"><span className="text-slate-600 font-medium">Total to Restock:</span><span className="font-bold text-indigo-600">{totalToRestock} units</span></div>
              </div>
            </div>
          )}

          <div className="flex gap-3 sticky bottom-0 bg-white pt-2">
            <button onClick={handleClose} disabled={loading} className="flex-1 px-4 py-3 border-2 border-slate-200 hover:border-slate-300 text-slate-700 font-bold rounded-xl transition-all disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !allConditionsSelected || !items || items.length === 0}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>) : `Confirm Receipt (${totalItems} item${totalItems !== 1 ? 's' : ''})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};