import React, { useState } from "react";
import { 
  User, 
  X, 
  Mail, 
  Lock, 
  ShieldCheck, 
  Eye, 
  EyeOff,
  AlertCircle
} from "lucide-react";
import { loginAgent, setupAgentPassword, sendAgentOtp, verifyAgentOtp } from "../../Interfaces/api";

interface LoginPageProps {
  onLogin: (user: {
    email: string;
    role: "agent";
    name: string;
    profilePic?: string;
  }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  // Login State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Modals State
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  // Set Password State
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Forgot Password / OTP State
  const [forgotEmail, setForgotEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await loginAgent(email, password);

      if (data.needsSetup) {
        setShowSetPassword(true);
      } else if (data.success && data.agent) {
        onLogin(data.agent);
      }
    } catch (err: any) {
      // Better error messaging
      const errorMsg = err.response?.data?.error;
      if (errorMsg?.toLowerCase().includes("password") || errorMsg?.toLowerCase().includes("credential")) {
        setError("Invalid email or password. Please try again.");
      } else if (errorMsg?.toLowerCase().includes("phone")) {
        setError("Invalid phone number. Please check and try again.");
      } else {
        setError(errorMsg || "Unable to connect to server. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const validatePasswordRules = (pwd: string) => {
    const minLength = pwd.length >= 8;
    const hasUpper = /[A-Z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
    return minLength && hasUpper && hasNumber && hasSpecial;
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    if (!validatePasswordRules(newPassword)) {
      setPasswordError("Password must be at least 8 chars, include an uppercase letter, a number, and a special character.");
      return;
    }

    setLoading(true);
    try {
      const targetEmail = forgotEmail || email;
      const data = await setupAgentPassword(targetEmail, newPassword);

      if (data.success && data.agent) {
        setShowSetPassword(false);
        onLogin(data.agent);
      }
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError("");
    setLoading(true);

    try {
      await sendAgentOtp(forgotEmail);
      setOtpSent(true);
      // Start cooldown timer
      setResendCooldown(30);
      const timer = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setOtpError(err.response?.data?.error || "Agent Not Found");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError("");
    setLoading(true);

    try {
      await verifyAgentOtp(forgotEmail, enteredOtp);
      setShowForgotModal(false);
      setShowSetPassword(true);
      setOtpSent(false);
      setEnteredOtp("");
    } catch (err: any) {
      setOtpError(err.response?.data?.error || "Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openForgotModal = () => {
    setForgotEmail(email);
    setShowForgotModal(true);
    setOtpSent(false);
    setEnteredOtp("");
    setOtpError("");
    setResendCooldown(0);
  };

  return (
      <div
        className="min-h-screen flex flex-col lg:flex-row bg-cover bg-left-top relative overflow-hidden"
        style={{
          backgroundImage: "url('/prashanti_returns_bg.png')"
        }}
      >
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-purple-900/30 to-pink-900/40"></div>

      {/* Left Section - Brand */}
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex flex-col justify-center px-6 sm:px-8 lg:px-12 py-8 lg:py-0 text-left">
        <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black text-white mb-3 lg:mb-6 drop-shadow-2xl tracking-wider leading-tight">
          Prashanti Sarees
        </h1>
        <p className="text-lg sm:text-xl lg:text-3xl text-white/90 drop-shadow-lg font-light tracking-wide mb-4 lg:mb-6">
          Returns Admin Portal
        </p>
        <div className="w-20 sm:w-24 lg:w-32 h-1 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full"></div>
      </div>

      {/* Right Section - Login Form */}
      <div className="relative z-10 flex-1 lg:flex-[0.5] flex items-center justify-center px-4 sm:px-6 lg:px-8 py-6 lg:py-0">
        <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl sm:rounded-3xl shadow-2xl px-6 sm:px-8 py-8 sm:py-10 border border-white/20 w-full max-w-md animate-in fade-in slide-in-from-right-8 duration-700">

          <div className="text-center mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Agent Login</h2>
            <p className="text-gray-500 text-xs sm:text-sm">Sign in to access your Returns Admin dashboard</p>
            <div className="w-12 h-1 bg-gradient-to-r from-purple-600 to-pink-600 mx-auto rounded-full mt-4"></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase ml-3">
                Email Address
              </label>
              <div className="relative group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 sm:pl-11 pr-4 py-3 sm:py-3.5 border border-gray-200 rounded-full focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-400 font-medium outline-none bg-gray-50/50 focus:bg-white text-sm sm:text-base"
                  placeholder="Enter your email"
                  required
                  autoComplete="email"
                />
                <User className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-gray-500 uppercase ml-3">
                Password
              </label>
              <div className="relative group">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 sm:pl-11 pr-12 py-3 sm:py-3.5 border border-gray-200 rounded-full focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all duration-300 text-gray-900 placeholder-gray-400 font-medium outline-none bg-gray-50/50 focus:bg-white text-sm sm:text-base"
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <Lock className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={openForgotModal}
                  className="text-xs sm:text-sm font-semibold text-purple-600 hover:text-pink-600 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-red-600 text-xs sm:text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3.5 sm:py-4 px-6 rounded-full font-bold text-sm sm:text-base hover:opacity-90 transition-all duration-300 shadow-lg relative disabled:opacity-70"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
              ) : (
                "Sign In to Dashboard"
              )}
            </button>

            {/* Additional Info */}
            <p className="text-center text-xs text-gray-400 mt-4">
              Secure agent portal for Prashanti Sarees staff only
            </p>
          </form>
        </div>
      </div>

      {/* --- SET PASSWORD MODAL --- */}
      {showSetPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 border border-white/20 relative animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowSetPassword(false)}
              className="absolute top-3 right-3 p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center mb-6 text-center">
              <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">Setup Password</h3>
              <p className="text-gray-500 text-sm mt-1">Create a secure password for your account</p>
            </div>

            <form onSubmit={handleSetPassword} className="space-y-4">
              {/* New Password */}
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 border rounded-full outline-none bg-gray-50 focus:bg-white focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all text-sm sm:text-base"
                  placeholder="Enter new password"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
              </div>

              {/* Confirm Password */}
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-4 pr-12 py-3 border rounded-full outline-none bg-gray-50 focus:bg-white focus:ring-4 focus:ring-purple-100 focus:border-purple-500 transition-all text-sm sm:text-base"
                  placeholder="Re-enter password"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {newPassword && (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${newPassword.length >= 8 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      ✓ 8+ chars
                    </span>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${/[A-Z]/.test(newPassword) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      ✓ Uppercase
                    </span>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${/\d/.test(newPassword) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      ✓ Number
                    </span>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${/[!@#$%^&*(),.?":{}|<>]/.test(newPassword) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      ✓ Special
                    </span>
                  </div>
                </div>
              )}

              {passwordError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-red-600 text-sm font-medium">{passwordError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3.5 rounded-full font-bold hover:opacity-90 transition-all disabled:opacity-70"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
                ) : (
                  "Set Password & Login"
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- FORGOT PASSWORD MODAL --- */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 relative animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowForgotModal(false)}
              className="absolute top-3 right-3 p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center mb-6 text-center">
              <div className="w-12 h-12 bg-pink-100 text-pink-600 rounded-full flex items-center justify-center mb-3">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-800">Reset Password</h3>
              <p className="text-gray-500 text-sm mt-1">
                {!otpSent
                  ? "Enter your email to receive a verification code"
                  : "Enter the 6-digit code sent to your email"}
              </p>
            </div>

            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="relative">
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full pl-4 pr-4 py-3 border rounded-full outline-none bg-gray-50 focus:bg-white focus:ring-4 focus:ring-pink-100 focus:border-pink-500 transition-all text-sm sm:text-base"
                    placeholder="Email address"
                    required
                    autoComplete="email"
                  />
                </div>

                {otpError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-red-600 text-sm font-medium">{otpError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3.5 rounded-full font-bold hover:opacity-90 transition-all disabled:opacity-70"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
                  ) : (
                    "Send Recovery Code"
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    maxLength={6}
                    value={enteredOtp}
                    onChange={(e) => setEnteredOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3 border rounded-full outline-none bg-gray-50 focus:bg-white focus:ring-4 focus:ring-pink-100 focus:border-pink-500 transition-all text-center text-xl sm:text-2xl tracking-[0.5em] sm:tracking-[0.8em] font-bold placeholder:text-gray-300"
                    placeholder="• • • • • •"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                </div>

                {/* OTP Instructions */}
                <p className="text-xs text-gray-400 text-center">
                  Enter the 6-digit code sent to <strong className="text-gray-600">{forgotEmail}</strong>
                </p>

                {otpError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-red-600 text-sm font-medium">{otpError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-3.5 rounded-full font-bold hover:opacity-90 transition-all disabled:opacity-70"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
                  ) : (
                    "Verify Code"
                  )}
                </button>

                {/* Resend Button with Cooldown */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={resendCooldown > 0 || loading}
                    className={`text-xs sm:text-sm font-medium transition-colors ${
                      resendCooldown > 0
                        ? "text-gray-400 cursor-not-allowed"
                        : "text-purple-600 hover:text-pink-600"
                    }`}
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Resend code"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}