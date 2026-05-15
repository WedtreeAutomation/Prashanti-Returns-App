import React, { useState } from 'react';
import {
    PackageOpen,
    Truck,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Wallet,
    MapPin,
    Phone,
    Mail,
    ChevronRight,
    Loader2,
    PackageCheck,
    PackageX,
    PackageSearch,
    RefreshCw,
    Gift,
    CreditCard,
    MessageCircle,
    ShoppingBag,
    User,
    Menu,
    X,
    ChevronLeft,
    Gift as GiftIcon,
    TrendingUp,
    Package
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../Interfaces/firebase';
import { Link } from 'react-router-dom';
import { ReturnData } from '../../Interfaces/types';

// ==========================================
// STATUS CONFIGURATION
// ==========================================
const STATUS_CONFIG = {
    'Open': {
        icon: PackageSearch,
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        gradient: 'from-blue-500 to-indigo-500',
        message: 'Our team will verify the images and reason provided.',
        action: 'Once approved, you will receive instructions for pickup or shipping.'
    },
    'Pickup Created': {
        icon: Truck,
        color: 'text-purple-600',
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        gradient: 'from-purple-500 to-pink-500',
        message: 'Your return has been approved!',
        action: 'The delivery agent will pick up the product on'
    },
    'Item Delivered': {
        icon: PackageCheck,
        color: 'text-green-600',
        bg: 'bg-green-50',
        border: 'border-green-200',
        gradient: 'from-green-500 to-emerald-500',
        message: 'We have received your return product.',
        action: 'Our team will inspect the items and process your refund shortly.'
    },
    'Closed': {
        icon: CheckCircle2,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        gradient: 'from-emerald-500 to-teal-500',
        message: 'Your return has been closed.',
        action: 'You can submit a new return if needed.'
    },
    'Denied': {
        icon: PackageX,
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        gradient: 'from-red-500 to-orange-500',
        message: 'Your return request has been denied.',
        action: 'This decision is final and cannot be appealed.'
    },
    'Rejected': {
        icon: XCircle,
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        gradient: 'from-red-500 to-rose-500',
        message: 'Your return request has been rejected.',
        action: 'Please contact customer support for more information.'
    },
    'Processing': {
        icon: RefreshCw,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        gradient: 'from-amber-500 to-orange-500',
        message: 'Your return is being processed.',
        action: 'We will update you once the verification is complete.'
    },
    'Refunded': {
        icon: CreditCard,
        color: 'text-indigo-600',
        bg: 'bg-indigo-50',
        border: 'border-indigo-200',
        gradient: 'from-indigo-500 to-purple-500',
        message: 'Your refund has been processed.',
        action: 'The amount will reflect in your account within 5-7 business days.'
    },
    'default': {
        icon: PackageOpen,
        color: 'text-slate-600',
        bg: 'bg-slate-50',
        border: 'border-slate-200',
        gradient: 'from-slate-500 to-slate-600',
        message: 'Return request status',
        action: 'Check back later for updates.'
    }
};

// ==========================================
// TYPES FOR BALANCES
// ==========================================
interface StoreCreditAccount {
    id: string;
    balance_amount: number;
    balance_currency: string;
}

interface GiftCard {
    id: string;
    balance_amount: number;
    balance_currency: string;
    code?: string;
    customer_id?: string;
}

interface BalanceResponse {
    customer_found: boolean;
    email: string;
    customer_graphql_id?: string;
    customer_legacy_id?: number;
    store_credit_accounts: StoreCreditAccount[];
    gift_cards: GiftCard[];
}

// ==========================================
// HELPER COMPONENTS
// ==========================================
const StatusBadge = ({ status }: { status: string }) => {
    const config = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.default;

    return (
        <span className={`inline-flex items-center px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold border ${config.bg} ${config.color} ${config.border} shadow-sm`}>
            <config.icon className="w-3 h-3 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
            {status}
        </span>
    );
};

const InfoCard = ({ icon: Icon, label, value, color = 'slate' }: { icon: any; label: string; value: string; color?: string }) => {
    const colorClasses = {
        indigo: 'bg-indigo-50 text-indigo-700',
        blue: 'bg-blue-50 text-blue-700',
        green: 'bg-green-50 text-green-700',
        amber: 'bg-amber-50 text-amber-700',
        red: 'bg-red-50 text-red-700',
        purple: 'bg-purple-50 text-purple-700',
        slate: 'bg-slate-50 text-slate-700'
    };

    return (
        <div className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 rounded-xl hover:bg-slate-50 transition-colors">
            <div className={`p-2 sm:p-3 rounded-lg flex-shrink-0 ${colorClasses[color as keyof typeof colorClasses]}`}>
                <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[10px] sm:text-xs font-medium text-slate-500 mb-0.5 sm:mb-1">{label}</div>
                <p className="text-xs sm:text-sm font-semibold text-slate-800 break-words">{value || 'Not provided'}</p>
            </div>
        </div>
    );
};

const calculateTotalAmount = (items: any[]) => {
    if (!items || !items.length) return "0.00";
    return items.reduce((sum, item) => {
        const priceStr = String(item.price || '0').replace(/[^0-9.]/g, '');
        const price = parseFloat(priceStr) || 0;
        const qty = item.quantityReturned || item.quantity || 1;
        return sum + (price * qty);
    }, 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const apiService = {
    async getCustomerBalances(identifier: string, identifierType: 'email' | 'phone'): Promise<BalanceResponse> {
        const apiKey = import.meta.env.VITE_FLASK_API_KEY;
        
        if (!apiKey) {
            console.error('API key not found in environment variables');
            throw new Error('API configuration error: Missing API key');
        }

        const baseUrl = import.meta.env.VITE_FLASK_API_URL || '';
        const url = `${baseUrl}/customer/balances`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({
                    identifier: identifier.trim(),
                    identifierType: identifierType
                })
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const text = await response.text();
                    if (text && text.trim()) {
                        const errorData = JSON.parse(text);
                        errorMessage = errorData.error || errorMessage;
                    }
                } catch (e) {
                    console.error('Failed to parse error response:', e);
                }
                throw new Error(errorMessage);
            }

            const text = await response.text();
            
            if (!text || text.trim() === '') {
                throw new Error('Empty response from server');
            }

            try {
                const data = JSON.parse(text);
                return data;
            } catch (e) {
                throw new Error('Invalid response format from server');
            }
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }
};

// ==========================================
// TAB COMPONENTS
// ==========================================

// Tab 1: Return Tracking
const ReturnTrackingTab = ({ searchTerm, setSearchTerm, searchType, setSearchType, loading, handleSearch, error }: any) => (
    <div className="space-y-4">
        <div className="text-center mb-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-[#5A0A38] to-[#7D1B54] rounded-xl flex items-center justify-center mx-auto mb-2 shadow-lg">
                <PackageOpen className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-slate-900">Track Your Return</h3>
            <p className="text-xs text-slate-500 mt-1">Enter order number, email, or phone to check return status</p>
        </div>

        {/* Search Type Tabs */}
        <div className="flex justify-center">
            <div className="bg-slate-100 p-1 rounded-xl inline-flex">
                {[
                    { type: 'order', label: 'Order', icon: ShoppingBag },
                    { type: 'email', label: 'Email', icon: Mail },
                    { type: 'phone', label: 'Phone', icon: Phone }
                ].map(({ type, label, icon: Icon }) => (
                    <button
                        key={type}
                        onClick={() => setSearchType(type as any)}
                        className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 ${
                            searchType === type
                                ? 'bg-white text-[#5A0A38] shadow-sm'
                                : 'text-slate-600 hover:text-slate-800'
                        }`}
                    >
                        <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        {label}
                    </button>
                ))}
            </div>
        </div>

        <form onSubmit={handleSearch}>
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    type={searchType === 'email' ? 'email' : 'text'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={
                        searchType === 'order' ? 'e.g., #1001 or 1001' :
                        searchType === 'email' ? 'Enter your email' :
                        'Enter your phone number'
                    }
                    className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#5A0A38]/20 focus:border-[#5A0A38] outline-none transition-all text-sm"
                    disabled={loading}
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="sm:w-auto bg-gradient-to-r from-[#5A0A38] to-[#7D1B54] hover:from-[#3A0624] hover:to-[#5A0A38] text-white font-medium px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 text-sm"
                >
                    {loading ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Searching...</span>
                        </>
                    ) : (
                        <>
                            <span>Track</span>
                            <ChevronRight className="w-4 h-4" />
                        </>
                    )}
                </button>
            </div>
        </form>

        {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p className="text-xs font-medium">{error}</p>
            </div>
        )}
    </div>
);

// Tab 2: Gift Cards
const GiftCardTab = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchType, setSearchType] = useState<'email' | 'phone'>('email');
    const [loading, setLoading] = useState(false);
    const [balances, setBalances] = useState<BalanceResponse | null>(null);
    const [error, setError] = useState('');

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchTerm.trim()) {
            setError('Please enter an email or phone number');
            return;
        }

        setLoading(true);
        setError('');
        setBalances(null);

        try {
            const data = await apiService.getCustomerBalances(searchTerm.trim(), searchType);
            setBalances(data);
            
            if (!data.customer_found) {
                setError(`No customer found with this ${searchType}`);
            }
        } catch (err: any) {
            console.error('Error fetching gift cards:', err);
            setError(err.message || 'Failed to fetch gift card balances. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const totalGiftCardBalance = balances?.gift_cards?.reduce((sum, gc) => sum + gc.balance_amount, 0) || 0;

    return (
        <div className="space-y-4">
            <div className="text-center mb-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-green-500 to-teal-600 rounded-xl flex items-center justify-center mx-auto mb-2 shadow-lg">
                    <GiftIcon className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-slate-900">Gift Card Balance</h3>
                <p className="text-xs text-slate-500 mt-1">Check your gift card balances by email or phone</p>
            </div>

            {/* Search Type Tabs */}
            <div className="flex justify-center">
                <div className="bg-slate-100 p-1 rounded-xl inline-flex">
                    {[
                        { type: 'email', label: 'Email', icon: Mail },
                        { type: 'phone', label: 'Phone', icon: Phone }
                    ].map(({ type, label, icon: Icon }) => (
                        <button
                            key={type}
                            onClick={() => setSearchType(type as any)}
                            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 ${
                                searchType === type
                                    ? 'bg-white text-green-600 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <form onSubmit={handleSearch}>
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        type={searchType === 'email' ? 'email' : 'tel'}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={searchType === 'email' ? 'customer@example.com' : 'Enter phone number'}
                        className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-200 focus:border-green-500 outline-none transition-all text-sm"
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="sm:w-auto bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white font-medium px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 text-sm"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Checking...</span>
                            </>
                        ) : (
                            <>
                                <span>Check Balance</span>
                                <ChevronRight className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </div>
            </form>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <p className="text-xs font-medium">{error}</p>
                </div>
            )}

            {/* Results */}
            {balances && balances.customer_found && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                    {/* Total Balance Card */}
                    {totalGiftCardBalance > 0 && (
                        <div className="bg-gradient-to-r from-green-500 to-teal-500 rounded-xl p-4 text-white">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs opacity-90">Total Gift Card Balance</p>
                                    <p className="text-2xl font-bold">
                                        {totalGiftCardBalance.toFixed(2)} {balances.gift_cards[0]?.balance_currency || 'INR'}
                                    </p>
                                </div>
                                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                    <GiftIcon className="w-5 h-5" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Gift Cards List */}
                    {balances.gift_cards.length > 0 ? (
                        <div className="space-y-2">
                            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <GiftIcon className="w-4 h-4" />
                                Available Gift Cards ({balances.gift_cards.length})
                            </h4>
                            {balances.gift_cards.map((gc, idx) => (
                                <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-xs text-slate-500">Gift Card ID</p>
                                            <p className="text-xs font-mono text-slate-600">{gc.id.split('/').pop()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500">Balance</p>
                                            <p className="text-lg font-bold text-green-600">
                                                {gc.balance_amount.toFixed(2)} {gc.balance_currency}
                                            </p>
                                        </div>
                                    </div>
                                    {gc.code && (
                                        <div className="mt-2 pt-2 border-t border-slate-100">
                                            <p className="text-xs text-slate-500">Code</p>
                                            <p className="text-xs font-mono font-semibold text-slate-700">{gc.code}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6 bg-slate-50 rounded-lg">
                            <GiftIcon className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">No gift cards found for this customer</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Tab 3: Store Credit
const StoreCreditTab = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchType, setSearchType] = useState<'email' | 'phone'>('email');
    const [loading, setLoading] = useState(false);
    const [balances, setBalances] = useState<BalanceResponse | null>(null);
    const [error, setError] = useState('');

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchTerm.trim()) {
            setError('Please enter an email or phone number');
            return;
        }

        setLoading(true);
        setError('');
        setBalances(null);

        try {
            const data = await apiService.getCustomerBalances(searchTerm.trim(), searchType);
            setBalances(data);
            
            if (!data.customer_found) {
                setError(`No customer found with this ${searchType}`);
            }
        } catch (err: any) {
            console.error('Error fetching store credit:', err);
            setError(err.message || 'Failed to fetch store credit balance. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const totalStoreCredit = balances?.store_credit_accounts?.reduce((sum, acc) => sum + acc.balance_amount, 0) || 0;

    return (
        <div className="space-y-4">
            <div className="text-center mb-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center mx-auto mb-2 shadow-lg">
                    <Wallet className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-slate-900">Store Credit Balance</h3>
                <p className="text-xs text-slate-500 mt-1">Check your store credit balance by email or phone</p>
            </div>

            {/* Search Type Tabs */}
            <div className="flex justify-center">
                <div className="bg-slate-100 p-1 rounded-xl inline-flex">
                    {[
                        { type: 'email', label: 'Email', icon: Mail },
                        { type: 'phone', label: 'Phone', icon: Phone }
                    ].map(({ type, label, icon: Icon }) => (
                        <button
                            key={type}
                            onClick={() => setSearchType(type as any)}
                            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 ${
                                searchType === type
                                    ? 'bg-white text-purple-600 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-800'
                            }`}
                        >
                            <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <form onSubmit={handleSearch}>
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        type={searchType === 'email' ? 'email' : 'tel'}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={searchType === 'email' ? 'customer@example.com' : 'Enter phone number'}
                        className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-500 outline-none transition-all text-sm"
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="sm:w-auto bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-70 text-sm"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Checking...</span>
                            </>
                        ) : (
                            <>
                                <span>Check Balance</span>
                                <ChevronRight className="w-4 h-4" />
                            </>
                        )}
                    </button>
                </div>
            </form>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <p className="text-xs font-medium">{error}</p>
                </div>
            )}

            {/* Results */}
            {balances && balances.customer_found && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4">
                    {/* Total Store Credit Card */}
                    {totalStoreCredit > 0 && (
                        <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-4 text-white">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs opacity-90">Total Store Credit Available</p>
                                    <p className="text-2xl font-bold">
                                        {totalStoreCredit.toFixed(2)} {balances.store_credit_accounts[0]?.balance_currency || 'INR'}
                                    </p>
                                </div>
                                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Store Credit Accounts */}
                    {balances.store_credit_accounts.length > 0 ? (
                        <div className="space-y-2">
                            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Wallet className="w-4 h-4" />
                                Store Credit Accounts ({balances.store_credit_accounts.length})
                            </h4>
                            {balances.store_credit_accounts.map((acc, idx) => (
                                <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="text-xs text-slate-500">Account ID</p>
                                            <p className="text-xs font-mono text-slate-600">{acc.id.split('/').pop()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-slate-500">Balance</p>
                                            <p className="text-lg font-bold text-purple-600">
                                                {acc.balance_amount.toFixed(2)} {acc.balance_currency}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-6 bg-slate-50 rounded-lg">
                            <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">No store credit available for this customer</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ==========================================
// MAIN COMPONENT
// ==========================================
export const ReturnStatusPage = () => {
    const [activeTab, setActiveTab] = useState<'returns' | 'giftcards' | 'storecredit'>('returns');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchType, setSearchType] = useState<'order' | 'email' | 'phone'>('order');
    const [loading, setLoading] = useState(false);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [returnData, setReturnData] = useState<ReturnData | null>(null);
    const [multipleReturns, setMultipleReturns] = useState<ReturnData[]>([]);
    const [showSelection, setShowSelection] = useState(false);
    const [error, setError] = useState('');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchTerm.trim()) {
            setError('Please enter a search term');
            return;
        }

        setLoading(true);
        setError('');
        setSearchPerformed(true);
        setShowSelection(false);
        setMultipleReturns([]);
        setIsMobileMenuOpen(false);

        try {
            const returnsRef = collection(db, 'returns');
            let returns: ReturnData[] = [];

            switch (searchType) {
                case 'order': {
                    const cleanOrderId = searchTerm.trim().replace(/^#/, '');
                    const q = query(returnsRef, where('orderId', '==', cleanOrderId));
                    const querySnapshot = await getDocs(q);
                    querySnapshot.forEach((doc) => {
                        returns.push({ id: doc.id, ...doc.data() } as ReturnData);
                    });
                    break;
                }

                case 'email': {
                    const q = query(returnsRef, where('customer.email', '==', searchTerm.trim().toLowerCase()));
                    const querySnapshot = await getDocs(q);
                    querySnapshot.forEach((doc) => {
                        returns.push({ id: doc.id, ...doc.data() } as ReturnData);
                    });
                    break;
                }

                case 'phone': {
                    const cleanPhone = searchTerm.replace(/\D/g, '').slice(-10);
                    if (cleanPhone.length < 10) {
                        setError('Please enter a valid 10-digit phone number');
                        setLoading(false);
                        return;
                    }
                    const allReturnsSnapshot = await getDocs(returnsRef);
                    allReturnsSnapshot.forEach((doc) => {
                        const ret = { id: doc.id, ...doc.data() } as ReturnData;
                        const customerPhone = ret.customer?.phone?.replace(/\D/g, '') || '';
                        if (customerPhone.includes(cleanPhone) || cleanPhone.includes(customerPhone)) {
                            returns.push(ret);
                        }
                    });
                    break;
                }
            }

            if (returns.length === 0) {
                setError('No returns found matching your search.');
                setReturnData(null);
            } else if (returns.length === 1) {
                setReturnData(returns[0]);
            } else {
                setMultipleReturns(returns);
                setShowSelection(true);
                setReturnData(null);
            }
        } catch (err) {
            console.error('Error fetching returns:', err);
            setError('Failed to fetch return details. Please try again.');
            setReturnData(null);
        } finally {
            setLoading(false);
        }
    };

    const selectReturn = (selectedReturn: ReturnData) => {
        setReturnData(selectedReturn);
        setShowSelection(false);
    };

    const getStatusConfig = (status: string) => {
        return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.default;
    };

    const getContactMessage = (status: string) => {
        const baseMessage = 'For further details, contact customer support';
        const phoneNumber = '9962505459';

        switch (status) {
            case 'Open':
                return `${baseMessage} at ${phoneNumber}`;
            case 'Pickup Created':
                return `For any changes to pickup schedule, contact us at ${phoneNumber}`;
            case 'Item Delivered':
                return `For refund status updates, contact us at ${phoneNumber}`;
            case 'Closed':
                return `To submit a new return, contact us at ${phoneNumber}`;
            case 'Denied':
            case 'Rejected':
                return `For clarification, please contact us at ${phoneNumber}`;
            default:
                return `${baseMessage} at ${phoneNumber}`;
        }
    };

    const handleBack = () => {
        // If viewing a specific return AND there is a list of multiple returns to go back to
        if (returnData && multipleReturns.length > 0) {
            setReturnData(null);
            setShowSelection(true);
        } else {
            // Otherwise, reset everything and go back to the initial search screen
            setReturnData(null);
            setMultipleReturns([]);
            setShowSelection(false);
            setSearchPerformed(false);
            setSearchTerm('');
        }
    };

    const getTabColor = (tabName: 'returns' | 'giftcards' | 'storecredit') => {
        if (activeTab === tabName) {
            if (tabName === 'returns') return 'text-[#5A0A38] border-[#5A0A38]';
            if (tabName === 'giftcards') return 'text-green-600 border-green-600';
            if (tabName === 'storecredit') return 'text-purple-600 border-purple-600';
        }
        return 'text-slate-500 border-transparent';
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
            {/* Desktop Header */}
            <div className="hidden lg:block bg-[#5A0A38] border-b border-[#7D1B54] shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                    <div className="flex items-center justify-between">
                        <Link to="/ReturnStatusPage" className="flex items-center gap-3 group">
                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all">
                                <PackageOpen className="w-6 h-6 text-[#5A0A38]" />
                            </div>
                            <div>
                                <span className="font-bold text-xl text-white">Prashanti</span>
                                <span className="text-white/80 font-bold text-xl ml-1">Returns</span>
                            </div>
                        </Link>
                        <div className="flex items-center gap-4">
                            <Link
                                to="/CustomerPage"
                                className="flex items-center gap-2 text-white hover:text-white/90 transition-colors px-4 py-2 rounded-lg hover:bg-white/10"
                            >
                                <ShoppingBag className="w-4 h-4" />
                                Start a Return
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile Header */}
            <div className="lg:hidden bg-[#5A0A38] border-b border-[#7D1B54] sticky top-0 z-50">
                <div className="px-4 py-3 flex items-center justify-between">
                    <Link to="/ReturnStatusPage" className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                            <PackageOpen className="w-4 h-4 text-[#5A0A38]" />
                        </div>
                        <span className="font-bold text-sm text-white">
                            Prashanti<span className="text-white/80 ml-1">Returns</span>
                        </span>
                    </Link>
                    
                    <div className="flex items-center gap-2">
                        <Link
                            to="/CustomerPage"
                            className="text-white p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <ShoppingBag className="w-5 h-5" />
                        </Link>
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="text-white p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Menu Dropdown */}
            {isMobileMenuOpen && (
                <div className="lg:hidden fixed inset-x-0 top-[57px] bg-white border-b border-slate-200 shadow-lg z-40 animate-in slide-in-from-top">
                    <div className="p-4 space-y-2">
                        <Link
                            to="/CustomerPage"
                            className="flex items-center gap-3 p-3 text-[#5A0A38] hover:bg-[#5A0A38]/10 rounded-xl transition-colors"
                            onClick={() => setIsMobileMenuOpen(false)}
                        >
                            <ShoppingBag className="w-5 h-5" />
                            <span className="font-medium">Start a Return</span>
                        </Link>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
                {/* Back Button (Always visible when viewing details or selection) */}
                {(returnData || showSelection) && (
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-2 text-[#5A0A38] hover:text-[#7D1B54] mb-6 font-semibold text-sm transition-colors group bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm w-fit"
                    >
                        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                        Back to Search
                    </button>
                )}

                {/* Main Content Area */}
                {(!returnData || !searchPerformed) && !showSelection ? (
                    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                        {/* Tab Navigation */}
                        <div className="border-b border-slate-200">
                            <div className="flex">
                                <button
                                    onClick={() => setActiveTab('returns')}
                                    className={`flex-1 px-4 py-3 text-sm font-medium transition-all relative ${getTabColor('returns')}`}
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        <PackageOpen className="w-4 h-4" />
                                        <span className="hidden sm:inline">Return</span>
                                        <span className="sm:hidden">Returns</span>
                                        <span className="sm:inline hidden">Tracking</span>
                                    </div>
                                    {activeTab === 'returns' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#5A0A38]"></div>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('giftcards')}
                                    className={`flex-1 px-4 py-3 text-sm font-medium transition-all relative ${getTabColor('giftcards')}`}
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        <GiftIcon className="w-4 h-4" />
                                        <span className="hidden sm:inline">Gift</span>
                                        <span>Cards</span>
                                    </div>
                                    {activeTab === 'giftcards' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600"></div>
                                    )}
                                </button>
                                <button
                                    onClick={() => setActiveTab('storecredit')}
                                    className={`flex-1 px-4 py-3 text-sm font-medium transition-all relative ${getTabColor('storecredit')}`}
                                >
                                    <div className="flex items-center justify-center gap-2">
                                        <Wallet className="w-4 h-4" />
                                        <span className="hidden sm:inline">Store</span>
                                        <span>Credit</span>
                                    </div>
                                    {activeTab === 'storecredit' && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600"></div>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="p-4 sm:p-6">
                            {activeTab === 'returns' && (
                                <ReturnTrackingTab
                                    searchTerm={searchTerm}
                                    setSearchTerm={setSearchTerm}
                                    searchType={searchType}
                                    setSearchType={setSearchType}
                                    loading={loading}
                                    handleSearch={handleSearch}
                                    error={error}
                                />
                            )}
                            {activeTab === 'giftcards' && <GiftCardTab />}
                            {activeTab === 'storecredit' && <StoreCreditTab />}
                        </div>
                    </div>
                ) : showSelection && multipleReturns.length > 0 ? (
                    <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-xl p-4 sm:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4">
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-3 sm:mb-4">Select a Return to View</h2>
                        <div className="space-y-2 sm:space-y-3">
                            {multipleReturns.map((ret) => (
                                <button
                                    key={ret.id}
                                    onClick={() => selectReturn(ret)}
                                    className="w-full bg-slate-50 hover:bg-[#5A0A38]/5 border border-slate-200 rounded-lg sm:rounded-xl p-3 sm:p-4 flex items-center justify-between transition-all group"
                                >
                                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${
                                            STATUS_CONFIG[ret.status as keyof typeof STATUS_CONFIG]?.bg || 'bg-slate-100'
                                        }`}>
                                            {(() => {
                                                const Icon = STATUS_CONFIG[ret.status as keyof typeof STATUS_CONFIG]?.icon || PackageOpen;
                                                return <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${
                                                    STATUS_CONFIG[ret.status as keyof typeof STATUS_CONFIG]?.color || 'text-slate-600'
                                                }`} />;
                                            })()}
                                        </div>
                                        <div className="text-left min-w-0">
                                            <p className="text-xs sm:text-sm font-semibold text-slate-800 truncate">RAN: {ret.RAN}</p>
                                            <p className="text-[10px] sm:text-xs text-slate-500 truncate">Order: {ret.orderId}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                                        <StatusBadge status={ret.status} />
                                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 group-hover:text-[#5A0A38] transition-colors" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    returnData && (
                        <div className="space-y-4 sm:space-y-6 lg:space-y-8 animate-in fade-in slide-in-from-bottom-4">
                            {/* Status Header */}
                            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                                <div className={`bg-gradient-to-r ${getStatusConfig(returnData.status).gradient} px-4 sm:px-6 lg:px-8 py-4 sm:py-5 lg:py-6`}>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
                                        <div className="min-w-0">
                                            <p className="text-white/80 text-[10px] sm:text-xs font-medium mb-1">Return Authorization Number</p>
                                            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white font-mono break-words">{returnData.RAN}</h2>
                                        </div>
                                        <StatusBadge status={returnData.status} />
                                    </div>
                                </div>

                                {/* Tracking & Detailed Status Box */}
                                <div className="bg-slate-50 border-b border-slate-200">
                                    <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-sm">
                                        <div>
                                            <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><Package className="w-3 h-3"/> Return Status</p>
                                            <p className="font-semibold text-slate-800">{returnData.status || 'Open'}</p>
                                        </div>
                                        {(returnData.shipmentStatus || returnData.awb) && (
                                            <div>
                                                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><Truck className="w-3 h-3"/> Shipment</p>
                                                <p className="font-semibold text-slate-800">{returnData.shipmentStatus || 'Pending'}</p>
                                                {returnData.awb && <p className="text-xs text-slate-500 mt-1 font-mono bg-white px-2 py-1 rounded border border-slate-200 w-fit">AWB: {returnData.awb}</p>}
                                            </div>
                                        )}
                                        {returnData.refundStatus && (
                                            <div>
                                                <p className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><CreditCard className="w-3 h-3"/> Refund</p>
                                                <p className="font-semibold text-slate-800">{returnData.refundStatus}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Product Details Section */}
                                <div className="border-b border-slate-200 bg-white">
                                    <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-slate-50/50">
                                        <h3 className="font-semibold text-sm sm:text-base text-slate-800 flex justify-between items-center">
                                            <span className="flex items-center gap-1.5 sm:gap-2">
                                                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-[#5A0A38]" />
                                                Returned Items
                                            </span>
                                            <span className="text-xs sm:text-sm font-medium text-slate-500">{returnData.items?.length || 0} Item(s)</span>
                                        </h3>
                                    </div>
                                    <div className="p-4 sm:p-6 divide-y divide-slate-100">
                                        {returnData.items?.map((item, idx) => (
                                            <div key={idx} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row gap-4">
                                                <div className="w-20 h-24 sm:w-24 sm:h-28 bg-slate-100 rounded-lg border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                                                    {item.productImage ? (
                                                        <img src={item.productImage} alt={item.title} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <PackageOpen className="w-8 h-8 text-slate-300" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                    <div>
                                                        <h4 className="text-sm sm:text-base font-semibold text-slate-800 line-clamp-2 mb-1">{item.title}</h4>
                                                        <div className="flex flex-wrap gap-2 text-[10px] sm:text-xs mb-2">
                                                            <span className="text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">SKU: {item.sku || 'N/A'}</span>
                                                            <span className="text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded truncate max-w-[200px]" title={item.reason}>Reason: {item.reason}</span>
                                                        </div>
                                                        {item.note && (
                                                            <p className="text-[10px] sm:text-xs text-slate-500 italic bg-slate-50 p-2 rounded-md border border-slate-100">Note: {item.note}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex justify-between items-end mt-3 sm:mt-0">
                                                        <span className="text-xs sm:text-sm font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded">
                                                            Qty: {item.quantityReturned || item.quantityReturned || 1}
                                                        </span>
                                                        <span className="text-sm sm:text-base font-bold text-slate-900">
                                                            {item.price || 'N/A'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="bg-gradient-to-r from-[#5A0A38]/5 to-[#7D1B54]/5 px-4 sm:px-6 py-3 sm:py-4 border-t border-[#5A0A38]/10 flex justify-between items-center">
                                        <span className="text-xs sm:text-sm font-semibold text-[#5A0A38]">Estimated Total Value</span>
                                        <span className="text-lg sm:text-xl font-bold text-[#5A0A38]">
                                            ₹{calculateTotalAmount(returnData.items)}
                                        </span>
                                    </div>
                                </div>

                                <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
                                    {/* Order Info */}
                                    <div className="bg-slate-50 rounded-lg sm:rounded-xl p-3 sm:p-4 lg:p-5">
                                        <p className="text-[10px] sm:text-xs font-medium text-slate-500 mb-0.5 sm:mb-1">Requested Refund Method</p>
                                        <p className="text-sm sm:text-base lg:text-lg font-bold text-[#5A0A38] flex items-center gap-1.5 sm:gap-2">
                                            {returnData.requestedMethod === 'store_credit' && (
                                                <><Wallet className="w-4 h-4 sm:w-5 sm:h-5" /> Store Credit</>
                                            )}
                                            {returnData.requestedMethod === 'gift_card' && (
                                                <><Gift className="w-4 h-4 sm:w-5 sm:h-5" /> Gift Card</>
                                            )}
                                            {returnData.requestedMethod === 'refund' && (
                                                <><CreditCard className="w-4 h-4 sm:w-5 sm:h-5" /> Original Payment</>
                                            )}
                                        </p>
                                    </div>

                                    {/* Customer Information */}
                                    <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden">
                                        <div className="bg-gradient-to-r from-slate-50 to-white px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200">
                                            <h3 className="font-semibold text-sm sm:text-base text-slate-800 flex items-center gap-1.5 sm:gap-2">
                                                <User className="w-4 h-4 sm:w-5 sm:h-5 text-[#5A0A38]" />
                                                Customer Information
                                            </h3>
                                        </div>
                                        <div className="p-3 sm:p-4 lg:p-6">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 lg:gap-4">
                                                <InfoCard icon={User} label="Name" value={returnData.customer.name} color="indigo" />
                                                <InfoCard icon={Mail} label="Email" value={returnData.customer.email} color="blue" />
                                                <InfoCard icon={Phone} label="Phone" value={returnData.customer.phone} color="green" />
                                                {returnData.customer.address && (
                                                    <InfoCard
                                                        icon={MapPin}
                                                        label="Shipping Address"
                                                        value={`${returnData.customer.address}${returnData.customer.city ? `, ${returnData.customer.city}` : ''}${returnData.customer.state ? `, ${returnData.customer.state}` : ''} ${returnData.customer.zip || ''}`.trim()}
                                                        color="amber"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Contact Support */}
                                    <div className="bg-gradient-to-r from-[#5A0A38]/5 to-[#7D1B54]/5 rounded-xl sm:rounded-2xl border border-[#5A0A38]/10 p-4 sm:p-6">
                                        <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                                            <div className="p-2 sm:p-3 bg-white rounded-full shadow-sm shrink-0">
                                                <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-[#5A0A38]" />
                                            </div>
                                            <div className="flex-1 w-full">
                                                <h4 className="font-bold text-base sm:text-lg text-slate-800 mb-1 sm:mb-2">Need Assistance?</h4>
                                                <p className="text-sm sm:text-base text-[#5A0A38] mb-3 sm:mb-4">{getContactMessage(returnData.status)}</p>
                                                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                                                    <a
                                                        href={`tel:9962505459`}
                                                        className="w-full sm:w-auto bg-white hover:bg-[#5A0A38]/10 text-[#5A0A38] px-4 py-2.5 sm:py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm border border-[#5A0A38]/20"
                                                    >
                                                        <Phone className="w-4 h-4" />
                                                        Call 9962505459
                                                    </a>
                                                    <a
                                                        href={`mailto:support@prashanti.in`}
                                                        className="w-full sm:w-auto bg-white hover:bg-[#5A0A38]/10 text-[#5A0A38] px-4 py-2.5 sm:py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-sm border border-[#5A0A38]/20"
                                                    >
                                                        <Mail className="w-4 h-4" />
                                                        Email Support
                                                    </a>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                )}
            </div>
        </div>
    );
};