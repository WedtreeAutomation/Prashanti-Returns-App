import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import {
  RefreshCw, AlertCircle, CheckCircle2,
  Loader2, ArrowRight, ShoppingBag,
  Tag, Layers, Info,
} from 'lucide-react';
import { db } from '../Interfaces/firebase';
import {
  doc, updateDoc, addDoc, collection, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { apiClient } from '../Interfaces/api';
import { ReturnData, ReturnItem, User } from '../Interfaces/types';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ShopifyVariant {
  id: number;
  title: string;           // e.g. "Red / XL"
  sku: string;
  price: string;
  compare_at_price: string | null;
  inventory_quantity: number;
  available: boolean;
  option1: string | null;  // e.g. "Red"
  option2: string | null;  // e.g. "XL"
  option3: string | null;
  image_id: number | null;
}

interface ShopifyProductOption {
  id: number;
  name: string;            // e.g. "Color", "Size"
  position: number;
  values: string[];        // e.g. ["Red", "Blue", "Green"]
}

interface ShopifyProductImage {
  id: number;
  src: string;
  variant_ids: number[];
  alt: string | null;
}

interface ShopifyProductFull {
  id: number;
  title: string;
  handle: string;
  product_type: string;
  tags: string;
  status: string;
  variants: ShopifyVariant[];
  options: ShopifyProductOption[];
  images: ShopifyProductImage[];
}

interface ExchangeLineItem {
  originalItem: ReturnItem;
  product: ShopifyProductFull | null;
  loadingProduct: boolean;
  errorProduct: string | null;
  selectedVariantId: number | null;
  selectedOptionValues: Record<string, string>; // { "Color": "Red", "Size": "XL" }
  quantity: number;
}

export interface ExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;      // Firestore doc ID
  data: ReturnData;
  currentUser?: User | null;
  onSuccess?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const formatCurrency = (price: string | number) => {
  const n = typeof price === 'string' ? parseFloat(price) : price;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n).replace('₹', '₹ ');
};

const getVariantImage = (
  product: ShopifyProductFull,
  variantId: number | null,
): string | null => {
  if (!product.images?.length) return null;
  // Try to find a variant-specific image first
  if (variantId) {
    const variantImg = product.images.find(
      i => i.variant_ids?.length > 0 && i.variant_ids.includes(variantId)
    );
    if (variantImg) return variantImg.src;
  }
  // Try to match via image_id on the variant object
  if (variantId) {
    const variant = product.variants.find(v => v.id === variantId);
    if (variant?.image_id) {
      const imgById = product.images.find(i => i.id === variant.image_id);
      if (imgById) return imgById.src;
    }
  }
  // Fall back to first product image
  return product.images[0]?.src ?? null;
};

// Find variant that matches current option selections
const findMatchingVariant = (
  variants: ShopifyVariant[],
  options: ShopifyProductOption[],
  selectedValues: Record<string, string>,
): ShopifyVariant | null => {
  return variants.find(v => {
    return options.every((opt, idx) => {
      const optionKey = `option${idx + 1}` as 'option1' | 'option2' | 'option3';
      const selected = selectedValues[opt.name];
      if (!selected) return true; // not yet selected, skip check
      return v[optionKey] === selected;
    });
  }) ?? null;
};

