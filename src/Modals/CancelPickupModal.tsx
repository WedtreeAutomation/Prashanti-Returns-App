import { useState } from 'react';
import { BaseModal } from './BaseModal';
import { 
  X, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Truck, 
  FileText
} from 'lucide-react';
import { db } from '../Interfaces/firebase';
import { notifyPickupCancelled, addShopifyNote, addShopifyTag } from '../Interfaces/api';
import {
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  addDoc,
  collection
} from 'firebase/firestore';
import { CancelPickupModalProps } from '../Interfaces/types';

export const CancelPickupModal = ({
  isOpen,
  onClose,
  orderId,
  orderNumericId,
  RAN,
  currentAWB = '',
  currentUser,
  customerEmail = '',
  shipmentStatus = '',
  onSuccess
}: CancelPickupModalProps & { shipmentStatus?: string }) => {
  const [awbNumber, setAwbNumber] = useState(currentAWB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [cancelResponse, setCancelResponse] = useState<any>(null);
  const [step, setStep] = useState<'input' | 'confirm' | 'result'>('input');

  // <-- ADD THE SELF SHIP FLAG
  const isSelfShip = shipmentStatus?.toLowerCase() === 'self ship requested';

  const handleClose = () => {
    if (!loading) {
      setAwbNumber(currentAWB);
      setError('');
      setSuccess('');
      setCancelResponse(null);
      setStep('input');
      onClose();
    }
  };

  const validateAWB = (awb: string): boolean => {
    if (isSelfShip) return true;

    if (!awb.trim()) {
      setError('Please enter an AWB number');
      return false;
    }
    if (awb.trim().length < 10) {
      setError('AWB number should be at least 10 characters');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    setError('');
    if (validateAWB(awbNumber)) {
      setStep('confirm');
    }
  };

  const handleBack = () => {
    setStep('input');
    setError('');
  };

  // Helper to extract numeric order ID from various formats
  const getNumericOrderId = (id: string | number): number | null => {
    if (!id) return null;
    
    if (typeof id === 'number') return id;
    
    if (typeof id === 'string' && id.includes('gid://')) {
      const numericMatch = id.match(/\d+$/);
      if (numericMatch) {
        return parseInt(numericMatch[0]);
      }
    }
    
    if (typeof id === 'string' && !isNaN(Number(id))) {
      return parseInt(id);
    }
    
    return null;
  };

  const handleCancelPickup = async () => {
    if (!validateAWB(awbNumber)) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      let tokenNumber: string | undefined = undefined;
      let pickupDate: string | undefined = undefined;
      let responseData: any = null;

      // 1. --- BYPASS BLUEDART CANCELLATION FOR SELF SHIP ---
      if (!isSelfShip) {
        if (orderId && awbNumber) {
          try {
            const waybillRef = doc(db, 'returns', orderId, 'bluedart_waybills', awbNumber.trim());
            const waybillSnap = await getDoc(waybillRef);
            
            if (waybillSnap.exists()) {
              const waybillData = waybillSnap.data();
              tokenNumber = waybillData.tokenNumber;
              pickupDate = waybillData.rawResponse?.PickupDate || waybillData.rawResponse?.pickupDate;
            }
          } catch (fsError) {
            console.warn("⚠️ Could not fetch token details from Firestore. Proceeding with AWB cancel only.", fsError);
          }
        }

        const payload = {
          awbNumber: awbNumber.trim(),
          ...(tokenNumber && { tokenNumber }),
          ...(pickupDate && { pickupDate })
        };

        const BACKEND_URL = import.meta.env.VITE_FLASK_API_URL
          ? `${import.meta.env.VITE_FLASK_API_URL}/bluedart/waybill/cancel`
          : '/api/bluedart/waybill/cancel';
          
        const apiKey = import.meta.env.VITE_FLASK_API_KEY;

        const response = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-API-Key': apiKey 
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || `HTTP error! status: ${response.status}`);
        }
        
        responseData = data;
        setCancelResponse(data);
      }

      // 2. --- FIREBASE UPDATE LOGIC ---
      if (orderId) {
        try {
          const returnRef = doc(db, 'returns', orderId);
          
          const updateData: any = {
            status: 'Open',
            shipmentStatus: 'Pickup Cancelled', // Standardizes state for tracking maps
            cancelledAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          };

          if (!isSelfShip && currentAWB === awbNumber) {
            updateData.awb = '';
            updateData.previousAWB = currentAWB;
          }

          await updateDoc(returnRef, updateData);

          const activitiesRef = collection(db, 'returns', orderId, 'activities');
          await addDoc(activitiesRef, {
            type: 'warning',
            title: isSelfShip ? 'Self Ship Cancelled' : 'Pickup Cancelled',
            description: isSelfShip ? 'Self-ship request has been cancelled.' : `Pickup with AWB ${awbNumber} has been cancelled.`,
            timestamp: Timestamp.now(),
            user: currentUser?.name || 'Unknown Agent',
            metadata: isSelfShip ? { cancelled: true } : {
              awb: awbNumber,
              tokenCancelled: !!tokenNumber,
              cancellationResponse: responseData
            }
          });
        } catch (firebaseError) {
          console.error('Error updating Firebase:', firebaseError);
        }
      }

      // 3. --- WEBHOOK AND SHOPIFY NOTE ---
      if (!isSelfShip) {
        await notifyPickupCancelled(
          { orderId, RAN, email: customerEmail },
          { reason: 'Cancelled via Admin Portal', rescheduleAllowed: true }
        );

        try {
          const targetShopifyId = orderNumericId || getNumericOrderId(orderId);
          if (targetShopifyId) {
            const noteMessage = `Pickup with AWB ${awbNumber} has been cancelled.\nCancelled by: ${currentUser?.name || 'Unknown Agent'}\nReason: Cancelled via Admin Portal`;
            await addShopifyNote(targetShopifyId, RAN, "Pickup Cancelled", noteMessage);
            await addShopifyTag(targetShopifyId, "Return Pickup Cancelled");
          }
        } catch (noteError) {
          console.error("Failed to add Shopify note/tag for pickup cancellation:", noteError);
        }
      } else {
        try {
          const targetShopifyId = orderNumericId || getNumericOrderId(orderId);
          if (targetShopifyId) {
            const noteMessage = `Self-ship request has been cancelled.\nCancelled by: ${currentUser?.name || 'Unknown Agent'}`;
            await addShopifyNote(targetShopifyId, RAN, "Self Ship Cancelled", noteMessage);
            await addShopifyTag(targetShopifyId, "Return Self Ship Cancelled");
          }
        } catch (noteError) {
          console.error("Failed to add Shopify note/tag for self ship cancellation:", noteError);
        }
      }

      setSuccess(isSelfShip ? 'Self-ship request cancelled successfully.' : `Pickup cancelled successfully for AWB: ${awbNumber}`);
      setStep('result');

      if (onSuccess) {
        onSuccess(isSelfShip ? '' : awbNumber);
      }

    } catch (error: any) {
      console.error("❌ Cancel Pickup Error:", error);
      setError(error.message || "Failed to cancel pickup. Please try again.");
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  const renderInputStep = () => (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Truck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {isSelfShip ? 'Cancel Self Ship Request' : 'Cancel Blue Dart Pickup'}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              {isSelfShip 
                ? "You are about to cancel the customer's self-ship request. This action cannot be undone."
                : "Enter the AWB number of the pickup you want to cancel. This action cannot be undone."}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-slate-100 rounded-lg p-3 border border-slate-200">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-500">RAN:</span>
          <span className="font-mono font-semibold text-pink-600">{RAN}</span>
        </div>
        <div className="flex justify-between items-center text-xs mt-1">
          <span className="text-slate-500">Order:</span>
          <span className="font-semibold">{orderId}</span>
        </div>
      </div>

      {!isSelfShip && (
        <>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              AWB Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={awbNumber}
              onChange={(e) => setAwbNumber(e.target.value)}
              placeholder="e.g. 58162271215"
              className="w-full p-3 border border-slate-200 rounded-lg text-sm outline-none focus:border-[#4A3AFF] focus:ring-1 focus:ring-[#4A3AFF] font-mono"
              disabled={loading}
              autoFocus
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Enter the 11-digit AWB number from Blue Dart
            </p>
          </div>

          {currentAWB && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800">Current AWB in system</p>
                  <p className="text-xs text-amber-700 font-mono mt-1">{currentAWB}</p>
                  {awbNumber !== currentAWB && (
                    <button
                      onClick={() => setAwbNumber(currentAWB)}
                      className="text-[10px] text-amber-600 hover:text-amber-700 underline mt-1"
                    >
                      Use current AWB
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderConfirmStep = () => (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Confirm Cancellation</p>
            <p className="text-xs text-amber-700 mt-1">
              Are you sure you want to cancel this {isSelfShip ? 'self-ship request' : 'pickup'}? This action cannot be undone.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-slate-100 rounded-lg p-4 border border-slate-200">
        {!isSelfShip && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500">AWB to cancel:</span>
            <span className="text-sm font-mono font-bold text-slate-800">{awbNumber}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">RAN:</span>
          <span className="text-xs font-semibold text-pink-600">{RAN}</span>
        </div>
      </div>

      {!isSelfShip && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-700">
            <strong>Warning:</strong> Cancelling a pickup will remove the scheduled pickup from Blue Dart's system. 
            You will need to create a new pickup if you still need to ship the return.
          </p>
        </div>
      )}
    </div>
  );

  const renderResultStep = () => (
    <div className="space-y-5">
      {success ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-sm font-semibold text-green-800 mb-2">
            {isSelfShip ? 'Self Ship Cancelled Successfully' : 'Pickup Cancelled Successfully'}
          </p>
          <p className="text-xs text-green-700 mb-4">{success}</p>
          
          {!isSelfShip && cancelResponse?.pickup_cancellation_status && (
             <div className="mb-4 py-2 px-3 bg-blue-100/50 rounded-lg border border-blue-200">
               <p className="text-xs font-medium text-blue-800">
                 Truck Dispatch: {cancelResponse.pickup_cancellation_status}
               </p>
             </div>
          )}

          {!isSelfShip && (
            <div className="bg-white rounded-lg p-3 border border-green-200">
              <p className="text-xs text-slate-500 mb-1">Cancelled AWB</p>
              <p className="text-sm font-mono font-bold text-slate-800">{awbNumber}</p>
            </div>
          )}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <p className="text-sm font-semibold text-red-800 mb-2">Cancellation Failed</p>
          <p className="text-xs text-red-700 mb-4">{error}</p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : null}
    </div>
  );

  const renderFooter = () => {
    if (step === 'input') {
      return (
        <button
          onClick={handleNext}
          disabled={(!isSelfShip && !awbNumber.trim()) || loading}
          className="w-full bg-[#4A3AFF] hover:bg-[#3f31d6] text-white font-bold py-3.5 rounded-lg transition-colors disabled:opacity-50 flex justify-center items-center gap-2 text-sm"
        >
          Next
        </button>
      );
    }

    if (step === 'confirm') {
      return (
        <div className="flex gap-3">
          <button
            onClick={handleBack}
            disabled={loading}
            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            Back
          </button>
          <button
            onClick={handleCancelPickup}
            disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-3.5 rounded-lg transition-colors disabled:opacity-50 flex justify-center items-center gap-2 text-sm"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Cancelling...</>
            ) : (
              'Confirm Cancel'
            )}
          </button>
        </div>
      );
    }

    if (step === 'result') {
      return (
        <button
          onClick={handleClose}
          className="w-full bg-[#4A3AFF] hover:bg-[#3f31d6] text-white font-bold py-3.5 rounded-lg transition-colors text-sm"
        >
          Close
        </button>
      );
    }

    return null;
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'input' ? 'Cancel Pickup' : step === 'confirm' ? 'Confirm Cancellation' : 'Cancellation Result'}
      footer={renderFooter()}
    >
      <div className="space-y-5 text-slate-800">
        {error && step === 'input' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {step === 'input' && renderInputStep()}
        {step === 'confirm' && renderConfirmStep()}
        {step === 'result' && renderResultStep()}
      </div>
    </BaseModal>
  );
};