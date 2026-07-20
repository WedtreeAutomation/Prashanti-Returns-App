import React, { useState } from 'react';
import { X, AlertCircle, Mail, Package, PackageX } from 'lucide-react';
import { RejectRequestModalProps } from '../Interfaces/types';

export const RejectRequestModal: React.FC<RejectRequestModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  orderId,
  RAN,
  customerEmail,
  customerName,
  itemIdToReject,
  itemToReject
}) => {
  const [reason, setReason] = useState('');
  const [allowResubmit, setAllowResubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Determine if this is an item-level rejection
  const isItemRejection = !!itemIdToReject && !!itemToReject;

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!reason.trim()) {
      alert('Please enter a reason for rejection');
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(reason, allowResubmit, itemIdToReject);
      setReason('');
      setAllowResubmit(false);
    } catch (error) {
      console.error('Error rejecting:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason('');
    setAllowResubmit(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95">
        {/* Header */}
        <div className="sticky top-0 bg-white z-10 flex justify-between items-center p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isItemRejection ? 'bg-amber-100' : 'bg-red-100'
            }`}>
              {isItemRejection ? (
                <PackageX className="w-4 h-4 text-amber-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {isItemRejection ? 'Reject Item' : 'Reject Return Request'}
              </h2>
              {RAN && (
                <p className="text-xs text-slate-500 mt-0.5">RAN: {RAN}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {/* ITEM BEING REJECTED - Only show for item rejection */}
          {isItemRejection && itemToReject && (
            <div className="bg-amber-50 rounded-xl p-3 mb-5 border border-amber-200">
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center shrink-0">
                  <Package className="w-3.5 h-3.5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Item to Reject</p>
                  <p className="text-sm font-semibold text-amber-900 mt-0.5 truncate">{itemToReject.title}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-amber-700">
                    <span>SKU: {itemToReject.sku}</span>
                    <span>• Qty: {itemToReject.quantityReturned}</span>
                    <span>• {itemToReject.price}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Order Info - Compact */}
          {(orderId || customerName || customerEmail) && (
            <div className="bg-slate-50 rounded-xl p-3 mb-5 border border-slate-200">
              <div className="space-y-1.5 text-sm">
                {orderId && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Order:</span>
                    <span className="font-medium text-slate-800">{orderId}</span>
                  </div>
                )}
                {customerName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Customer:</span>
                    <span className="font-medium text-slate-800 truncate max-w-[200px]">{customerName}</span>
                  </div>
                )}
                {customerEmail && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email:
                    </span>
                    <span className="font-medium text-slate-800 truncate max-w-[200px]">{customerEmail}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reason Input */}
          <div className="mb-5">
            <label className="text-sm font-semibold text-slate-700 block mb-2">
              Rejection Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isItemRejection 
                ? "E.g., Item shows signs of wear, Wrong item returned, Missing tags"
                : "E.g., Clear images not provided, Item shows signs of wear, Return window expired"}
              rows={3}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-red-200 focus:border-red-500 transition-all resize-none"
              disabled={submitting}
            />
            <p className="text-xs text-slate-400 mt-1.5">
              This reason will be shared with the customer
            </p>
          </div>

          {/* Allow Resubmit Checkbox - ONLY for full request rejection */}
          {!isItemRejection && (
            <div className="mb-5">
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={allowResubmit}
                  onChange={(e) => setAllowResubmit(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-500 focus:ring-offset-0"
                  disabled={submitting}
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">
                    Allow customer to resubmit
                  </span>
                  <p className="text-xs text-slate-500">
                    {allowResubmit
                      ? 'Status will be "Closed" - customer can submit a new return'
                      : 'Status will be "Denied" - customer cannot submit another return'}
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 border-2 border-slate-200 hover:border-slate-300 text-slate-700 font-medium rounded-xl transition-all"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !reason.trim()}
              className={`flex-1 px-4 py-2.5 font-medium rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                isItemRejection
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white'
                  : 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white'
              }`}
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                isItemRejection ? 'Reject Item' : 'Confirm Rejection'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};