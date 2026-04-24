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
import { notifyPickupCancelled } from '../Interfaces/api';
import {
  doc,
  getDoc,
  updateDoc,
  Timestamp,
  addDoc,
  collection
} from 'firebase/firestore';
import { CancelPickupModalProps } from '../Interfaces/types';

// ==========================================
// INTERFACES
// ==========================================



export const CancelPickupModal = ({
  isOpen,
  onClose,
  orderId,
  RAN,
  currentAWB = '',
  customerEmail = '', // Make sure you pass this prop from your parent component if possible
  onSuccess
}: CancelPickupModalProps) => {
  const [awbNumber, setAwbNumber] = useState(currentAWB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [cancelResponse, setCancelResponse] = useState<any>(null);
  const [step, setStep] = useState<'input' | 'confirm' | 'result'>('input');

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
    if (!awb.trim()) {
      setError('Please enter an AWB number');
      return false;
    }
    if (awb.trim().length < 10) {
      setError('AWB number should be at least 10 characters');
      return false;
    }
    return true;
  }

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

  const handleCancelPickup = async () => {
    if (!validateAWB(awbNumber)) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // 1. Fetch the Token Number and Pickup Date from the Firestore sub-collection
      let tokenNumber: string | undefined = undefined;
      let pickupDate: string | undefined = undefined;

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

      // 2. Prepare payload for backend
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

      setCancelResponse(data);

      // 4. Update Firebase tracking status
      if (orderId) {
        try {
          const returnRef = doc(db, 'returns', orderId);
          
          const updateData: any = {
            shipmentStatus: 'Pickup Cancelled',
            cancelledAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          };

          if (currentAWB === awbNumber) {
            updateData.awb = '';
            updateData.previousAWB = currentAWB;
          }

          await updateDoc(returnRef, updateData);

          const activitiesRef = collection(db, 'returns', orderId, 'activities');
          await addDoc(activitiesRef, {
            type: 'warning',
            title: 'Pickup Cancelled',
            description: `Pickup with AWB ${awbNumber} has been cancelled.`,
            timestamp: Timestamp.now(),
            user: 'Admin',
            metadata: {
              awb: awbNumber,
              tokenCancelled: !!tokenNumber,
              cancellationResponse: data
            }
          });
        } catch (firebaseError) {
          console.error('Error updating Firebase:', firebaseError);
        }
      }

      // 5. Trigger N8N Webhook 
      await notifyPickupCancelled(
        {
          orderId,
          RAN,
          email: customerEmail, // Including the email so n8n flow receives it
        },
        {
          reason: 'Cancelled via Admin Portal',
          rescheduleAllowed: true
        }
      );

      setSuccess(`Pickup cancelled successfully for AWB: ${awbNumber}`);
      setStep('result');

      if (onSuccess) {
        onSuccess(awbNumber);
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
            <p className="text-sm font-medium text-blue-800">Cancel Blue Dart Pickup</p>
            <p className="text-xs text-blue-600 mt-1">
              Enter the AWB number of the pickup you want to cancel. This action cannot be undone.
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
              Are you sure you want to cancel this pickup? This action cannot be undone.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-slate-100 rounded-lg p-4 border border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-500">AWB to cancel:</span>
          <span className="text-sm font-mono font-bold text-slate-800">{awbNumber}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">RAN:</span>
          <span className="text-xs font-semibold text-pink-600">{RAN}</span>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <p className="text-xs text-red-700">
          <strong>Warning:</strong> Cancelling a pickup will remove the scheduled pickup from Blue Dart's system. 
          You will need to create a new pickup if you still need to ship the return.
        </p>
      </div>
    </div>
  );

  const renderResultStep = () => (
    <div className="space-y-5">
      {success ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-sm font-semibold text-green-800 mb-2">Pickup Cancelled Successfully</p>
          <p className="text-xs text-green-700 mb-4">{success}</p>
          
          {/* Display Truck Status to User */}
          {cancelResponse?.pickup_cancellation_status && (
             <div className="mb-4 py-2 px-3 bg-blue-100/50 rounded-lg border border-blue-200">
               <p className="text-xs font-medium text-blue-800">
                 Truck Dispatch: {cancelResponse.pickup_cancellation_status}
               </p>
             </div>
          )}

          <div className="bg-white rounded-lg p-3 border border-green-200">
            <p className="text-xs text-slate-500 mb-1">Cancelled AWB</p>
            <p className="text-sm font-mono font-bold text-slate-800">{awbNumber}</p>
          </div>
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
          disabled={!awbNumber.trim() || loading}
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