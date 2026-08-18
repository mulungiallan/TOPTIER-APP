"use client";

/**
 * 2FA Setup Component
 * Drop into settings page or wherever you want 2FA setup UI
 */

import { useState } from "react";

export function TwoFactorSetup() {
  const [step, setStep] = useState<"idle" | "qr" | "verify" | "backup" | "enabled">("idle");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setup = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setQrCode(json.data.qrCode);
      setSecret(json.data.secret);
      setStep("qr");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", secret, code }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setBackupCodes(json.data.backupCodes);
      setStep("backup");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    if (!code) { setError("Enter your current 2FA code to disable"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setStep("idle");
      setCode("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="font-semibold mb-2">🔐 Two-Factor Authentication</h3>

      {step === "idle" && (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            Add an extra layer of security to your account using Google Authenticator, Authy, or similar.
          </p>
          <button
            onClick={setup}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Setting up..." : "Enable 2FA"}
          </button>
        </>
      )}

      {step === "qr" && (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            Scan this QR code with your authenticator app:
          </p>
          <div className="bg-white p-3 rounded-lg inline-block mb-3">
            <img src={qrCode} alt="2FA QR Code" width={200} height={200} />
          </div>
          <p className="text-xs text-muted-foreground mb-1">Or enter this code manually:</p>
          <code className="block bg-black/30 p-2 rounded text-xs mb-3 break-all">{secret}</code>
          <input
            type="text"
            placeholder="Enter 6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            className="w-32 px-3 py-2 rounded-lg bg-white/5 border border-white/10 mb-2"
          />
          <button
            onClick={verify}
            disabled={loading || code.length !== 6}
            className="block px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Verify & Enable"}
          </button>
        </>
      )}

      {step === "backup" && (
        <>
          <p className="text-sm text-amber-400 mb-2 font-medium">⚠️ Save these backup codes</p>
          <p className="text-sm text-muted-foreground mb-3">
            Use these one-time codes if you lose access to your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {backupCodes.map((c, i) => (
              <code key={i} className="bg-black/30 p-2 rounded text-center text-sm font-mono">{c}</code>
            ))}
          </div>
          <button
            onClick={() => setStep("enabled")}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600"
          >
            I've saved them — continue
          </button>
        </>
      )}

      {step === "enabled" && (
        <>
          <div className="flex items-center gap-2 text-emerald-400 mb-3">
            <span>✅</span>
            <span className="font-medium">2FA is active</span>
          </div>
          <input
            type="text"
            placeholder="Enter code to disable"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            className="w-40 px-3 py-2 rounded-lg bg-white/5 border border-white/10 mb-2"
          />
          <button
            onClick={disable}
            disabled={loading}
            className="block px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/30"
          >
            {loading ? "Disabling..." : "Disable 2FA"}
          </button>
        </>
      )}

      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
}
