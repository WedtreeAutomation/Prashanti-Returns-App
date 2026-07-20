import React, { useState } from 'react';
import { Menu, ChevronDown, LogOut } from 'lucide-react';

interface HeaderProps {
  onMenuClick: () => void;
  title?: string;
  user: {
    email: string;
    role: "agent" | "manager";  // Match the MainLayout type
    name: string;
    profilePic?: string;
  };
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick, title = "Dashboard", user, onLogout }) => {
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  // Get initials from user name
  const getInitials = () => {
    return user.name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Format role for display
  const formatRole = (role: string) => {
    return role === 'manager' ? 'Manager' : 'Agent';
  };

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-slate-200 h-20">
      <div className="px-6 h-full flex items-center justify-between gap-4">
        
        {/* Left: Mobile Toggle & Page Title */}
        <div className="flex items-center gap-4">
          <button 
            onClick={onMenuClick} 
            className="p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-lg lg:hidden transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-slate-900 leading-tight">
              {title}
            </h2>
          </div>
        </div>

        {/* Right: User Profile Dropdown */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="relative">
            <button 
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex items-center gap-3 hover:bg-slate-50 p-1.5 pr-3 rounded-full transition-colors border border-transparent hover:border-slate-200"
            >
              {user.profilePic ? (
                <img 
                  src={user.profilePic} 
                  alt={user.name}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-pink-600 text-white flex items-center justify-center text-sm font-medium">
                  {getInitials()}
                </div>
              )}
              <div className="hidden md:block text-left">
                <p className="text-sm font-semibold text-slate-700 leading-none">
                  {user.name.split(' ')[0]}
                </p>
                <p className="text-xs text-slate-500 capitalize">{formatRole(user.role)}</p>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {userDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setUserDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-2 z-20">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
                    <span className={`
                      inline-block mt-2 px-2 py-0.5 text-xs font-medium rounded-full
                      ${user.role === 'manager' 
                        ? 'bg-purple-100 text-purple-700' 
                        : 'bg-pink-100 text-pink-700'
                      }
                    `}>
                      {formatRole(user.role)}
                    </span>
                  </div>

                  <button
                    onClick={onLogout}
                    className="flex items-center w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors mt-1"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};