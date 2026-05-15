import React, { useState, useEffect, useCallback } from 'react';
import { 
  Building2, 
  Package, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  Loader2, 
  MapPin, 
  XCircle,
  Calendar,
  Clock
} from 'lucide-react';
import { db } from '../../Interfaces/firebase';
import { 
  collection,
  doc, 
  getDocs,
  deleteDoc,
  setDoc,
  updateDoc,
  query,
  orderBy,
  getDoc
} from 'firebase/firestore';
import { Country, State } from 'country-state-city';
import { Warehouse, PackageTemplate } from '../../Interfaces/types'; 

type TabType = 'warehouses' | 'packages' | 'returns';

// ==========================================
// DEFAULT STATES
// ==========================================
const DEFAULT_WAREHOUSE: Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', code: '', externalId: '', address1: '', address2: '', address3: '',
  country: 'India', state: '', city: '', pincode: '', phone: '', isActive: true
};

const DEFAULT_PACKAGE: Omit<PackageTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', weight: 0.5, weightUnit: 'kg', length: 10, width: 10, height: 10, dimensionUnit: 'cm'
};

// Return Settings Interface
interface ReturnSettings {
  returnDaysLimit: number;
  updatedAt: number;
}

const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
  returnDaysLimit: 14,
  updatedAt: Date.now()
};


