import { useEffect, useState, useMemo, useCallback } from 'react';
import { BaseModal } from './BaseModal.tsx';
import { ReturnItem } from '../Interfaces/types';
import { CheckboxWithInputProps } from '../Interfaces/types';
import { IssueRefundModalProps } from '../Interfaces/types';
import { notifyRefundDone } from '../Interfaces/api';
import { ShopifyLineItem } from '../Interfaces/types';
import { RefundResult } from '../Interfaces/types';
import { apiClient } from '../Interfaces/api';

// Constants
const REFUND_METHODS = [
  { 
    id: 'original', 
    label: 'Refund to original payment method via Shopify', 
    description: 'Process refund back to original payment method (credit card, PayPal, etc.)',
    requiresCustomer: false
  },
  { 
    id: 'store_credit', 
    label: 'Refund as store credits', 
    description: 'Issue store credit for future purchases',
    requiresCustomer: true
  },
  { 
    id: 'giftcard', 
    label: 'Refund via gift card', 
    description: 'Create and send a gift card to customer',
    requiresCustomer: true
  },
  { 
    id: 'manual', 
    label: 'Mark as manually refunded', 
    description: 'Mark refund as completed outside Shopify (no API call)',
    requiresCustomer: false
  }
] as const;

type RefundMethod = typeof REFUND_METHODS[number]['id'];

const DEFAULT_REVERSE_SHIPMENT_FEE = '75.00';

// Utility function for currency formatting
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Password Prompt Modal Component
const PasswordPromptModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  isLoading?: boolean;
  error?: string | null;
}> = ({ isOpen, onClose, onConfirm, isLoading = false, error = null }) => {
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onConfirm(password);
      setPassword('');
    }
  };

  const handleClose = () => {
    setPassword('');
    onClose();
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} title="Verify Refund">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">
            Enter Refund Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your refund password"
            autoFocus
            disabled={isLoading}
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4B3E99] focus:border-transparent"
          />
          <p className="text-xs text-slate-500">
            This password is required to process refunds for security purposes.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="flex-1 bg-[#4B3E99] hover:bg-[#3d3280] text-white font-medium py-2 rounded-md text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Verifying...
              </span>
            ) : 'Confirm Refund'}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};

