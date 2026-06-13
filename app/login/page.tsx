"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (r.ok) router.push("/dashboard");
    else setError((await r.json()).error || "Login failed");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-700 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 text-white">
          <div className="text-3xl font-extrabold tracking-tight">
            Global Bus Rental<span className="text-gold-400"> CRM</span>
          </div>
          <div className="text-white/60 text-sm mt-1">Passenger transport operations platform</div>
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <div className="text-xs text-muted text-center pt-1">
            Default admin: admin@globalbusrental.com / admin123
          </div>
        </form>
      </div>
    </div>
  );
}