export const Settings = () => {
  // --- UI State ---
  const [activeTab, setActiveTab] = useState<TabType>('warehouses');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // --- Data State ---
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [packages, setPackages] = useState<PackageTemplate[]>([]);
  const [returnSettings, setReturnSettings] = useState<ReturnSettings>(DEFAULT_RETURN_SETTINGS);
  
  // --- Form State ---
  const [warehouseForm, setWarehouseForm] = useState<Omit<Warehouse, 'id' | 'createdAt' | 'updatedAt'>>(DEFAULT_WAREHOUSE);
  const [packageForm, setPackageForm] = useState<Omit<PackageTemplate, 'id' | 'createdAt' | 'updatedAt'>>(DEFAULT_PACKAGE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPackageModal, setShowPackageModal] = useState(false);

  // --- Return Settings Form State ---
  const [tempReturnDays, setTempReturnDays] = useState<number>(14);
  const [savingReturnSettings, setSavingReturnSettings] = useState(false);

  // ==========================================
  // FIREBASE COLLECTION REFERENCES (SIMPLE)
  // ==========================================
  const getWarehousesCollection = () => collection(db, 'warehouses');
  const getTemplatesCollection = () => collection(db, 'templates');

  // ==========================================
  // DATA FETCHING
  // ==========================================
  const fetchReturnSettings = useCallback(async () => {
    try {
      const settingsDoc = await getDoc(doc(db, 'settings', 'returnSettings'));
      if (settingsDoc.exists()) {
        const data = settingsDoc.data() as ReturnSettings;
        setReturnSettings(data);
        setTempReturnDays(data.returnDaysLimit);
      } else {
        // Create default settings if not exists
        await setDoc(doc(db, 'settings', 'returnSettings'), DEFAULT_RETURN_SETTINGS);
        setReturnSettings(DEFAULT_RETURN_SETTINGS);
        setTempReturnDays(DEFAULT_RETURN_SETTINGS.returnDaysLimit);
      }
    } catch (error) {
      console.error("Error fetching return settings:", error);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch warehouses
      const warehousesQuery = query(getWarehousesCollection(), orderBy('createdAt', 'desc'));
      const warehousesSnapshot = await getDocs(warehousesQuery);
      const warehousesList: Warehouse[] = [];
      warehousesSnapshot.forEach((doc) => {
        warehousesList.push({ id: doc.id, ...doc.data() } as Warehouse);
      });
      setWarehouses(warehousesList);

      // Fetch packages
      const packagesQuery = query(getTemplatesCollection(), orderBy('createdAt', 'desc'));
      const packagesSnapshot = await getDocs(packagesQuery);
      const packagesList: PackageTemplate[] = [];
      packagesSnapshot.forEach((doc) => {
        packagesList.push({ id: doc.id, ...doc.data() } as PackageTemplate);
      });
      setPackages(packagesList);

      // Fetch return settings
      await fetchReturnSettings();
      
    } catch (error) {
      console.error("Error fetching data:", error);
      alert("Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [fetchReturnSettings]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ==========================================
  // HELPER FUNCTIONS
  // ==========================================
  const generateDocumentId = (name: string): string => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  };

  // ==========================================
  // RETURN SETTINGS HANDLERS
  // ==========================================
  const handleSaveReturnSettings = async () => {
    if (tempReturnDays < 1 || tempReturnDays > 365) {
      alert("Return window must be between 1 and 365 days");
      return;
    }

    setSavingReturnSettings(true);
    try {
      const newSettings: ReturnSettings = {
        returnDaysLimit: tempReturnDays,
        updatedAt: Date.now()
      };
      
      await setDoc(doc(db, 'settings', 'returnSettings'), newSettings);
      setReturnSettings(newSettings);
      alert(`Return window updated to ${tempReturnDays} days successfully!`);
    } catch (error) {
      console.error("Error saving return settings:", error);
      alert("Failed to save return settings. Please try again.");
    } finally {
      setSavingReturnSettings(false);
    }
  };

  // ==========================================
  // COUNTRY / STATE LOGIC
  // ==========================================
  const allCountries = Country.getAllCountries();
  const selectedCountryObj = allCountries.find(c => c.name === warehouseForm.country);
  const statesForCountry = selectedCountryObj ? State.getStatesOfCountry(selectedCountryObj.isoCode) : [];

  // ==========================================
  // WAREHOUSE HANDLERS
  // ==========================================
  const handleWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const docId = generateDocumentId(warehouseForm.name);
      
      if (!docId) {
        alert("Please enter a valid warehouse name");
        setSaving(false);
        return;
      }

      const warehouseDocRef = doc(db, 'warehouses', docId);
      const timestamp = Date.now();
      const warehouseData = {
        ...warehouseForm,
        updatedAt: timestamp
      };
      
      if (editingId) {
        await updateDoc(warehouseDocRef, warehouseData);
      } else {
        await setDoc(warehouseDocRef, {
          ...warehouseData,
          createdAt: timestamp
        });
      }
      
      await fetchData();
      resetWarehouseForm();
      alert(`Warehouse ${editingId ? 'updated' : 'added'} successfully!`);
    } catch (error) {
      console.error("Error saving warehouse:", error);
      alert("Failed to save warehouse.");
    } finally {
      setSaving(false);
    }
  };

  const editWarehouse = (warehouse: Warehouse) => {
    setEditingId(warehouse.id);
    const { id, createdAt, updatedAt, ...formState } = warehouse;
    setWarehouseForm(formState);
  };

  const resetWarehouseForm = () => {
    setEditingId(null);
    setWarehouseForm(DEFAULT_WAREHOUSE);
  };

  const deleteWarehouse = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this warehouse?")) return;
    
    try {
      const warehouseDocRef = doc(db, 'warehouses', id);
      await deleteDoc(warehouseDocRef);
      
      setWarehouses(prev => prev.filter(w => w.id !== id));
      
      if (editingId === id) {
        resetWarehouseForm();
      }
      
      alert("Warehouse deleted successfully!");
    } catch (error) {
      console.error("Error deleting warehouse:", error);
      alert("Failed to delete warehouse.");
    }
  };

  // ==========================================
  // PACKAGE HANDLERS
  // ==========================================
  const handlePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const docId = generateDocumentId(packageForm.name);
      
      if (!docId) {
        alert("Please enter a valid template name");
        setSaving(false);
        return;
      }

      const packageDocRef = doc(db, 'templates', docId);
      const timestamp = Date.now();
      const packageData = {
        ...packageForm,
        updatedAt: timestamp
      };
      
      if (editingId) {
        await updateDoc(packageDocRef, packageData);
      } else {
        await setDoc(packageDocRef, {
          ...packageData,
          createdAt: timestamp
        });
      }
      
      await fetchData();
      setShowPackageModal(false);
      resetPackageForm();
      alert(`Package template ${editingId ? 'updated' : 'added'} successfully!`);
    } catch (error) {
      console.error("Error saving package template:", error);
      alert("Failed to save package template.");
    } finally {
      setSaving(false);
    }
  };

  const editPackage = (pkg: PackageTemplate) => {
    setEditingId(pkg.id);
    const { id, createdAt, updatedAt, ...formState } = pkg;
    setPackageForm(formState);
    setShowPackageModal(true);
  };

  const resetPackageForm = () => {
    setEditingId(null);
    setPackageForm(DEFAULT_PACKAGE);
  };

  const deletePackage = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this template?")) return;
    
    try {
      const packageDocRef = doc(db, 'templates', id);
      await deleteDoc(packageDocRef);
      
      setPackages(prev => prev.filter(p => p.id !== id));
      
      if (editingId === id) {
        setShowPackageModal(false);
        resetPackageForm();
      }
      
      alert("Package template deleted successfully!");
    } catch (error) {
      console.error("Error deleting package:", error);
      alert("Failed to delete package template.");
    }
  };

  // ==========================================
  // RENDER COMPONENTS
  // ==========================================
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 text-pink-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-slate-50 p-8 min-h-screen font-sans text-slate-900 overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-slate-500 mt-2">Manage your warehouses, package templates, and return policies.</p>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-200/50 p-1 rounded-xl w-max mb-8">
        <button
          onClick={() => setActiveTab('warehouses')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${
            activeTab === 'warehouses' 
              ? 'bg-white text-pink-600 shadow-sm' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4" /> Warehouses
        </button>
        <button
          onClick={() => setActiveTab('packages')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${
            activeTab === 'packages' 
              ? 'bg-white text-pink-600 shadow-sm' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4" /> Package Templates
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-sm transition-all ${
            activeTab === 'returns' 
              ? 'bg-white text-pink-600 shadow-sm' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4" /> Return Settings
        </button>
      </div>

      {/* ==========================================
          TAB: WAREHOUSES
          ========================================== */}
      {activeTab === 'warehouses' && (
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          
          {/* Left Column: Warehouse List */}
          <div className="w-full lg:w-1/3 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-slate-800">Warehouses</h2>
              <button 
                onClick={resetWarehouseForm}
                className="text-pink-600 hover:text-pink-700 bg-pink-50 hover:bg-pink-100 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add New
              </button>
            </div>
            
            {warehouses.length === 0 ? (
              <div className="bg-white border border-slate-200 border-dashed rounded-2xl p-8 text-center text-slate-500">
                No warehouses added yet.
              </div>
            ) : (
              warehouses.map(warehouse => (
                <div 
                  key={warehouse.id} 
                  onClick={() => editWarehouse(warehouse)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    editingId === warehouse.id 
                      ? 'bg-slate-900 border-slate-900 text-white shadow-lg' 
                      : 'bg-white border-slate-200 hover:border-pink-300 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`mt-1 p-2 rounded-lg ${editingId === warehouse.id ? 'bg-slate-800' : 'bg-pink-50 text-pink-600'}`}>
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className={`font-bold ${editingId === warehouse.id ? 'text-white' : 'text-slate-800'}`}>
                          {warehouse.name}
                        </h3>
                        <p className={`text-xs mt-1 leading-relaxed ${editingId === warehouse.id ? 'text-slate-300' : 'text-slate-500'}`}>
                          {warehouse.address1}, {warehouse.city}<br/>{warehouse.state}, {warehouse.country} - {warehouse.pincode}
                        </p>
                        <p className={`text-xs mt-1 ${editingId === warehouse.id ? 'text-slate-400' : 'text-slate-400'}`}>
                          {warehouse.phone}
                        </p>
                      </div>
                    </div>
                    {!warehouse.isActive && (
                      <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right Column: Warehouse Form */}
          <div className="w-full lg:w-2/3 bg-white border border-slate-200 rounded-2xl p-6 lg:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">
                {editingId ? 'Edit Warehouse' : 'Add New Warehouse'}
              </h2>
              {editingId && (
                <button 
                  type="button"
                  onClick={() => deleteWarehouse(editingId)} 
                  className="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-lg transition-colors"
                  title="Delete warehouse"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>

            <form onSubmit={handleWarehouseSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">
                    Warehouse Name <span className="text-red-500">*</span>
                  </label>
                  <input 
                    required 
                    type="text" 
                    value={warehouseForm.name} 
                    onChange={e => setWarehouseForm({...warehouseForm, name: e.target.value})} 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                    placeholder="e.g. Prashanti Sarees" 
                    disabled={!!editingId}
                  />
                  {editingId && (
                    <p className="text-xs text-amber-600 mt-1">⚠️ Warehouse name cannot be changed</p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Code (Optional)</label>
                  <input 
                    type="text" 
                    value={warehouseForm.code} 
                    onChange={e => setWarehouseForm({...warehouseForm, code: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                    placeholder="e.g. WH-001" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">External ID (Optional)</label>
                  <input 
                    type="text" 
                    value={warehouseForm.externalId} 
                    onChange={e => setWarehouseForm({...warehouseForm, externalId: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                    placeholder="Third party ID" 
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Address Line 1 <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="text" 
                    value={warehouseForm.address1} 
                    onChange={e => setWarehouseForm({...warehouseForm, address1: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Address Line 2</label>
                  <input 
                    type="text" 
                    value={warehouseForm.address2} 
                    onChange={e => setWarehouseForm({...warehouseForm, address2: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Address Line 3</label>
                  <input 
                    type="text" 
                    value={warehouseForm.address3} 
                    onChange={e => setWarehouseForm({...warehouseForm, address3: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Country <span className="text-red-500">*</span></label>
                  <select 
                    required 
                    value={warehouseForm.country} 
                    onChange={e => setWarehouseForm({...warehouseForm, country: e.target.value, state: ''})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                  >
                    <option value="">Select country</option>
                    {allCountries.map(country => (
                      <option key={country.isoCode} value={country.name}>{country.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">State <span className="text-red-500">*</span></label>
                  <select 
                    required 
                    value={warehouseForm.state} 
                    onChange={e => setWarehouseForm({...warehouseForm, state: e.target.value})} 
                    disabled={!warehouseForm.country || statesForCountry.length === 0}
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Select state</option>
                    {statesForCountry.map(state => (
                      <option key={state.isoCode} value={state.name}>{state.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">City <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="text" 
                    value={warehouseForm.city} 
                    onChange={e => setWarehouseForm({...warehouseForm, city: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Pincode <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="text" 
                    value={warehouseForm.pincode} 
                    onChange={e => setWarehouseForm({...warehouseForm, pincode: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Phone <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="tel" 
                    value={warehouseForm.phone} 
                    onChange={e => setWarehouseForm({...warehouseForm, phone: e.target.value})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                    placeholder="+91 9962505459"
                  />
                </div>

                <div className="flex items-center">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={warehouseForm.isActive} 
                      onChange={e => setWarehouseForm({...warehouseForm, isActive: e.target.checked})}
                      className="w-5 h-5 text-pink-600 rounded border-slate-300 focus:ring-pink-500"
                    />
                    <span className="font-bold text-slate-700">Active Warehouse</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={resetWarehouseForm} 
                  className="px-6 py-3 border-2 border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-6 rounded-xl transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {editingId ? 'Update Warehouse' : 'Save Warehouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================
          TAB: PACKAGE TEMPLATES
          ========================================== */}
      {activeTab === 'packages' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Package Templates</h2>
              <p className="text-sm text-slate-500 mt-1">Pre-defined package sizes for faster returns processing.</p>
            </div>
            <button 
              onClick={() => { resetPackageForm(); setShowPackageModal(true); }}
              className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" /> New Template
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Template Name</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Weight</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Dimensions (L×W×H)</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      No package templates configured yet.
                    </td>
                  </tr>
                ) : (
                  packages.map(pkg => (
                    <tr key={pkg.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-bold text-slate-800">
                        <div className="flex items-center gap-3">
                          <Package className="w-5 h-5 text-slate-400" />
                          {pkg.name}
                        </div>
                      </td>
                      <td className="p-4 text-center text-slate-600 font-medium">
                        {pkg.weight} {pkg.weightUnit}
                      </td>
                      <td className="p-4 text-center text-slate-600 font-medium">
                        {pkg.length} × {pkg.width} × {pkg.height} {pkg.dimensionUnit}
                      </td>
                      <td className="p-4 flex justify-end gap-2">
                        <button 
                          onClick={() => editPackage(pkg)} 
                          className="p-2 text-slate-400 hover:text-pink-600 bg-white hover:bg-pink-50 rounded-lg border border-transparent hover:border-pink-100 transition-all"
                          title="Edit template"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deletePackage(pkg.id)} 
                          className="p-2 text-slate-400 hover:text-red-600 bg-white hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all"
                          title="Delete template"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==========================================
          TAB: RETURN SETTINGS
          ========================================== */}
      {activeTab === 'returns' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-pink-50 to-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pink-100 rounded-xl">
                  <Calendar className="w-6 h-6 text-pink-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Return Policy Settings</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Configure the return window and policy limits</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Current Settings Display */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-800">Current Return Window</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">
                      {returnSettings.returnDaysLimit} days
                    </p>
                    <p className="text-xs text-blue-600 mt-2">
                      Last updated: {new Date(returnSettings.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Edit Settings Form */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-bold text-slate-700 block mb-2">
                    Return Window (Days)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={tempReturnDays}
                      onChange={(e) => setTempReturnDays(parseInt(e.target.value) || 14)}
                      className="w-32 p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 text-center font-bold text-lg"
                    />
                    <span className="text-slate-600">days from order creation date</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Customers can only return items within this many days from when the order was created.
                  </p>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => setTempReturnDays(returnSettings.returnDaysLimit)}
                    className="px-6 py-2.5 border-2 border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveReturnSettings}
                    disabled={savingReturnSettings || tempReturnDays === returnSettings.returnDaysLimit}
                    className="flex-1 bg-pink-600 hover:bg-pink-700 text-white font-bold py-2.5 px-6 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingReturnSettings ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Save className="w-5 h-5" />
                    )}
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Package Form Modal */}
      {showPackageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-bold text-slate-800">
                {editingId ? 'Edit Package Template' : 'New Package Template'}
              </h2>
              <button 
                onClick={() => {
                  setShowPackageModal(false);
                  resetPackageForm();
                }} 
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handlePackageSubmit} className="p-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Template Name <span className="text-red-500">*</span>
                </label>
                <input 
                  required 
                  type="text" 
                  value={packageForm.name} 
                  onChange={e => setPackageForm({...packageForm, name: e.target.value})} 
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  placeholder="e.g. Standard Box"
                  disabled={!!editingId}
                />
                {editingId && (
                  <p className="text-xs text-amber-600 mt-1">⚠️ Template name cannot be changed</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Weight <span className="text-red-500">*</span></label>
                  <input 
                    required 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={packageForm.weight} 
                    onChange={e => setPackageForm({...packageForm, weight: parseFloat(e.target.value)})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Unit</label>
                  <select 
                    value={packageForm.weightUnit} 
                    onChange={e => setPackageForm({...packageForm, weightUnit: e.target.value as 'kg'|'g'})} 
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                  >
                    <option value="kg">Kilograms (kg)</option>
                    <option value="g">Grams (g)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Dimensions <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <input 
                      required 
                      type="number" 
                      step="0.1" 
                      min="0"
                      value={packageForm.length} 
                      onChange={e => setPackageForm({...packageForm, length: parseFloat(e.target.value)})} 
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                      placeholder="Length"
                    />
                  </div>
                  <div>
                    <input 
                      required 
                      type="number" 
                      step="0.1" 
                      min="0"
                      value={packageForm.width} 
                      onChange={e => setPackageForm({...packageForm, width: parseFloat(e.target.value)})} 
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                      placeholder="Width"
                    />
                  </div>
                  <div>
                    <input 
                      required 
                      type="number" 
                      step="0.1" 
                      min="0"
                      value={packageForm.height} 
                      onChange={e => setPackageForm({...packageForm, height: parseFloat(e.target.value)})} 
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" 
                      placeholder="Height"
                    />
                  </div>
                </div>
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Dimension Unit</label>
                <select 
                  value={packageForm.dimensionUnit} 
                  onChange={e => setPackageForm({...packageForm, dimensionUnit: e.target.value as 'cm'|'in'})} 
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
                >
                  <option value="cm">Centimeters (cm)</option>
                  <option value="in">Inches (in)</option>
                </select>
              </div>

              <div className="pt-4 mt-2 border-t border-slate-100 flex gap-3">
                {editingId && (
                  <button 
                    type="button"
                    onClick={() => deletePackage(editingId)} 
                    className="px-4 py-3 text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 font-bold rounded-xl transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-5 h-5" /> Delete
                  </button>
                )}
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {editingId ? 'Update Template' : 'Create Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};