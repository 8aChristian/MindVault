"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type NoteRow = {
  id: string;
  workspace_id: string;
  created_at: string;
  tags: string[] | null;
};

type WorkspaceRow = {
  id: string;
  name: string;
};

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const supabase = useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });
  }, [supabase]);

  useEffect(() => {
    const load = async () => {
      if (!supabase || !session?.user) return;
      setLoading(true);

      const { data: noteData } = await supabase
        .from("notes")
        .select("id, workspace_id, created_at, tags");

      const { data: workspaceData } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(id,name)")
        .eq("user_id", session.user.id);

      setNotes(noteData ?? []);
      setWorkspaces(
        (workspaceData ?? [])
          .map((item) => item.workspace as WorkspaceRow)
          .filter(Boolean)
      );

      setLoading(false);
    };

    load();
  }, [supabase, session]);

  const notesByDay = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return { key, label: date.toLocaleDateString(undefined, { weekday: "short" }) };
    });

    const counts = new Map<string, number>();
    notes.forEach((note) => {
      const key = note.created_at.slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });

    return days.map((day) => ({
      ...day,
      count: counts.get(day.key) ?? 0,
    }));
  }, [notes]);

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => {
      (note.tags ?? []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [notes]);

  const workspaceActivity = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => {
      counts.set(note.workspace_id, (counts.get(note.workspace_id) ?? 0) + 1);
    });
    return workspaces.map((workspace) => ({
      name: workspace.name,
      count: counts.get(workspace.id) ?? 0,
    }));
  }, [notes, workspaces]);

  if (!session?.user) {
    return (
      <div className="min-h-screen text-slate-100">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[130px]" />
          <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
            <div className="glass-card w-full max-w-lg space-y-3 p-6 text-center">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                Analytics
              </p>
              <h1 className="font-serif text-2xl text-white">
                Sign in to view insights
              </h1>
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

  const maxNotes = Math.max(...notesByDay.map((day) => day.count), 1);

  return (
    <div className="min-h-screen text-slate-100">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[130px]" />

        <div className="relative z-10 px-6 pb-16 pt-10 lg:px-12">
          <header className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-300/70">
                  MindVault Analytics
                </p>
                <h1 className="font-serif text-3xl text-white sm:text-4xl">
                  Your vault in motion
                </h1>
              </div>
              <a
                href="/"
                className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50"
              >
                Back to notes
              </a>
            </div>
            <p className="text-sm text-slate-300/80">
              Track note volume, tag trends, and workspace activity.
            </p>
          </header>

          <main className="mx-auto mt-10 grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <section className="glass-card space-y-6 p-6">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                  Notes over time
                </p>
                <h2 className="mt-2 font-serif text-2xl text-white">
                  Last 7 days
                </h2>
              </div>

              {loading ? (
                <p className="text-sm text-slate-200/70">Loading insights...</p>
              ) : (
                <div className="grid grid-cols-7 items-end gap-3">
                  {notesByDay.map((day) => (
                    <div key={day.key} className="text-center text-xs text-slate-200/70">
                      <div className="mb-2 flex h-24 items-end rounded-full bg-white/10">
                        <div
                          className="w-full rounded-full bg-sky-400/70 transition-all"
                          style={{
                            height: `${(day.count / maxNotes) * 100}%`,
                          }}
                        />
                      </div>
                      <span>{day.label}</span>
                      <div className="mt-1 text-[10px] text-slate-300/70">
                        {day.count}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-6">
              <div className="glass-card space-y-4 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                  Top tags
                </p>
                {topTags.length === 0 ? (
                  <p className="text-sm text-slate-200/70">
                    No tag data yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {topTags.map(([tag, count]) => (
                      <div key={tag} className="flex items-center justify-between text-sm text-slate-200/80">
                        <span>#{tag}</span>
                        <span className="text-white">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass-card space-y-4 p-6">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                  Workspace activity
                </p>
                {workspaceActivity.length === 0 ? (
                  <p className="text-sm text-slate-200/70">
                    No workspace data yet.
                  </p>
                ) : (
                  <div className="space-y-3 text-sm text-slate-200/80">
                    {workspaceActivity.map((workspace) => (
                      <div
                        key={workspace.name}
                        className="flex items-center justify-between"
                      >
                        <span>{workspace.name}</span>
                        <span className="text-white">{workspace.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