// ─── Option Selector ───────────────────────────────────────────────────────────
const OptionSelector = ({
  option,
  selectedValue,
  variants,
  options,
  allSelected,
  onSelect,
}: {
  option: ShopifyProductOption;
  selectedValue: string;
  variants: ShopifyVariant[];
  options: ShopifyProductOption[];
  allSelected: Record<string, string>;
  onSelect: (optionName: string, value: string) => void;
}) => {
  // Determine which values are available given OTHER options already selected
  const isValueAvailable = (value: string) => {
    const testSelection = { ...allSelected, [option.name]: value };
    return variants.some(v =>
      options.every((opt, idx) => {
        const optKey = `option${idx + 1}` as 'option1' | 'option2' | 'option3';
        const sel = testSelection[opt.name];
        if (!sel) return true;
        return v[optKey] === sel;
      }) && v.inventory_quantity > 0
    );
  };

  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        {option.name}
        {selectedValue && (
          <span className="ml-2 text-slate-700 normal-case font-normal">— {selectedValue}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {option.values.map(value => {
          const available = isValueAvailable(value);
          const isSelected = selectedValue === value;
          return (
            <button
              key={value}
              onClick={() => available && onSelect(option.name, value)}
              disabled={!available}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                isSelected
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : available
                    ? 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                    : 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed line-through'
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Single Item Exchange Card ─────────────────────────────────────────────────
const ItemExchangeCard = ({
  lineItem,
  index,
  onVariantSelect,
  onQuantityChange,
}: {
  lineItem: ExchangeLineItem;
  index: number;
  onVariantSelect: (idx: number, optionName: string, value: string) => void;
  onQuantityChange: (idx: number, qty: number) => void;
}) => {
  const { originalItem, product, loadingProduct, errorProduct, selectedOptionValues, selectedVariantId, quantity } = lineItem;

  const selectedVariant = useMemo(() => {
    if (!product || !selectedVariantId) return null;
    return product.variants.find(v => v.id === selectedVariantId) ?? null;
  }, [product, selectedVariantId]);

  const variantImage = product ? getVariantImage(product, selectedVariantId) : null;

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
      {/* Original item header */}
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center gap-3">
        <div className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-md flex items-center justify-center text-xs font-bold shrink-0">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{originalItem.title}</p>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
            <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
              {originalItem.sku !== 'N/A' ? originalItem.sku : 'No SKU'}
            </span>
            <span>·</span>
            <span>Qty returned: {originalItem.quantityReturned}</span>
            <span>·</span>
            <span>{originalItem.price}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100 shrink-0">
          <RefreshCw className="w-3 h-3" />
          Exchange
        </div>
      </div>

      <div className="p-5">
        {loadingProduct && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mr-3" />
            <span className="text-sm text-slate-500">Loading product variants...</span>
          </div>
        )}

        {errorProduct && (
          <div className="flex items-center gap-3 py-6 px-4 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">Failed to load variants</p>
              <p className="text-xs text-red-500 mt-0.5">{errorProduct}</p>
            </div>
          </div>
        )}

        {!loadingProduct && !errorProduct && product && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: variant image + selected summary */}
            <div className="space-y-4">
              <div className="aspect-square rounded-xl overflow-hidden bg-slate-50 border border-slate-200">
                {variantImage ? (
                  <img
                    src={variantImage}
                    alt={selectedVariant?.title ?? product.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                    <ShoppingBag className="w-12 h-12 mb-2" />
                    <p className="text-xs">No image</p>
                  </div>
                )}
              </div>

              {selectedVariant && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Selected Variant</p>
                  <p className="text-sm font-bold text-slate-900">{selectedVariant.title}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Price</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(selectedVariant.price)}</span>
                  </div>
                  {selectedVariant.sku && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">SKU</span>
                      <span className="font-mono text-xs bg-white px-2 py-0.5 rounded border border-slate-200">
                        {selectedVariant.sku}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Stock</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      selectedVariant.inventory_quantity > 5
                        ? 'bg-emerald-100 text-emerald-700'
                        : selectedVariant.inventory_quantity > 0
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}>
                      {selectedVariant.inventory_quantity > 0
                        ? `${selectedVariant.inventory_quantity} in stock`
                        : 'Out of stock'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: option selectors + qty */}
            <div className="space-y-5">
              <div>
                <p className="text-sm font-bold text-slate-800 mb-1">{product.title}</p>
                <p className="text-xs text-slate-400">{product.variants.length} variant{product.variants.length !== 1 ? 's' : ''} available</p>
              </div>

              {product.options.map(option => (
                <OptionSelector
                  key={option.id}
                  option={option}
                  selectedValue={selectedOptionValues[option.name] ?? ''}
                  variants={product.variants}
                  options={product.options}
                  allSelected={selectedOptionValues}
                  onSelect={(name, value) => onVariantSelect(index, name, value)}
                />
              ))}

              {/* Quantity */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Quantity
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onQuantityChange(index, Math.max(1, quantity - 1))}
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 font-bold text-lg transition-colors"
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-bold text-slate-900 text-lg tabular-nums">
                    {quantity}
                  </span>
                  <button
                    onClick={() => onQuantityChange(
                      index,
                      selectedVariant
                        ? Math.min(selectedVariant.inventory_quantity, quantity + 1)
                        : quantity + 1
                    )}
                    disabled={selectedVariant ? quantity >= selectedVariant.inventory_quantity : false}
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-700 font-bold text-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                  <span className="text-xs text-slate-400">
                    (originally returned {originalItem.quantityReturned})
                  </span>
                </div>
              </div>

              {/* Price diff note */}
              {selectedVariant && (
                (() => {
                  const origPrice = parseFloat(originalItem.price.replace(/[^0-9.]/g, '')) || 0;
                  const newPrice  = parseFloat(selectedVariant.price) || 0;
                  const diff      = (newPrice - origPrice) * quantity;
                  if (Math.abs(diff) < 0.01) return null;
                  return (
                    <div className={`flex items-start gap-2 p-3 rounded-xl border text-xs ${
                      diff > 0
                        ? 'bg-amber-50 border-amber-100 text-amber-700'
                        : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                    }`}>
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        {diff > 0
                          ? `Customer owes ${formatCurrency(diff)} extra for this exchange.`
                          : `Store owes customer ${formatCurrency(Math.abs(diff))} difference.`}
                      </span>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
// MAIN MODAL
// ════════════════════════════════════════════════════════════════════════════════
export const ExchangeModal: React.FC<ExchangeModalProps> = ({
  isOpen, onClose, orderId, data, currentUser, onSuccess,
}) => {
  const [lineItems, setLineItems]     = useState<ExchangeLineItem[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);
  const [exchangeNotes, setExchangeNotes] = useState('');

  // Build initial line items from return items
  const initLineItems = useCallback(() => {
    if (!data?.items?.length) return;
    setLineItems(
      data.items.map(item => ({
        originalItem: item,
        product: null,
        loadingProduct: false,
        errorProduct: null,
        selectedVariantId: null,
        selectedOptionValues: {},
        quantity: item.quantityReturned,
      }))
    );
  }, [data?.items]);

  useEffect(() => {
    if (isOpen) {
      initLineItems();
      setError(null);
      setSuccess(false);
      setExchangeNotes('');
    }
  }, [isOpen, initLineItems]);

  // Fetch product variants for each item when modal opens
  useEffect(() => {
    if (!isOpen || !lineItems.length) return;

    lineItems.forEach((li, idx) => {
      // Already loaded or loading
      if (li.product || li.loadingProduct) return;

      const productId = (li.originalItem as any).productId
        ?? (li.originalItem as any).product_id
        ?? null;

      const sku = li.originalItem.sku && li.originalItem.sku !== 'N/A'
        ? li.originalItem.sku
        : null;

      if (!productId && !sku) {
        setLineItems(prev => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            errorProduct: 'No product ID or SKU found for this item.',
            loadingProduct: false,
          };
          return next;
        });
        return;
      }

      // Mark as loading
      setLineItems(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], loadingProduct: true, errorProduct: null };
        return next;
      });

      // Use productId if available, otherwise fall back to SKU lookup
      const request = productId
        ? apiClient.get<{ product: ShopifyProductFull }>(`/products/${productId}/variants`)
        : apiClient.get<{ product: ShopifyProductFull }>(`/products/by-sku/${encodeURIComponent(sku!)}/variants`);

      request
        .then(res => {
          const product = res.data.product;
          // Pre-select options that match the original item's SKU if possible
          const matchingVariant = product.variants.find(
            v => v.sku === li.originalItem.sku
          );
          const preselected: Record<string, string> = {};
          if (matchingVariant) {
            product.options.forEach((opt, i) => {
              const key = `option${i + 1}` as 'option1' | 'option2' | 'option3';
              const val = matchingVariant[key];
              if (val) preselected[opt.name] = val;
            });
          }
          setLineItems(prev => {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              product,
              loadingProduct: false,
              selectedOptionValues: preselected,
              selectedVariantId: matchingVariant?.id ?? null,
            };
            return next;
          });
        })
        .catch(err => {
          setLineItems(prev => {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              loadingProduct: false,
              errorProduct: err.response?.data?.error ?? err.message ?? 'Failed to load product',
            };
            return next;
          });
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lineItems.length]);

  // Handle option selection — auto-resolve variant
  const handleVariantSelect = useCallback((itemIdx: number, optionName: string, value: string) => {
    setLineItems(prev => {
      const next = [...prev];
      const li   = next[itemIdx];
      if (!li.product) return next;

      const newSelected = { ...li.selectedOptionValues, [optionName]: value };
      // Try to find a unique matching variant
      const matched = findMatchingVariant(li.product.variants, li.product.options, newSelected);

      next[itemIdx] = {
        ...li,
        selectedOptionValues: newSelected,
        selectedVariantId: matched?.id ?? null,
      };
      return next;
    });
  }, []);

  const handleQuantityChange = useCallback((itemIdx: number, qty: number) => {
    setLineItems(prev => {
      const next = [...prev];
      next[itemIdx] = { ...next[itemIdx], quantity: qty };
      return next;
    });
  }, []);

  // Validation
  const canSubmit = useMemo(() => {
    if (!lineItems.length) return false;
    return lineItems.every(li => {
      if (li.loadingProduct || li.errorProduct) return false;
      if (!li.selectedVariantId) return false;
      const variant = li.product?.variants.find(v => v.id === li.selectedVariantId);
      if (!variant) return false;
      if (variant.inventory_quantity <= 0) return false;
      return li.quantity >= 1 && li.quantity <= variant.inventory_quantity;
    });
  }, [lineItems]);

  // Order value summary
  const priceSummary = useMemo(() => {
    let originalTotal = 0;
    let newTotal      = 0;
    lineItems.forEach(li => {
      const origPrice = parseFloat(li.originalItem.price.replace(/[^0-9.]/g, '')) || 0;
      originalTotal  += origPrice * li.originalItem.quantityReturned;
      const variant = li.product?.variants.find(v => v.id === li.selectedVariantId);
      if (variant) newTotal += parseFloat(variant.price) * li.quantity;
    });
    return { originalTotal, newTotal, diff: newTotal - originalTotal };
  }, [lineItems]);

  const agentName = useMemo(() => {
    if (currentUser?.name) return currentUser.name;
    if (currentUser?.email) return currentUser.email.split('@')[0];
    return 'Agent';
  }, [currentUser]);

  // Submit
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      const exchangeItems = lineItems.map(li => {
        const variant = li.product!.variants.find(v => v.id === li.selectedVariantId)!;
        return {
          originalItem: {
            lineItemId:        li.originalItem.lineItemId,
            title:             li.originalItem.title,
            sku:               li.originalItem.sku,
            price:             li.originalItem.price,
            quantityReturned:  li.originalItem.quantityReturned,
          },
          replacementVariant: {
            variantId:    variant.id,
            title:        variant.title,
            sku:          variant.sku,
            price:        variant.price,
            productTitle: li.product!.title,
            productId:    li.product!.id,
            options:      li.selectedOptionValues,
          },
          quantity: li.quantity,
          priceDiff: (parseFloat(variant.price) - parseFloat(li.originalItem.price.replace(/[^0-9.]/g, '') || '0')) * li.quantity,
        };
      });

      const returnRef = doc(db, 'returns', orderId);
      await updateDoc(returnRef, {
        type:          'Exchange',
        exchangeStatus: 'Pending',
        exchangeItems,
        exchangeRequestedAt: serverTimestamp(),
        exchangeRequestedBy: agentName,
        exchangeNotes:       exchangeNotes.trim() || null,
        updatedAt:           serverTimestamp(),
      });

      // Activity log
      const activitiesRef = collection(db, 'returns', orderId, 'activities');
      await addDoc(activitiesRef, {
        type:        'info',
        title:       'Exchange Requested',
        description: `Exchange created for ${exchangeItems.length} item(s). ${
          Math.abs(priceSummary.diff) > 0.01
            ? priceSummary.diff > 0
              ? `Customer owes ₹${priceSummary.diff.toFixed(2)} extra.`
              : `Store owes customer ₹${Math.abs(priceSummary.diff).toFixed(2)}.`
            : 'No price difference.'
        }`,
        timestamp:   Timestamp.now(),
        user:        agentName,
        metadata: {
          exchangeItems,
          originalTotal:  priceSummary.originalTotal,
          newTotal:        priceSummary.newTotal,
          priceDifference: priceSummary.diff,
        },
      });

      setSuccess(true);
      onSuccess?.();
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1800);
    } catch (err: any) {
      console.error('Exchange submit error:', err);
      setError(err.message ?? 'Failed to save exchange. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Exchange"
      maxWidth="max-w-5xl"
    >
      <div className="space-y-5">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
          <p>
            Select replacement variants for each returned item. Only in-stock variants are
            selectable. The exchange will be saved to Firestore — fulfillment is handled
            separately by your team.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p className="font-semibold">Exchange saved successfully!</p>
          </div>
        )}

        {/* Item cards */}
        {lineItems.map((li, idx) => (
          <ItemExchangeCard
            key={li.originalItem.lineItemId}
            lineItem={li}
            index={idx}
            onVariantSelect={handleVariantSelect}
            onQuantityChange={handleQuantityChange}
          />
        ))}

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">
            Internal Notes (optional)
          </label>
          <textarea
            value={exchangeNotes}
            onChange={e => setExchangeNotes(e.target.value)}
            placeholder="Any notes about this exchange for the team..."
            rows={2}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-200 outline-none resize-none"
          />
        </div>

        {/* Price summary */}
        {lineItems.some(li => li.selectedVariantId) && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-2.5">
            <p className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-slate-500" />
              Exchange Summary
            </p>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Original return value</span>
              <span className="font-medium tabular-nums">{formatCurrency(priceSummary.originalTotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>New items value</span>
              <span className="font-medium tabular-nums">{formatCurrency(priceSummary.newTotal)}</span>
            </div>
            <div className="border-t border-slate-200 pt-2.5 flex justify-between text-sm font-bold">
              <span>
                {Math.abs(priceSummary.diff) < 0.01
                  ? 'No price difference'
                  : priceSummary.diff > 0
                    ? 'Amount to collect from customer'
                    : 'Amount to refund to customer'}
              </span>
              <span className={`tabular-nums ${
                Math.abs(priceSummary.diff) < 0.01
                  ? 'text-slate-500'
                  : priceSummary.diff > 0
                    ? 'text-amber-600'
                    : 'text-emerald-600'
              }`}>
                {Math.abs(priceSummary.diff) < 0.01
                  ? '—'
                  : formatCurrency(Math.abs(priceSummary.diff))}
              </span>
            </div>

            {/* Per item breakdown */}
            <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
              {lineItems.map((li, idx) => {
                if (!li.selectedVariantId || !li.product) return null;
                const variant = li.product.variants.find(v => v.id === li.selectedVariantId);
                if (!variant) return null;
                return (
                  <div key={idx} className="flex items-center gap-2 text-xs text-slate-500">
                    <Layers className="w-3 h-3 shrink-0" />
                    <span className="flex-1 truncate">{li.originalItem.title}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="font-medium text-slate-700 truncate">
                      {variant.title} × {li.quantity}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-3 border-2 border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || saving || success}
            className="flex-1 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Confirm Exchange
              </>
            )}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};

export default ExchangeModal;