import { useState, useEffect } from 'react';
import {
  doc, collection, addDoc, updateDoc, Timestamp,
  getDocs, query, orderBy
} from 'firebase/firestore';
import { db } from '../Interfaces/firebase';
import { BaseModal } from './BaseModal';
import { ChevronDown, Loader2, MapPin, Package, Truck, AlertCircle } from 'lucide-react';
import { SelfShipModalProps, Warehouse } from '../Interfaces/types';
import { addShopifyNote, addShopifyTag } from '../Interfaces/api';


export const SelfShipModal = ({
  isOpen,
  onClose,
  orderId,
  orderNumericId,
  RAN,
  customerEmail,
  customerName,
  currentUser,
  requestedMethod = 'gift_card',
  onSuccess
}: SelfShipModalProps & { onSuccess?: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [fetchingWarehouses, setFetchingWarehouses] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('');
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string>('');

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

  // Fetch warehouses from Firebase
  useEffect(() => {
    const fetchWarehouses = async () => {
      if (!isOpen) return;

      setFetchingWarehouses(true);
      setError('');
      try {
        const warehousesQuery = query(collection(db, 'warehouses'), orderBy('name', 'asc'));
        const warehousesSnapshot = await getDocs(warehousesQuery);
        const warehousesList: Warehouse[] = [];

        warehousesSnapshot.forEach((doc) => {
          const data = doc.data() as Omit<Warehouse, 'id'>;
          if (data.isActive !== false) {
            warehousesList.push({ id: doc.id, ...data });
          }
        });

        setWarehouses(warehousesList);

        if (warehousesList.length > 0 && !selectedWarehouse) {
          setSelectedWarehouse(warehousesList[0].id);
        }
      } catch (error) {
        console.error("Error fetching warehouses:", error);
        setError("Failed to load warehouses. Please refresh and try again.");
      } finally {
        setFetchingWarehouses(false);
      }
    };

    fetchWarehouses();
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedWarehouse(warehouses[0]?.id || '');
      setEmailSent(false);
      setError('');
    }
  }, [isOpen, warehouses]);

  const getSelectedWarehouseDetails = (): Warehouse | undefined => {
    return warehouses.find(w => w.id === selectedWarehouse);
  };

  const formatAddress = (warehouse: Warehouse): string => {
    const parts = [
      warehouse.address1,
      warehouse.address2,
      warehouse.address3,
      warehouse.city,
      warehouse.state,
      warehouse.pincode,
      warehouse.country
    ].filter(Boolean);
    return parts.join(', ');
  };

  const sendSelfShipEmail = async (warehouse: Warehouse) => {
    try {
      const fullAddress = formatAddress(warehouse);
      
      const payload = {
        RAN,
        orderId,
        customerEmail,
        customerName: customerName || 'Customer',
        requestedMethod,
        warehouse: {
          name: warehouse.name,
          address: warehouse.address1,
          address1: warehouse.address1,
          address2: warehouse.address2 || '',
          address3: warehouse.address3 || '',
          city: warehouse.city,
          state: warehouse.state,
          zip: warehouse.pincode,
          pincode: warehouse.pincode,
          country: warehouse.country,
          phone: warehouse.phone || '9962505459',
          email: 'support@prashantisarees.in',
          contactPerson: 'Warehouse Team'
        },
        fullAddress: fullAddress,
        timestamp: new Date().toISOString()
      };

      console.log('📧 Sending self-ship email with payload:', payload);

      const response = await fetch('https://chats.prashantisarees.com/webhook/self-ship-requested', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-source': 'prashanti-return-portal'
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ Self-ship email sent successfully:', result);
      return true;
    } catch (error) {
      console.error('❌ Error sending self-ship email:', error);
      return false;
    }
  };

  const handleConfirm = async () => {
    if (!selectedWarehouse) {
      setError('Please select a warehouse');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const warehouse = getSelectedWarehouseDetails();
      if (!warehouse) throw new Error('Warehouse not found');

      const agentName = currentUser?.name || currentUser?.displayName || 'Unknown Agent';

      // Update Firestore
      const returnRef = doc(db, 'returns', orderId);
      await updateDoc(returnRef, {
        status: 'Approved',
        shipmentStatus: 'Self Ship Requested',
        selfShipWarehouse: warehouse.id,
        selfShipWarehouseName: warehouse.name,
        selfShipWarehouseAddress: formatAddress(warehouse),
        selfShipRequestedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      // Add activity log
      const activitiesRef = collection(db, 'returns', orderId, 'activities');
      await addDoc(activitiesRef, {
        type: 'info',
        title: 'Self Ship Requested',
        description: `Customer requested to self-ship to ${warehouse.name} warehouse at ${formatAddress(warehouse)}`,
        timestamp: Timestamp.now(),
        user: agentName,
        metadata: { 
          RAN, 
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          warehouseAddress: formatAddress(warehouse)
        }
      });

      try {
        const targetShopifyId = orderNumericId || getNumericOrderId(orderId);
        
        if (targetShopifyId) {
          const methodDisplay = requestedMethod === 'gift_card' ? 'Gift Card' : 
                                requestedMethod === 'store_credit' ? 'Store Credit' : 
                                'Original Payment Method';
          
          const noteMessage = `Self-ship requested by customer.\nWarehouse: ${warehouse.name}\nAddress: ${formatAddress(warehouse)}\nRefund Method: ${methodDisplay}\nRequested by: ${agentName}`;
          
          await addShopifyNote(targetShopifyId, RAN, "Self Ship Requested", noteMessage);
          await addShopifyTag(targetShopifyId, "Return Approved Self Ship Requested");
          console.log(`Shopify note and tag added for self-ship (Order: ${targetShopifyId})`);
        } else {
          console.warn(`Could not add Shopify note or tag: Invalid order ID format (${orderId})`);
        }
      } catch (noteError) {
        // Non-blocking - log the error but don't fail the self-ship request
        console.error("Failed to add Shopify note/tag for self-ship:", noteError);
      }

      // Send email notification via n8n webhook
      const emailSuccess = await sendSelfShipEmail(warehouse);
      setEmailSent(emailSuccess);

      // Update email sent status in Firestore
      await updateDoc(returnRef, {
        selfShipEmailSent: emailSuccess,
        selfShipEmailSentAt: emailSuccess ? Timestamp.now() : null
      });

      const message = `Self ship request confirmed! ${emailSuccess ? 'Email notification sent to customer.' : 'Email notification failed, but request has been logged.'}`;
      alert(message);
      
      if (onSuccess) onSuccess();
      onClose();

    } catch (error) {
      console.error('Error confirming self ship:', error);
      setError(error instanceof Error ? error.message : 'Failed to confirm. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedWarehouseDetails = getSelectedWarehouseDetails();

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} title="Self Ship Request">
      <div className="space-y-6">
        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Truck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-800">Self Ship Instructions</p>
              <p className="text-xs text-blue-600 mt-1">
                Customer will be responsible for shipping the product to our warehouse.
                Refund will be processed via <strong>{requestedMethod === 'gift_card' ? 'Gift Card' : requestedMethod === 'store_credit' ? 'Store Credit' : 'Original Payment Method'}</strong> upon receipt.
              </p>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* RAN and Order Info */}
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-medium text-slate-500">Return Authorization Number</span>
            <span className="text-sm font-bold text-pink-600 font-mono">{RAN}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-slate-500">Order ID</span>
            <span className="text-sm font-semibold text-slate-800">{orderId}</span>
          </div>
          {customerEmail && (
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
              <span className="text-xs font-medium text-slate-500">Customer Email</span>
              <span className="text-sm text-slate-600">{customerEmail}</span>
            </div>
          )}
        </div>

        {/* Warehouse Selection */}
        {fetchingWarehouses ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="w-6 h-6 text-pink-600 animate-spin" />
          </div>
        ) : warehouses.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <AlertCircle className="w-5 h-5 text-amber-600 mx-auto mb-2" />
            <p className="text-sm text-amber-800">No active warehouses found</p>
            <p className="text-xs text-amber-600 mt-1">Please add a warehouse in Settings first</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Select Warehouse <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={selectedWarehouse}
                onChange={(e) => setSelectedWarehouse(e.target.value)}
                className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none appearance-none cursor-pointer focus:ring-2 focus:ring-pink-200 focus:border-pink-500"
                disabled={warehouses.length === 0 || loading}
              >
                {warehouses.length === 0 ? (
                  <option value="">No warehouses available</option>
                ) : (
                  warehouses.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.code ? `(${w.code})` : ''}
                    </option>
                  ))
                )}
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
                <ChevronDown className="w-4 h-4 text-slate-500" />
              </div>
            </div>

            {/* Warehouse Details */}
            {selectedWarehouseDetails && (
              <div className="mt-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                <h4 className="text-sm font-semibold text-indigo-800 mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Shipping Address
                </h4>
                <div className="space-y-2 text-sm">
                  <p className="text-indigo-900 font-medium">{selectedWarehouseDetails.name}</p>
                  <p className="text-indigo-700">{formatAddress(selectedWarehouseDetails)}</p>
                  {selectedWarehouseDetails.phone && (
                    <p className="text-indigo-600 flex items-center gap-2 text-xs">
                      <span>📞 {selectedWarehouseDetails.phone}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 border-2 border-slate-200 hover:border-slate-300 rounded-xl text-slate-700 font-medium transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !selectedWarehouse || warehouses.length === 0}
            className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Package className="w-4 h-4" />
                Confirm Self Ship
              </>
            )}
          </button>
        </div>

        {emailSent && (
          <p className="text-xs text-green-600 text-center">
            ✓ Email notification sent successfully
          </p>
        )}
      </div>
    </BaseModal>
  );
};