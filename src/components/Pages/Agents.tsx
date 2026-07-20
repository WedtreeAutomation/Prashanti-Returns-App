import { useEffect, useState, useRef } from "react";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  query,
  where
} from "firebase/firestore";
import { 
  Plus, 
  Edit2, 
  Trash2, 
  X, 
  Loader2, 
  User as User_Icon, 
  Check, 
  AlertCircle, 
  Users, 
  Star, 
  Store, 
  Globe,
  Mail,
  Phone
} from "lucide-react"; 
import { db } from "../../Interfaces/firebase";
import { toast } from "react-toastify";

interface Agent {
  id?: string;
  name: string;
  email: string;
  phone: string;
  profilePic: string;
  agentType: "store" | "online";
  role?: "agent"; // Added optional role field for type safety
  createdAt?: any;
  updatedAt?: any;
}

const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Agent | null>(null);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<Omit<Agent, 'id' | 'createdAt' | 'updatedAt' | 'role'>>({
    name: "",
    email: "",
    phone: "",
    profilePic: "",
    agentType: "online", 
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAgents = async () => {
    setLoading(true);
    try {
      const agentsCol = collection(db, "agents");
      const snapshot = await getDocs(agentsCol);
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        agentType: docSnap.data().agentType || "online", 
        ...docSnap.data(),
      })) as Agent[];
      setAgents(data);
    } catch (error) {
      console.error("Error fetching agents:", error);
      toast.error("Failed to load agents");
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!form.name.trim()) errors.name = "Name is required";
    if (!form.email.trim()) {
      errors.email = "Email is required";
    } else if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      errors.email = "Invalid email format";
    }
    if (!form.phone.trim()) errors.phone = "Phone is required";

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const checkIfAgentExists = async (name: string, excludeId?: string): Promise<boolean> => {
    try {
      const agentsCol = collection(db, "agents");
      const q = query(agentsCol, where("name", "==", name));
      const snapshot = await getDocs(q);
      
      if (excludeId) {
        return snapshot.docs.some(doc => doc.id !== excludeId);
      }
      return !snapshot.empty;
    } catch (error) {
      console.error("Error checking agent:", error);
      return false;
    }
  };

  const saveAgent = async () => {
    if (!validateForm()) return;

    if (!editingAgent || form.name !== editingAgent.name) {
      const exists = await checkIfAgentExists(form.name, editingAgent?.id);
      if (exists) {
        toast.error(`Agent with name "${form.name}" already exists`);
        return;
      }
    }

    setSaving(true);
    try {
      const agentData = {
        ...form,
        role: "agent", // FIX: Explicitly adding role for consistency
        updatedAt: serverTimestamp(),
        ...(!editingAgent && { 
          createdAt: serverTimestamp(),
        })
      };

      const docRef = doc(db, "agents", form.name);

      if (editingAgent && editingAgent.id !== form.name) {
        const oldDocRef = doc(db, "agents", editingAgent.id!);
        await deleteDoc(oldDocRef);
        await setDoc(docRef, agentData);
      } else {
        await setDoc(docRef, agentData);
      }

      toast.success(`Agent ${editingAgent ? "updated" : "added"} successfully`);
      setModalOpen(false);
      fetchAgents();
    } catch (error) {
      console.error("Error saving agent:", error);
      toast.error(`Failed to ${editingAgent ? "update" : "add"} agent`);
    } finally {
      setSaving(false);
    }
  };

  // ... (rest of the file remains largely the same, functions removeAgent, handleImageUpload, etc.)
  // Included full file below for copy-paste convenience

  const removeAgent = async (name: string) => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "agents", name));
      toast.success("Agent deleted successfully");
      fetchAgents();
    } catch (error) {
      console.error("Error deleting agent:", error);
      toast.error("Failed to delete agent");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image size must be less than 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setForm({ ...form, profilePic: reader.result as string });
    };
    reader.onerror = () => {
      toast.error("Error reading image file");
    };
    reader.readAsDataURL(file);
  };

  const openAddModal = () => {
    setEditingAgent(null);
    setForm({
      name: "",
      email: "",
      phone: "",
      profilePic: "",
      agentType: "online", 
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setForm({
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      profilePic: agent.profilePic,
      agentType: agent.agentType || "online", 
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  return (
    <div className="min-h-screen p-6 bg-slate-50">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600 shadow-sm border border-pink-100">
                <Users className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  Agents Management
                </h1>
                <p className="text-sm text-slate-500 font-medium">Manage your Returns team and permissions</p>
              </div>
            </div>
            <button
              onClick={openAddModal}
              disabled={loading}
              className="flex items-center px-6 py-2.5 bg-pink-600 text-white rounded-xl hover:bg-pink-700 transition-all duration-200 shadow-sm font-semibold text-sm disabled:opacity-70"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Agent
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Agents</p>
              <p className="text-3xl font-bold text-slate-900">{agents.length}</p>
            </div>
            <div className="h-12 w-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
              <Users className="h-6 w-6" />
            </div>
          </div>
          
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Active Now</p>
              <p className="text-3xl font-bold text-slate-900">{agents.length}</p>
            </div>
            <div className="h-12 w-12 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600">
              <Star className="h-6 w-6" />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="text-center">
                <Loader2 className="h-10 w-10 text-pink-600 animate-spin mx-auto mb-3" />
                <p className="text-slate-500 font-medium text-sm">Loading team...</p>
              </div>
            </div>
          ) : agents.length === 0 ? (
            <div className="text-center py-20 bg-slate-50/50">
              <div className="h-20 w-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200 shadow-sm">
                <Users className="h-10 w-10 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">No agents found</h3>
              <p className="text-slate-500 mb-6 text-sm">Add your first agent to get started.</p>
              <button
                onClick={openAddModal}
                className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all text-sm shadow-sm"
              >
                + Add Agent
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Profile</th>
                    <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Contact Info</th>
                    <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
                    <th className="text-left py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {agents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full overflow-hidden border border-slate-200 shadow-sm">
                            {agent.profilePic ? (
                              <img src={agent.profilePic} alt={agent.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs">
                                {getInitials(agent.name)}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-sm">{agent.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                             <Mail className="w-3.5 h-3.5 text-slate-400" />
                             {agent.email}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                             <Phone className="w-3.5 h-3.5 text-slate-400" />
                             {agent.phone}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                          agent.agentType === 'store'
                            ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                        }`}>
                          {agent.agentType === 'store' ? <Store className="h-3 w-3 mr-1.5" /> : <Globe className="h-3 w-3 mr-1.5" />}
                          {agent.agentType === 'store' ? 'Store Agent' : 'Online Agent'}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(agent)}
                            className="p-2 text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-all"
                            title="Edit Details"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(agent)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Delete Agent"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {editingAgent ? "Edit Agent" : "Add New Agent"}
                </h3>
                <p className="text-sm text-slate-500">Enter agent details below</p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex flex-col items-center gap-3">
                <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-slate-100 shadow-sm relative group">
                  {form.profilePic ? (
                    <img src={form.profilePic} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-slate-50 flex items-center justify-center text-slate-400">
                      <User_Icon className="h-8 w-8" />
                    </div>
                  )}
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <Edit2 className="text-white w-6 h-6" />
                  </div>
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-semibold text-pink-600 hover:text-pink-700"
                >
                  {form.profilePic ? "Change Photo" : "Upload Photo"}
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Full Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={`w-full bg-slate-50 border ${formErrors.name ? 'border-red-300' : 'border-slate-200'} rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-pink-100 focus:border-pink-500 outline-none transition-all font-medium`}
                    placeholder="e.g. Sarah Smith"
                  />
                  {formErrors.name && <p className="text-red-500 text-xs mt-1 ml-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {formErrors.name}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={`w-full bg-slate-50 border ${formErrors.email ? 'border-red-300' : 'border-slate-200'} rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-pink-100 focus:border-pink-500 outline-none transition-all font-medium`}
                    placeholder="agent@company.com"
                  />
                  {formErrors.email && <p className="text-red-500 text-xs mt-1 ml-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {formErrors.email}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className={`w-full bg-slate-50 border ${formErrors.phone ? 'border-red-300' : 'border-slate-200'} rounded-xl px-4 py-2.5 text-slate-900 focus:ring-2 focus:ring-pink-100 focus:border-pink-500 outline-none transition-all font-medium`}
                    placeholder="+91 98765 43210"
                  />
                  {formErrors.phone && <p className="text-red-500 text-xs mt-1 ml-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> {formErrors.phone}</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2 ml-1">Agent Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`cursor-pointer border rounded-xl p-3 flex items-center justify-center gap-2 transition-all ${form.agentType === 'online' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      <input type="radio" name="type" className="hidden" checked={form.agentType === 'online'} onChange={() => setForm({...form, agentType: 'online'})} />
                      <Globe className="w-4 h-4" />
                      <span className="font-semibold text-sm">Online</span>
                    </label>
                    <label className={`cursor-pointer border rounded-xl p-3 flex items-center justify-center gap-2 transition-all ${form.agentType === 'store' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      <input type="radio" name="type" className="hidden" checked={form.agentType === 'store'} onChange={() => setForm({...form, agentType: 'store'})} />
                      <Store className="w-4 h-4" />
                      <span className="font-semibold text-sm">Store</span>
                    </label>
                  </div>
                </div>
              </div>

              <button
                onClick={saveAgent}
                disabled={saving}
                className="w-full bg-pink-600 hover:bg-pink-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-pink-200 transition-all active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                {editingAgent ? "Update Agent" : "Create Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl border border-slate-200">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
              <Trash2 className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 text-center mb-2">Delete Agent?</h3>
            <p className="text-slate-500 text-center mb-6 text-sm">
              Are you sure you want to delete <span className="font-bold text-slate-700">{deleteConfirm.name}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteConfirm.id && removeAgent(deleteConfirm.id)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 transition-colors shadow-sm flex items-center justify-center"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}