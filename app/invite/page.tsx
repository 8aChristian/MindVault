"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function InvitePage() {
  const params = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  const supabase = useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }, []);

  useEffect(() => {
    const acceptInvite = async () => {
      if (!supabase || !token) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMessage("Sign in first, then return to this invite link.");
        return;
      }

      setStatus("loading");
      const response = await fetch("/api/invite/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ token }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus("error");
        setMessage(result.error ?? "Failed to accept invite.");
        return;
      }

      setStatus("done");
      setMessage("Invite accepted. You can return to MindVault.");
    };

    acceptInvite();
  }, [supabase, token]);

  return (
    <div className="min-h-screen text-slate-100">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[130px]" />
        <div className="pointer-events-none absolute left-[-8%] top-[35%] h-80 w-80 rounded-full bg-cyan-400/10 blur-[120px]" />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
          <div className="glass-card w-full max-w-lg space-y-4 p-6 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
              Workspace Invite
            </p>
            <h1 className="font-serif text-2xl text-white">Join MindVault</h1>
            <p className="text-sm text-slate-200/80">
              {message ||
                (status === "loading"
                  ? "Accepting invite..."
                  : "Checking your invite link.")}
            </p>
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50"
            >
              Go to MindVault
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