// CheckboxWithInput component with quantity multiplier support
const CheckboxWithInput: React.FC<CheckboxWithInputProps & { 
  showQuantityMultiplier?: boolean; 
  quantity?: number;
}> = ({ 
  label, 
  checked, 
  onChangeCheck, 
  inputValue, 
  onChangeInput, 
  placeholder = "0.00",
  disabled = false,
  inputDisabled = false,
  min = 0,
  max,
  showQuantityMultiplier = false,
  quantity = 1
}) => {
  const numericValue = parseFloat(inputValue) || 0;
  const multipliedTotal = numericValue * quantity;
  
  return (
    <div className="space-y-2">
      <label className={`flex items-center gap-3 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input 
          type="checkbox" 
          checked={checked} 
          onChange={(e) => !disabled && onChangeCheck(e.target.checked)} 
          disabled={disabled}
          className="w-4 h-4 rounded border-slate-300 text-[#0066FF] focus:ring-[#0066FF] cursor-pointer disabled:cursor-not-allowed" 
        />
        <span className="text-slate-700 text-sm">{label}</span>
      </label>
      {checked && (
        <div className="ml-7">
          <div className="flex border border-slate-200 rounded-md overflow-hidden w-full max-w-[220px]">
            <span className="px-3 py-2 bg-[#F4F4F9] border-r border-slate-200 text-slate-700 font-medium text-sm flex items-center">
              ₹
            </span>
            <input 
              type="number" 
              value={inputValue} 
              onChange={(e) => {
                const val = e.target.value;
                let numVal = parseFloat(val);
                
                if (isNaN(numVal)) {
                  onChangeInput('0');
                  return;
                }
                
                if (max !== undefined && numVal > max) {
                  numVal = max;
                }
                if (numVal < min) {
                  numVal = min;
                }
                
                onChangeInput(numVal.toString());
              }} 
              placeholder={placeholder} 
              disabled={inputDisabled || disabled}
              className="w-full px-3 py-2 text-sm outline-none bg-[#F8F9FC] disabled:bg-slate-100 disabled:cursor-not-allowed" 
              min={min}
              max={max}
              step="0.01"
            />
          </div>
          {showQuantityMultiplier && quantity > 1 && (
            <div className="text-xs text-slate-500 mt-1 ml-1">
              × {quantity} items = ₹{formatCurrency(multipliedTotal)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Summary Row Component
const SummaryRow: React.FC<{ label: string; value: number; className?: string }> = ({ 
  label, 
  value, 
  className = "text-slate-700" 
}) => (
  <div className={`flex justify-between text-xs ${className}`}>
    <span>{label}</span>
    <span>₹{formatCurrency(value)}</span>
  </div>
);

export const IssueRefundModal: React.FC<IssueRefundModalProps> = ({ 
  isOpen, 
  onClose, 
  orderId, 
  data,
  currentUser,
  shopifyOrder 
}) => {
  // State management
  const [loading, setLoading] = useState(false);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('store_credit');
  const [error, setError] = useState<string | null>(null);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  
  // Password protection states
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordVerifying, setPasswordVerifying] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  
  // Deduction states
  const [deductRestocking, setDeductRestocking] = useState(false);
  const [restockingFee, setRestockingFee] = useState('');

  const [deductReverseShipment, setDeductReverseShipment] = useState(true);
  const [reverseShipmentFee, setReverseShipmentFee] = useState(DEFAULT_REVERSE_SHIPMENT_FEE);

  const [adjustRefund, setAdjustRefund] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');

  const [deductForwardShipment, setDeductForwardShipment] = useState(false);
  const [forwardShipmentFee, setForwardShipmentFee] = useState('0.00');

  const [deductTaxes, setDeductTaxes] = useState(false);
  const [taxInput, setTaxInput] = useState('');

  // Computed values
  const [calculatedTax, setCalculatedTax] = useState(0);
  const [calculatedBaseRefund, setCalculatedBaseRefund] = useState(0);

  // Check if order has customer (for methods that require it)
  const hasCustomer = useMemo(() => {
    return !!shopifyOrder?.customer?.id;
  }, [shopifyOrder]);

  // Get order display name
  const orderDisplayName = useMemo(() => {
    return shopifyOrder?.name || `#${shopifyOrder?.order_number}` || orderId;
  }, [shopifyOrder, orderId]);

  const totalQuantityReturned = useMemo(() => {
    return data?.items?.reduce((acc: number, item: ReturnItem) => acc + (item.quantityReturned || 0), 0) || 0;
  }, [data?.items]);

  // Calculate multiplied deductions
  const totalRestockingDeduction = useMemo(() => {
    return deductRestocking ? (parseFloat(restockingFee || '0') * totalQuantityReturned) : 0;
  }, [deductRestocking, restockingFee, totalQuantityReturned]);

  const totalReverseShipmentDeduction = useMemo(() => {
    return deductReverseShipment ? (parseFloat(reverseShipmentFee || '0') * totalQuantityReturned) : 0;
  }, [deductReverseShipment, reverseShipmentFee, totalQuantityReturned]);

  const totalForwardShipmentDeduction = useMemo(() => {
    return deductForwardShipment ? (parseFloat(forwardShipmentFee || '0') * totalQuantityReturned) : 0;
  }, [deductForwardShipment, forwardShipmentFee, totalQuantityReturned]);

  const adjustmentAmountValue = useMemo(() => {
    return adjustRefund ? (parseFloat(adjustmentAmount || '0') * totalQuantityReturned) : 0;
  }, [adjustRefund, adjustmentAmount, totalQuantityReturned]);

  const taxDeduction = useMemo(() => {
    return deductTaxes ? parseFloat(taxInput || '0') : 0;
  }, [deductTaxes, taxInput]);

  const totalDeduction = useMemo(() => {
    return (
      totalRestockingDeduction + 
      totalReverseShipmentDeduction +
      totalForwardShipmentDeduction +
      adjustmentAmountValue +
      taxDeduction
    );
  }, [
    totalRestockingDeduction, 
    totalReverseShipmentDeduction,
    totalForwardShipmentDeduction,
    adjustmentAmountValue,
    taxDeduction
  ]);

  const finalRefundAmount = useMemo(() => {
    return Math.max(0, calculatedBaseRefund - totalDeduction);
  }, [calculatedBaseRefund, totalDeduction]);

  const isRefundValid = useMemo(() => {
    if (finalRefundAmount <= 0 && refundMethod !== 'manual') {
      return false;
    }
    
    const selectedMethod = REFUND_METHODS.find(m => m.id === refundMethod);
    if (selectedMethod?.requiresCustomer && !hasCustomer) {
      return false;
    }
    
    return true;
  }, [finalRefundAmount, refundMethod, hasCustomer]);

  const validationError = useMemo(() => {
    if (finalRefundAmount <= 0 && refundMethod !== 'manual') {
      return 'Refund amount must be greater than 0';
    }
    
    const selectedMethod = REFUND_METHODS.find(m => m.id === refundMethod);
    if (selectedMethod?.requiresCustomer && !hasCustomer) {
      return 'This refund method requires a customer account';
    }
    
    return null;
  }, [finalRefundAmount, refundMethod, hasCustomer]);

  // Password verification function
  const verifyPassword = useCallback(async (enteredPassword: string): Promise<boolean> => {
    const correctPassword = import.meta.env.VITE_REFUND_PASSWORD;
    
    if (!correctPassword) {
      console.error('Refund password not configured in environment variables');
      throw new Error('Refund password not configured. Please contact administrator.');
    }
    
    return enteredPassword === correctPassword;
  }, []);

  // Calculate base refund and tax from items
  useEffect(() => {
    if (data?.items && data.items.length > 0) {
      let baseRefund = 0;
      let totalReturnTax = 0;

      data.items.forEach((returnedItem: ReturnItem) => {
        const matchedLineItem = shopifyOrder?.line_items?.find(
          (li: ShopifyLineItem) => li.id === Number(returnedItem.lineItemId) || li.sku === returnedItem.sku
        );

        if (matchedLineItem) {
          const originalPrice = parseFloat(String(matchedLineItem.price)) || 0;
          
          const totalLineDiscount = matchedLineItem.discount_allocations?.reduce(
            (sum: number, alloc: any) => sum + parseFloat(String(alloc.amount)),
            0
          ) || 0;

          const discountPerUnit = totalLineDiscount / matchedLineItem.quantity;
          const paidPricePerUnit = originalPrice - discountPerUnit;

          baseRefund += (paidPricePerUnit * returnedItem.quantityReturned);

          if (matchedLineItem.tax_lines) {
            const itemTotalTax = matchedLineItem.tax_lines.reduce(
              (sum: number, tax: any) => sum + parseFloat(String(tax.price)), 
              0
            );
            const taxPerUnit = itemTotalTax / matchedLineItem.quantity;
            totalReturnTax += (taxPerUnit * returnedItem.quantityReturned);
          }
        } else {
          const price = parseFloat(returnedItem.price.replace(/[^0-9.]/g, '')) || 0;
          baseRefund += (price * returnedItem.quantityReturned);
        }
      });

      setCalculatedBaseRefund(baseRefund);
      setCalculatedTax(totalReturnTax);
      setTaxInput(totalReturnTax.toFixed(2));
    }
  }, [data, shopifyOrder]);

  const prepareLineItems = useCallback(() => {
    if (!data?.items) return [];
    
    return data.items
      .filter(item => item.lineItemId)
      .map(item => ({
        lineItemId: `gid://shopify/LineItem/${item.lineItemId}`,
        quantity: item.quantityReturned,
        sku: item.sku
      }));
  }, [data?.items]);

  const prepareNote = useCallback(() => {
    const deductions = [];
    if (deductRestocking) deductions.push('Restocking fee applied');
    if (deductReverseShipment) deductions.push('Reverse shipment cost deducted');
    if (deductForwardShipment) deductions.push('Forward shipment cost deducted');
    if (adjustRefund) deductions.push('Adjustment applied');
    if (deductTaxes) deductions.push('Taxes deducted');
    
    const deductionsText = deductions.length > 0 
      ? ` (${deductions.join(', ')})` 
      : '';
    
    return `Refund for return ${orderDisplayName}${deductionsText}`;
  }, [orderDisplayName, deductRestocking, deductReverseShipment, deductForwardShipment, adjustRefund, deductTaxes]);

  const processRefund = useCallback(async (): Promise<RefundResult> => {
    const apiKey = import.meta.env.VITE_FLASK_API_KEY;
    
    if (!apiKey) {
      throw new Error('API key not configured');
    }

    const payload = {
      orderId: orderId,
      shopifyOrderId: shopifyOrder?.id ? `gid://shopify/Order/${shopifyOrder.id}` : undefined,
      amount: finalRefundAmount.toFixed(2),
      note: prepareNote(),
      lineItems: prepareLineItems(),
      notifyCustomer: notifyCustomer,
      metadata: {
        baseAmount: calculatedBaseRefund,
        deductions: {
          restocking: totalRestockingDeduction,
          reverseShipment: totalReverseShipmentDeduction,
          forwardShipment: totalForwardShipmentDeduction,
          adjustment: adjustmentAmountValue,
          taxes: taxDeduction
        },
        agentName: currentUser?.name || 'Unknown Agent',
        orderName: orderDisplayName,
        quantityMultiplied: {
          restocking: deductRestocking,
          reverseShipment: deductReverseShipment,
          forwardShipment: deductForwardShipment,
          adjustment: adjustRefund
        }
      }
    };

    const endpointMap: Record<RefundMethod, string> = {
      giftcard: '/refund/gift-card',
      original: '/refund/original-payment',
      store_credit: '/refund/store-credit',
      manual: '/refund/manual'
    };

    const endpoint = endpointMap[refundMethod];
    const response = await apiClient.post(endpoint, payload);
    const responseData = response.data;

    if (responseData && responseData.success === false) {
      throw new Error(responseData.error || responseData.errorMessage || 'Failed to process refund');
    }

    return responseData;
  }, [
    orderId, shopifyOrder?.id, finalRefundAmount, refundMethod, 
    notifyCustomer, prepareNote, prepareLineItems,
    calculatedBaseRefund, totalRestockingDeduction, totalReverseShipmentDeduction,
    totalForwardShipmentDeduction, adjustmentAmountValue, taxDeduction,
    orderDisplayName, deductRestocking, deductReverseShipment, deductForwardShipment, adjustRefund, currentUser
  ]);

  // Main refund handler - shows password prompt first
  const handleIssueRefund = useCallback(async () => {
    if (!isRefundValid) {
      setError(validationError || 'Refund is not valid');
      return;
    }

    setShowPasswordPrompt(true);
  }, [isRefundValid, validationError]);

  // Process refund after password verification
  const processRefundWithPassword = useCallback(async (password: string) => {
    setPasswordVerifying(true);
    setPasswordError(null);

    try {
      const isValid = await verifyPassword(password);
      
      if (!isValid) {
        setPasswordError('Invalid password. Please try again.');
        setPasswordVerifying(false);
        return;
      }

      setPasswordVerifying(false);
      setShowPasswordPrompt(false);
      setLoading(true);
      setError(null);

      const refundResult = await processRefund();

      if (!refundResult.success) {
        throw new Error(refundResult.errorMessage || 'Refund failed');
      }

      if (refundMethod !== 'manual' && notifyCustomer) {
        const mappedMethod = 
          refundMethod === 'original' ? 'original_payment' : 
          refundMethod === 'giftcard' ? 'gift_card' : 
          'store_credit';

        await notifyRefundDone(data, {
          method: mappedMethod,
          amount: finalRefundAmount,
          giftCardCode: refundResult.giftCardCode,
          transactionId: refundResult.transactionId,
          creditReference: data.RAN
        });
      }

      let successMessage = 'Refund processed successfully!';
      if (refundMethod === 'giftcard' && refundResult.giftCardCode) {
        successMessage = `Gift card created successfully! Code: ${refundResult.giftCardCode}`;
      } else if (refundMethod === 'store_credit') {
        successMessage = 'Store credit issued successfully!';
      } else if (refundMethod === 'original') {
        successMessage = `Refund processed to original payment method${notifyCustomer ? ' and customer notified' : ''}!`;
      } else if (refundMethod === 'manual') {
        successMessage = 'Refund marked as manually processed!';
      }

      if (!refundResult.firebaseUpdated) {
        successMessage += ' (Note: Firebase update may have failed - check logs)';
      }

      alert(successMessage);
      onClose();
      
    } catch (error: any) {
      console.error('Error issuing refund:', error);
      
      const errorMessage = error.response?.data?.error 
        || error.response?.data?.errorMessage 
        || (error instanceof Error ? error.message : 'Failed to process refund. Please try again.');
      
      setPasswordError(errorMessage);
      setPasswordVerifying(false);
    } finally {
      setLoading(false);
    }
  }, [verifyPassword, processRefund, refundMethod, notifyCustomer, finalRefundAmount, data, onClose]);

  const handleClose = useCallback(() => {
    setError(null);
    setLoading(false);
    setRefundMethod('store_credit');
    setNotifyCustomer(true);
    setDeductRestocking(false);
    setRestockingFee('');
    setDeductReverseShipment(true);
    setReverseShipmentFee(DEFAULT_REVERSE_SHIPMENT_FEE);
    setAdjustRefund(false);
    setAdjustmentAmount('');
    setDeductForwardShipment(false);
    setForwardShipmentFee('0.00');
    setDeductTaxes(false);
    setTaxInput(calculatedTax.toFixed(2));
    setShowPasswordPrompt(false);
    setPasswordError(null);
    setPasswordVerifying(false);
    onClose();
  }, [onClose, calculatedTax]);

  return (
    <>
      <BaseModal isOpen={isOpen} onClose={handleClose} title="Issue Refund">
        <div className="space-y-4 text-slate-800">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              <strong className="font-medium">Error: </strong>
              {error}
            </div>
          )}

          {validationError && !error && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
              <strong className="font-medium">Notice: </strong>
              {validationError}
            </div>
          )}

          <div className="flex justify-between items-center mb-2">
            <p className="text-sm text-slate-700">Order: <span className="font-medium">{orderDisplayName}</span></p>
            {shopifyOrder?.customer?.email && (
              <p className="text-xs text-slate-500">Customer: {shopifyOrder.customer.email}</p>
            )}
          </div>

          <p className="text-sm text-slate-700 mb-2">Select Refund Options</p>

          <div className="space-y-2 mb-6">
            {REFUND_METHODS.map((option) => {
              const isDisabled = option.requiresCustomer && !hasCustomer;
              
              return (
                <div 
                  key={option.id}
                  onClick={() => !loading && !isDisabled && setRefundMethod(option.id)} 
                  className={`p-3.5 rounded-lg cursor-pointer border flex flex-col transition-all ${
                    refundMethod === option.id 
                      ? 'border-slate-800 bg-[#F8F9FC]'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  } ${(loading || isDisabled) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex justify-between items-center">
                    <span className={`text-sm ${refundMethod === option.id ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                      {option.label}
                    </span>
                    <div 
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                        refundMethod === option.id 
                          ? 'border-slate-900 border-[5px]' 
                          : 'border-slate-300'
                      }`} 
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1">{option.description}</span>
                  {isDisabled && (
                    <span className="text-xs text-amber-600 mt-1">Requires customer account</span>
                  )}
                </div>
              );
            })}
          </div>

          {refundMethod === 'original' && (
            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id="notifyCustomer"
                checked={notifyCustomer}
                onChange={(e) => setNotifyCustomer(e.target.checked)}
                disabled={loading}
                className="w-4 h-4 rounded border-slate-300 text-[#0066FF] focus:ring-[#0066FF]"
              />
              <label htmlFor="notifyCustomer" className="text-sm text-slate-700">
                Notify customer via email about this refund
              </label>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <CheckboxWithInput 
              label="Deduct Restocking Fee" 
              checked={deductRestocking} 
              onChangeCheck={setDeductRestocking} 
              inputValue={restockingFee} 
              onChangeInput={setRestockingFee}
              disabled={loading}
              min={0}
              max={calculatedBaseRefund}
              showQuantityMultiplier={true}
              quantity={totalQuantityReturned}
            />
            
            <CheckboxWithInput 
              label="Deduct Reverse Shipment Cost" 
              checked={deductReverseShipment} 
              onChangeCheck={setDeductReverseShipment} 
              inputValue={reverseShipmentFee} 
              onChangeInput={setReverseShipmentFee} 
              placeholder={DEFAULT_REVERSE_SHIPMENT_FEE}
              disabled={loading}
              min={0}
              max={calculatedBaseRefund}
              showQuantityMultiplier={true}
              quantity={totalQuantityReturned}
            />
            
            <CheckboxWithInput 
              label="Adjust refund amount" 
              checked={adjustRefund} 
              onChangeCheck={setAdjustRefund} 
              inputValue={adjustmentAmount} 
              onChangeInput={setAdjustmentAmount}
              disabled={loading}
              min={-calculatedBaseRefund / totalQuantityReturned}
              max={calculatedBaseRefund / totalQuantityReturned}
              showQuantityMultiplier={true}
              quantity={totalQuantityReturned}
            />
            
            <CheckboxWithInput 
              label="Deduct Forward Shipment Cost" 
              checked={deductForwardShipment} 
              onChangeCheck={setDeductForwardShipment} 
              inputValue={forwardShipmentFee} 
              onChangeInput={setForwardShipmentFee}
              disabled={loading}
              min={0}
              max={calculatedBaseRefund}
              showQuantityMultiplier={true}
              quantity={totalQuantityReturned}
            />
            
            <CheckboxWithInput 
              label={`Deduct Taxes from Refund (₹${formatCurrency(calculatedTax)})`} 
              checked={deductTaxes} 
              onChangeCheck={setDeductTaxes} 
              inputValue={taxInput} 
              onChangeInput={setTaxInput}
              disabled={loading}
              inputDisabled={!deductTaxes}
              min={0}
              max={calculatedTax}
              showQuantityMultiplier={false}
            />
          </div>

          <div className="bg-[#F4F4F9] p-4 rounded-lg mt-6 space-y-2.5">
            <h4 className="font-medium text-sm text-slate-800 mb-2">Refund Summary</h4>
            
            <SummaryRow label="Calculated Refund Amount" value={calculatedBaseRefund} />
            
            {deductRestocking && (
              <SummaryRow 
                label={`Restocking Fee (₹${restockingFee || 0} × ${totalQuantityReturned} items)`} 
                value={-totalRestockingDeduction} 
                className="text-red-600"
              />
            )}
            
            {deductReverseShipment && (
              <SummaryRow 
                label={`Reverse Shipment (₹${reverseShipmentFee || 0} × ${totalQuantityReturned} items)`} 
                value={-totalReverseShipmentDeduction} 
                className="text-red-600"
              />
            )}
            
            {deductForwardShipment && (
              <SummaryRow 
                label={`Forward Shipment (₹${forwardShipmentFee || 0} × ${totalQuantityReturned} items)`} 
                value={-totalForwardShipmentDeduction} 
                className="text-red-600"
              />
            )}
            
            {adjustRefund && (
              <SummaryRow 
                label={`Adjustment Amount (₹${adjustmentAmount || 0} × ${totalQuantityReturned} items)`} 
                value={-adjustmentAmountValue} 
                className="text-orange-600"
              />
            )}
            
            {deductTaxes && (
              <SummaryRow 
                label="Tax Deduction" 
                value={-taxDeduction} 
                className="text-red-600"
              />
            )}
            
            <div className="border-t border-slate-200 my-2" />
            
            <SummaryRow label="Total Deductions" value={totalDeduction} className="text-slate-600" />
            
            <div className="flex justify-between font-bold text-sm text-slate-900 pt-1">
              <span>Final Refund Amount</span>
              <span className={finalRefundAmount < 0 ? 'text-red-600' : 'text-green-600'}>
                ₹{formatCurrency(finalRefundAmount)}
              </span>
            </div>
            
            {finalRefundAmount < 0 && (
              <p className="text-xs text-red-600 mt-1">
                Warning: Refund amount is negative. Please adjust deductions.
              </p>
            )}
          </div>

          <div className="pt-4 pb-2">
            <button 
              onClick={handleIssueRefund} 
              disabled={loading || !isRefundValid} 
              className={`w-full bg-[#4B3E99] hover:bg-[#3d3280] text-white font-medium py-2.5 rounded text-sm transition-colors 
                ${(loading || !isRefundValid) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : `Issue Refund (₹${formatCurrency(finalRefundAmount)})`}
            </button>
          </div>

          {refundMethod === 'manual' && (
            <p className="text-xs text-slate-500 text-center">
              Note: This will mark the refund as completed in the system. 
              You are responsible for processing the refund manually outside of Shopify.
            </p>
          )}
          
          {refundMethod === 'original' && shopifyOrder?.paymentGatewayNames && (
            <p className="text-xs text-slate-500 text-center">
              Refund will be processed through {shopifyOrder.paymentGatewayNames.join(', ')}.
            </p>
          )}
        </div>
      </BaseModal>

      <PasswordPromptModal
        isOpen={showPasswordPrompt}
        onClose={() => {
          setShowPasswordPrompt(false);
          setPasswordError(null);
        }}
        onConfirm={processRefundWithPassword}
        isLoading={passwordVerifying}
        error={passwordError}
      />
    </>
  );
};

export default IssueRefundModal;