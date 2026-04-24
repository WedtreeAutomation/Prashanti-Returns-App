import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { MainLayout } from './components/Layout/MainLayout';
import { Home } from './components/Pages/Home';
import { Returns } from './components/Pages/Returns';
import { Analytics } from './components/Pages/Analytics';
import { ReturnPortalSplit } from './components/Pages/CustomerPage';
import LoginPage from './components/Pages/LoginPage';
import Agents from './components/Pages/Agents';
import { Settings } from './components/Pages/Settings';
import { ReturnStatusPage } from './components/Pages/ReturnStatusPage';
import './index.css';
import { User, saveUserToStorage, getUserFromStorage, clearUserFromStorage } from './Interfaces/types';
import { ReturnDetailsPage } from './components/Pages/ReturnDetailsPage';
import { RestockHistory } from './components/Pages/RestockHistory';

function App() {
  const [user, setUser] = useState<User | null>(() => {
    return getUserFromStorage();
  });

  useEffect(() => {
    if (user) {
      saveUserToStorage(user);
    } else {
      clearUserFromStorage();
    }
  }, [user]);

  const handleLogin = (userData: User) => {
    setUser(userData);
    saveUserToStorage(userData);
  };

  const handleLogout = () => {
    setUser(null);
    clearUserFromStorage();
  };

  // Protected route wrapper
  const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    if (!user) {
      // Redirect unauthenticated users to the main CustomerPage
      return <Navigate to="/CustomerPage" replace />;
    }
    return <MainLayout user={user} onLogout={handleLogout}>{children}</MainLayout>;
  };

  return (
    <BrowserRouter>
      <Routes>
        
        {/* Root domain now serves CustomerPage for the public. */}
        <Route path="/" element={
          user ? (
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          ) : (
            <Navigate to="/CustomerPage" replace />
          )
        } />

        {/* Public Routes - No authentication required */}
        <Route path="/ReturnStatusPage" element={<ReturnStatusPage />} />
        <Route path="/CustomerPage" element={<ReturnPortalSplit />} />

        {/* Auth Routes - Admins will now navigate here directly */}
        <Route path="/login" element={
          user ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />
        } />

        {/* Protected Admin routes - Require authentication */}
        <Route path="/returns" element={
          <ProtectedRoute>
            <Returns />
          </ProtectedRoute>
        } />

        <Route path="/returns/:id" element={
          <ProtectedRoute>
            <ReturnDetailsPage />
          </ProtectedRoute>
        } />

        <Route path="/restock-history" element={
          <ProtectedRoute>
            <RestockHistory />
          </ProtectedRoute>
        } />

        <Route path="/analytics" element={
          <ProtectedRoute>
            <Analytics />
          </ProtectedRoute>
        } />

        <Route path="/agents" element={
          <ProtectedRoute>
            <Agents />
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />

        {/* Redirect to the main CustomerPage if no route matches */}
        <Route path="*" element={<Navigate to="/CustomerPage" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;