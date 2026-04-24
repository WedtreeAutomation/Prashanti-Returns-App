import React, { useState } from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Package, PackageX } from 'lucide-react';
import { MarkReceivedModalProps } from '../Interfaces/types';
import { notifyReturnReceived } from '../Interfaces/api';

export const MarkReceivedModal: React.FC<MarkReceivedModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  items = [],
  RAN = '',
  orderId = '',
  customerName = '',
  customerEmail = '',
  requestedMethod = 'store_credit'
}) => {
  const [category, setCategory] = useState<string>('');
  const [restock, setRestock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const categories = [
    { value: 'Fresh', label: 'Fresh', description: 'Like new, unused condition', color: 'green' },
    { value: 'Seconds', label: 'Seconds', description: 'Minor defects, slightly used', color: 'yellow' },
    { value: 'Defect / Damaged Item', label: 'Defect / Damaged', description: 'Significant damage, cannot be resold', color: 'red' }
  ];

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!category) {
      setError('Please select a category');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call onConfirm - we don't need to capture the return value
      await onConfirm(category, restock);
      
      // Send email notification to customer if we have their email
      if (customerEmail && items.length > 0) {
        try {
          const totalQuantity = items.reduce((sum, item) => sum + (item.quantityReturned || 0), 0);
          
          await notifyReturnReceived({
            RAN,
            orderId,
            customer: {
              name: customerName || 'Customer',
              email: customerEmail,
            },
            items: items,
            requestedMethod: requestedMethod,
            itemCondition: category,
            restockInfo: {
              restocked: restock,
              totalQuantityRestocked: restock ? totalQuantity : 0
            }
          });
          console.log('✅ Return received email sent to customer');
        } catch (emailError) {
          console.error('Failed to send return received email:', emailError);
          // Don't block the success flow if email fails
        }
      }
      
      // Reset form after successful submission
      setCategory('');
      setRestock(false);
      onClose();
    } catch (err) {
      console.error('Error in mark received:', err);
      setError('Failed to process. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCategory('');
    setRestock(false);
    setError('');
    onClose();
  };

  const getCategoryStyles = (catValue: string) => {
    const isSelected = category === catValue;
    const baseStyles = "flex items-center justify-between p-4 border-2 rounded-xl cursor-pointer transition-all";

    if (isSelected) {
      return `${baseStyles} border-indigo-500 bg-indigo-50 shadow-md`;
    }
    return `${baseStyles} border-slate-200 hover:border-indigo-300 bg-white hover:bg-slate-50`;
  };

  // Calculate totals
  const totalItems = items.reduce((sum, item) => sum + (item.quantityReturned || 0), 0);
  const totalValue = items.reduce((sum, item) => {
    const price = parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0');
    return sum + (price * (item.quantityReturned || 0));
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 flex justify-between items-center p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Mark as Received</h2>
              <p className="text-xs text-slate-500 mt-0.5">Confirm return item receipt</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-lg transition-colors"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* RAN Reference */}
          {RAN && (
            <div className="mb-4 pb-3 border-b border-slate-100">
              <p className="text-xs text-slate-500">Return Authorization Number</p>
              <p className="text-sm font-mono font-semibold text-indigo-600">{RAN}</p>
            </div>
          )}

          {/* Order and Customer Info */}
          {(orderId || customerName || customerEmail) && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              {orderId && (
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Order ID:</span>
                  <span className="font-medium text-slate-700">{orderId}</span>
                </div>
              )}
              {customerName && (
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-medium text-slate-700">{customerName}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Email:</span>
                  <span className="font-medium text-slate-700 truncate max-w-[200px]">{customerEmail}</span>
                </div>
              )}
            </div>
          )}

          {/* Items to Receive Section */}
          {items && items.length > 0 && (
            <div className="mb-6 bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-700">Items to Receive</h3>
                </div>
                <span className="text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded-full">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {/* Items List */}
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {items.map((item, idx) => (
                  <div key={item.lineItemId || idx} className="bg-white rounded-lg p-3 border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800 line-clamp-2">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">SKU: {item.sku || 'N/A'}</p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center justify-center bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-1 rounded-full min-w-[50px]">
                          Qty: {item.quantityReturned}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Price:</span>
                      <span className="font-medium text-slate-700">{item.price || '0'}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs mt-1">
                      <span className="text-slate-500">Subtotal:</span>
                      <span className="font-semibold text-emerald-600">
                        ₹{(parseFloat(item.price?.replace(/[^0-9.]/g, '') || '0') * (item.quantityReturned || 0)).toFixed(2)}
                      </span>
                    </div>
                    
                    {item.reason && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400">
                          <span className="font-medium">Return Reason:</span> {item.reason}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Totals Summary */}
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-600 font-medium">Total Quantity:</span>
                  <span className="font-bold text-slate-800">{totalItems} units</span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-slate-600 font-medium">Total Value:</span>
                  <span className="font-bold text-emerald-600">₹{totalValue.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* No Items State */}
          {(!items || items.length === 0) && (
            <div className="mb-6 bg-amber-50 rounded-xl p-4 border border-amber-200">
              <div className="flex items-start gap-3">
                <PackageX className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">No Items to Process</p>
                  <p className="text-xs text-amber-700 mt-1">
                    All items in this return have been rejected or there are no active items to mark as received.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Category Selection */}
          {items && items.length > 0 && (
            <>
              <div className="mb-6">
                <label className="text-sm font-semibold text-slate-700 block mb-3">
                  Select Condition <span className="text-red-500">*</span>
                </label>
                <div className="space-y-3">
                  {categories.map((cat) => (
                    <label
                      key={cat.value}
                      className={getCategoryStyles(cat.value)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{cat.label}</span>
                          {category === cat.value && (
                            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{cat.description}</p>
                      </div>
                      <input
                        type="radio"
                        name="category"
                        value={cat.value}
                        checked={category === cat.value}
                        onChange={(e) => setCategory(e.target.value)}
                        className="sr-only"
                        disabled={loading}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Restock Checkbox with Item Info */}
              <div className="mb-8">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={restock}
                    onChange={(e) => setRestock(e.target.checked)}
                    className="w-5 h-5 mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
                    disabled={loading}
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">
                      Restock items in inventory
                    </span>
                    <p className="text-xs text-slate-500 mt-1">
                      {restock 
                        ? `Will restock ${totalItems} unit(s) back to Shopify inventory`
                        : 'Items will be marked as received but not restocked'}
                    </p>
                    {restock && (
                      <div className="mt-2 p-2 bg-green-50 rounded-lg border border-green-100">
                        <p className="text-[10px] text-green-700">
                          📦 Restocking: {items.map(i => `${i.title} (x${i.quantityReturned})`).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 sticky bottom-0 bg-white pt-2">
            <button
              onClick={handleClose}
              disabled={loading}
              className="flex-1 px-4 py-3 border-2 border-slate-200 hover:border-slate-300 text-slate-700 font-bold rounded-xl transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !category || !items || items.length === 0}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing {totalItems} item(s)...
                </>
              ) : (
                `Confirm Receipt (${totalItems} item${totalItems !== 1 ? 's' : ''})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};