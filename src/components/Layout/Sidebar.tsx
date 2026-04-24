import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, RotateCcw, TrendingUp, Package, Settings, Users, ArchiveRestore } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    email: string;
    role: "agent";
    name: string;
    profilePic?: string;
  };
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const baseClasses = "fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0";
  const mobileClasses = isOpen ? "translate-x-0" : "-translate-x-full";

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/20 z-20 lg:hidden backdrop-blur-sm" 
          onClick={onClose} 
        />
      )}

      {/* Main Sidebar Container */}
      <aside className={`${baseClasses} ${mobileClasses} flex flex-col h-full bg-white border-r border-slate-200 shadow-sm`}>
        
        {/* Company Logo Area */}
        <div className="h-20 flex items-center px-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pink-50 rounded-xl flex items-center justify-center text-pink-600">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Prashanti<span className="text-pink-600">Sarees</span>
              </h1>
              <p className="text-xs text-slate-500 font-medium">Returns Admin Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          <p className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-2">Menu</p>
          <NavItem to="/" icon={Home} label="Dashboard" onClick={onClose} />
          <NavItem to="/returns" icon={RotateCcw} label="Returns" onClick={onClose} />
          <NavItem to="/restock-history" icon={ArchiveRestore} label="Restock History" onClick={onClose} />
          <NavItem to="/analytics" icon={TrendingUp} label="Analytics" onClick={onClose} />
          
          <p className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6">System</p>
          
          {/* Agents Tab - Added unconditionally */}
          <NavItem to="/agents" icon={Users} label="Agents" onClick={onClose} />

          
          <NavItem to="/settings" icon={Settings} label="Settings" onClick={onClose} />
        </nav>
      </aside>
    </>
  );
};

// Professional NavItem Component
const NavItem = ({ 
  to, 
  icon: Icon, 
  label, 
  badge, 
  onClick 
}: { 
  to: string; 
  icon: React.ElementType; 
  label: string; 
  badge?: string;
  onClick: () => void;
}) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) => `
      flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 group
      ${isActive 
        ? 'bg-pink-50 text-pink-700 font-semibold' 
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}
    `}
  >
    <Icon className="w-5 h-5 transition-colors group-hover:text-pink-600" />
    <span className="flex-1">{label}</span>
    {badge && (
      <span className="bg-pink-100 text-pink-700 text-xs font-bold px-2 py-0.5 rounded-full">
        {badge}
      </span>
    )}
  </NavLink>
);