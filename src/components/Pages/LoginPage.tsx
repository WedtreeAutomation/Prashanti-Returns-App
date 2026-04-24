import React, { useState } from "react";
import { User, Phone } from "lucide-react"; 
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../Interfaces/firebase";

interface LoginPageProps {
  onLogin: (user: {
    email: string;
    role: "agent"; 
    name: string;
    profilePic?: string;
  }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const agentsRef = collection(db, "agents");
      
      const q = query(
        agentsRef,
        where("email", "==", email.trim()),
        where("phone", "==", password.trim())
      );
      
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const agentData = snapshot.docs[0].data();

        onLogin({
          email: agentData.email,
          role: "agent", 
          name: agentData.name,
          profilePic: agentData.profilePic || "", 
        });
      } else {
        setError("Invalid email or phone number. Please check your credentials.");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Unable to connect to server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row bg-cover bg-center relative overflow-hidden"
      style={{ backgroundImage: "url('/background.png')" }} 
    >
      {/* Left Section - Branding Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-purple-900/30 to-pink-900/40"></div>
      
      {/* Left Content */}
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex flex-col justify-center px-8 lg:px-12 py-12 lg:py-0 text-left">
        <h1 className="text-5xl lg:text-7xl font-black text-white mb-4 lg:mb-6 drop-shadow-2xl tracking-wider">
          Prashanti Sarees
        </h1>
        <p className="text-xl lg:text-3xl text-white/90 drop-shadow-lg font-light tracking-wide mb-6">
          TRADITION FOR GENERATIONS
        </p>
        <div className="w-24 lg:w-32 h-1 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full mb-6"></div>
        <p className="text-lg lg:text-xl text-white/80 drop-shadow font-light leading-relaxed">
          Experience excellence through heritage.<br />
          Where tradition meets innovation.
        </p>
      </div>

      {/* Right Section - Login Form */}
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex items-center justify-center px-6 sm:px-8 py-8 lg:py-0">
        <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl px-8 py-10 border border-white/20 w-full max-w-md animate-in fade-in slide-in-from-right-8 duration-700">
          
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">
              Agent Login
            </h2>
            <p className="text-gray-500 text-sm">
              Sign in to access your Returns Admin dashboard
            </p>
            <div className="w-12 h-1 bg-gradient-to-r from-purple-600 to-pink-600 mx-auto rounded-full mt-4"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6"> {/* Changed from space-y-5 to space-y-6 */}
            <div className="space-y-3"> {/* Changed from space-y-1 to space-y-3 */}
              <label className="block text-xs font-bold text-gray-500 uppercase ml-3">
                Email Address
              </label>
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-6 py-3.5 border border-gray-200 rounded-full focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-400 font-medium outline-none bg-gray-50/50 focus:bg-white"
                  placeholder="Enter your email"
                  required
                />
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
              </div>
            </div>

            <div className="space-y-3"> {/* Changed from space-y-1 to space-y-3 */}
              <label className="block text-xs font-bold text-gray-500 uppercase ml-3">
                Password
              </label>
              <div className="relative group">
                <input
                  type="tel"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-6 py-3.5 border border-gray-200 rounded-full focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-400 font-medium outline-none bg-gray-50/50 focus:bg-white"
                  placeholder="Enter your password"
                  required
                />
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-2xl animate-in fade-in slide-in-from-top-2">
                <p className="text-red-600 text-sm font-semibold text-center flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-600 rounded-full"></span>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-4 px-6 rounded-full font-bold text-base hover:from-purple-700 hover:to-pink-700 focus:ring-4 focus:ring-purple-200 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-purple-200 relative overflow-hidden group mt-2 active:scale-[0.98]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Verifying...
                  </>
                ) : (
                  "Sign In to Dashboard"
                )}
              </span>
              {/* Shine Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out"></div>
            </button>
          </form>

          <div className="mt-4 pt-4 text-center border-t border-gray-100"> {/* Reduced margin and padding */}
            <p className="text-xs text-gray-400 font-medium tracking-wide">
              © 2026 Prashanti Sarees. Authorized Personnel Only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}