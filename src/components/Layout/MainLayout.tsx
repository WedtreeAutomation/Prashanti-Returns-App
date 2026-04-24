import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface MainLayoutProps {
  user: {
    email: string;
    role: "agent" | "manager";  // This allows both agent and manager
    name: string;
    profilePic?: string;
  };
  onLogout: () => void;
  children?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ user, onLogout, children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Determine Page Title based on URL
  const getTitle = () => {
    switch(location.pathname) {
      case '/':
      case '/home':
        return 'Dashboard';
      case '/returns':
        return 'Returns Management';
      case '/analytics':
        return 'Analytics';
      case '/agents':
        return 'Team Management';
      default:
        // For dynamic routes like /returns/123
        if (location.pathname.startsWith('/returns/')) {
          return 'Return Details';
        }
        return 'Dashboard';
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        user={user}
        onLogout={onLogout}
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        <Header 
          onMenuClick={() => setSidebarOpen(true)} 
          title={getTitle()}
          user={user}
          onLogout={onLogout}
        />
        
        {/* "Outlet" is where the Pages (Home, Returns, Analytics) will appear */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
};