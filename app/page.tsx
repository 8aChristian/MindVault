"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MEDIA_BUCKET = "mindvault-media";

const dateFilters = [
  { value: "all", label: "Any time" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "year", label: "This year" },
] as const;

const contentFilters = [
  { value: "all", label: "All types" },
  { value: "text", label: "Text only" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "pdf", label: "PDFs" },
  { value: "file", label: "Files" },
] as const;

type DateFilter = (typeof dateFilters)[number]["value"];
type ContentFilter = (typeof contentFilters)[number]["value"];

type Note = {
  id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  content: string;
  tags: string[] | null;
  created_at: string;
  updated_at?: string | null;
  reminder_at?: string | null;
  attachment_url?: string | null;
  attachment_type?: "image" | "audio" | "pdf" | "file" | null;
  attachment_path?: string | null;
};

type NoteDraft = {
  title: string;
  content: string;
  tags: string;
  reminderAt: string;
  file: File | null;
};

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  workspace?: Workspace;
};

type Profile = {
  user_id: string;
  plan: "free" | "pro";
};

type Plan = {
  id: string;
  name: string;
  note_limit: number | null;
  workspace_limit: number | null;
  ai_enabled: boolean;
};

type AiAction = "summarize" | "improve" | "tags" | "generate" | "ask";
type AiTone = "casual" | "professional";
type AppTab = "home" | "ai" | "manage" | "plan";

type AiResult = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
};

const emptyDraft: NoteDraft = {
  title: "",
  content: "",
  tags: "",
  reminderAt: "",
  file: null,
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const toDatetimeLocalValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const formatTagInput = (tags: string[] | null | undefined) =>
  tags && tags.length > 0 ? tags.map((tag) => `#${tag}`).join(" ") : "";

const normalizeTag = (tag: string) =>
  tag.trim().replace(/^#+/, "").toLowerCase();

const parseTags = (value: string) => {
  const normalized = value
    .split(/[\s,]+/)
    .map(normalizeTag)
    .filter(Boolean);
  return Array.from(new Set(normalized));
};

const getDateFloor = (filter: DateFilter) => {
  if (filter === "all") return null;
  const now = new Date();
  if (filter === "week") now.setDate(now.getDate() - 7);
  if (filter === "month") now.setDate(now.getDate() - 30);
  if (filter === "year") now.setMonth(0, 1);
  return now.toISOString();
};

const getAttachmentType = (file: File) => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf") return "pdf";
  return "file";
};

const resolveLimit = (limit: number | null | undefined) =>
  limit === null || limit === undefined || limit <= 0
    ? Number.POSITIVE_INFINITY
    : limit;

const formatLimit = (limit: number) =>
  Number.isFinite(limit) ? `${limit}` : "Unlimited";

const tabs: { id: AppTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "ai", label: "AI" },
  { id: "manage", label: "Manage" },
  { id: "plan", label: "Upgrade plan" },
];

const fallbackPlans: Plan[] = [
  {
    id: "free",
    name: "Free",
    note_limit: 50,
    workspace_limit: 1,
    ai_enabled: false,
  },
  {
    id: "pro",
    name: "Pro",
    note_limit: null,
    workspace_limit: null,
    ai_enabled: true,
  },
];

export default function Home() {
  const supabase = useMemo(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }, []);

  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("home");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [plans, setPlans] = useState<Plan[]>(fallbackPlans);
  const [plansError, setPlansError] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<WorkspaceMember[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null
  );
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>(
    []
  );
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [noteCount, setNoteCount] = useState(0);

  const [searchTerm, setSearchTerm] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [ftsEnabled, setFtsEnabled] = useState(true);

  const [composer, setComposer] = useState<NoteDraft>(emptyDraft);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [aiResults, setAiResults] = useState<AiResult[]>([]);
  const [aiBusy, setAiBusy] = useState<AiAction | null>(null);
  const [aiTone, setAiTone] = useState<AiTone>("professional");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiTargetId, setAiTargetId] = useState("draft");
  const [aiError, setAiError] = useState<string | null>(null);

  const envReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.workspace_id === activeWorkspaceId),
    [workspaces, activeWorkspaceId]
  );
  const activePlanId = profile?.plan ?? "free";
  const activePlan = useMemo(
    () =>
      plans.find((plan) => plan.id === activePlanId) ??
      fallbackPlans.find((plan) => plan.id === activePlanId) ??
      fallbackPlans[0],
    [plans, activePlanId]
  );
  const noteLimit = resolveLimit(activePlan?.note_limit);
  const workspaceLimit = resolveLimit(activePlan?.workspace_limit);
  const aiEnabled = activePlan?.ai_enabled ?? false;
  const canEdit = activeWorkspace?.role !== "viewer";
  const isOwner = activeWorkspace?.role === "owner";
  const workspaceLimitReached =
    Number.isFinite(workspaceLimit) && workspaces.length >= workspaceLimit;
  const noteLimitReached = Number.isFinite(noteLimit) && noteCount >= noteLimit;
  const aiTargetNote = useMemo(
    () =>
      aiTargetId === "draft"
        ? null
        : notes.find((note) => note.id === aiTargetId) ?? null,
    [aiTargetId, notes]
  );

  const buildAiContent = (note: Note | null) => {
    if (!note) {
      const draftTitle = composer.title.trim() || "Untitled draft";
      const draftTags = parseTags(composer.tags);
      const tags = draftTags.length
        ? `Tags: ${draftTags.join(", ")}`
        : "Tags: none";
      return `Title: ${draftTitle}
${tags}

${composer.content.trim()}`;
    }
    const tags = note.tags?.length
      ? `Tags: ${note.tags.join(", ")}`
      : "Tags: none";
    return `Title: ${note.title}
${tags}

${note.content}`;
  };

  const buildVaultContext = (entries: Note[]) => {
    const sorted = [...entries].sort((a, b) =>
      new Date(b.updated_at || b.created_at).getTime() -
      new Date(a.updated_at || a.created_at).getTime()
    );
    const chunks: string[] = [];
    let total = 0;

    for (const note of sorted) {
      const content = note.content?.trim();
      if (!content && !note.title) continue;
      const tags = note.tags?.length ? `Tags: ${note.tags.join(", ")}` : "Tags: none";
      const snippet = content ? content.slice(0, 800) : "No content";
      const block = `Title: ${note.title}\n${tags}\nContent: ${snippet}`;
      if (total + block.length > 6000) break;
      chunks.push(block);
      total += block.length;
      if (chunks.length >= 10) break;
    }

    return chunks.join("\n\n");
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const hydrateProfile = useCallback(async () => {
    if (!supabase || !session?.user) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) return;

    if (!data) {
      const { data: inserted } = await supabase
        .from("profiles")
        .insert({ user_id: session.user.id, plan: "free" })
        .select()
        .single();
      setProfile((inserted as Profile) ?? null);
      return;
    }

    setProfile(data as Profile);
  }, [supabase, session]);

  const fetchPlans = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("plans").select("*");

    if (error || !data || data.length === 0) {
      if (error) setPlansError(error.message);
      setPlans(fallbackPlans);
      return;
    }

    setPlans(data as Plan[]);
    setPlansError(null);
  }, [supabase]);

  const fetchWorkspaces = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);

    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, user_id, role, workspace:workspaces(*)")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true });

    if (error) {
      setWorkspaceError(error.message);
      setWorkspaceBusy(false);
      return;
    }

    const memberships = (data ?? []) as WorkspaceMember[];

    if (memberships.length === 0) {
      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces")
        .insert({
          name: "Personal",
          owner_id: session.user.id,
        })
        .select()
        .single();

      if (workspaceError) {
        setWorkspaceError(workspaceError.message);
        setWorkspaceBusy(false);
        return;
      }

      const { error: memberError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: workspace.id,
          user_id: session.user.id,
          role: "owner",
        });

      if (memberError) {
        setWorkspaceError(memberError.message);
        setWorkspaceBusy(false);
        return;
      }

      memberships.push({
        workspace_id: workspace.id,
        user_id: session.user.id,
        role: "owner",
        workspace,
      });
    }

    setWorkspaces(memberships);
    setActiveWorkspaceId((prev) =>
      prev && memberships.some((member) => member.workspace_id === prev)
        ? prev
        : memberships[0]?.workspace_id ?? null
    );
    setWorkspaceBusy(false);
  }, [supabase, session]);

  const fetchWorkspaceMembers = useCallback(
    async (workspaceId: string) => {
      if (!supabase || !session?.user) return;
      const { data } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, role")
        .eq("workspace_id", workspaceId);
      setWorkspaceMembers((data ?? []) as WorkspaceMember[]);
    },
    [supabase, session]
  );

  const fetchNoteCount = useCallback(async () => {
    if (!supabase || !activeWorkspaceId) return;
    const { count, error } = await supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", activeWorkspaceId);

    if (!error && typeof count === "number") {
      setNoteCount(count);
    }
  }, [supabase, activeWorkspaceId]);

  useEffect(() => {
    if (!session?.user) return;
    hydrateProfile();
    fetchWorkspaces();
  }, [session?.user, hydrateProfile, fetchWorkspaces]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchWorkspaceMembers(activeWorkspaceId);
    fetchNoteCount();
  }, [activeWorkspaceId, fetchWorkspaceMembers, fetchNoteCount]);

  const fetchNotes = useCallback(async () => {
    if (!supabase || !session?.user || !activeWorkspaceId) return;
    setLoadingNotes(true);
    setNotesError(null);

    let query = supabase
      .from("notes")
      .select("*")
      .eq("workspace_id", activeWorkspaceId);

    const trimmedSearch = searchTerm.trim();
    if (trimmedSearch) {
      if (ftsEnabled) {
        query = query.textSearch("search", trimmedSearch, {
          type: "websearch",
        });
      } else {
        const escaped = trimmedSearch.replace(/[%_]/g, "\\$&");
        query = query.or(
          `title.ilike.%${escaped}%,content.ilike.%${escaped}%`
        );
      }
    }

    if (tagFilter) {
      query = query.contains("tags", [tagFilter]);
    }

    if (contentFilter === "text") {
      query = query.is("attachment_type", null);
    } else if (contentFilter !== "all") {
      query = query.eq("attachment_type", contentFilter);
    }

    const dateFloor = getDateFloor(dateFilter);
    if (dateFloor) {
      query = query.gte("created_at", dateFloor);
    }

    query = query.order("created_at", { ascending: sortOrder === "oldest" });

    let { data, error } = await query;

    if (error && trimmedSearch && ftsEnabled) {
      setFtsEnabled(false);
      const escaped = trimmedSearch.replace(/[%_]/g, "\\$&");
      let fallback = supabase
        .from("notes")
        .select("*")
        .eq("workspace_id", activeWorkspaceId)
        .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);

      if (tagFilter) {
        fallback = fallback.contains("tags", [tagFilter]);
      }

      if (contentFilter === "text") {
        fallback = fallback.is("attachment_type", null);
      } else if (contentFilter !== "all") {
        fallback = fallback.eq("attachment_type", contentFilter);
      }

      const dateFloorFallback = getDateFloor(dateFilter);
      if (dateFloorFallback) {
        fallback = fallback.gte("created_at", dateFloorFallback);
      }

      fallback = fallback.order("created_at", {
        ascending: sortOrder === "oldest",
      });

      const fallbackResult = await fallback;
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      setNotesError(error.message);
    } else {
      const baseNotes = data ?? [];
      const hydrated = await Promise.all(
        baseNotes.map(async (note) => {
          if (!note.attachment_path) return note;
          const { data: signed, error: signedError } = await supabase.storage
            .from(MEDIA_BUCKET)
            .createSignedUrl(note.attachment_path, 60 * 60);
          if (signedError || !signed?.signedUrl) return note;
          return { ...note, attachment_url: signed.signedUrl };
        })
      );
      setNotes(hydrated);
    }

    setLoadingNotes(false);
  }, [
    supabase,
    session,
    activeWorkspaceId,
    searchTerm,
    tagFilter,
    dateFilter,
    contentFilter,
    sortOrder,
    ftsEnabled,
  ]);

  useEffect(() => {
    if (!session?.user || !activeWorkspaceId) return;
    const timer = setTimeout(() => {
      fetchNotes();
    }, 300);

    return () => clearTimeout(timer);
  }, [fetchNotes, session?.user, activeWorkspaceId]);

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    setAuthError(null);
    const email = authEmail.trim();
    const password = authPassword.trim();

    if (!email || !password) {
      setAuthError("Email and password are required.");
      return;
    }

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) setAuthError(error.message);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) setAuthError(error.message);
  };
  const handleGoogleSignIn = async () => {
    if (!supabase) return;
    setAuthError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) setAuthError(error.message);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setNotes([]);
    setNoteCount(0);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setWorkspaceMembers([]);
    setProfile(null);
  };

  const handleComposerChange = (
    field: keyof NoteDraft,
    value: string | File | null
  ) => {
    setComposer((prev) => ({ ...prev, [field]: value }));
  };

  const uploadAttachment = async (
    file: File,
    userId: string,
    workspaceId: string
  ) => {
    if (!supabase) return null;
    const fileExtension = file.name.split(".").pop() || "bin";
    const filePath = `${workspaceId}/${userId}/${crypto.randomUUID()}.${fileExtension}`;

    const { error } = await supabase
      .storage
      .from(MEDIA_BUCKET)
      .upload(filePath, file, { upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(filePath);
    return {
      attachment_path: filePath,
      attachment_url: data.publicUrl,
      attachment_type: getAttachmentType(file),
    };
  };

  const resetComposer = () => {
    setComposer(emptyDraft);
    setEditingNote(null);
    setRemoveAttachment(false);
  };

  const handleSaveNote = async () => {
    if (!supabase || !session?.user || !activeWorkspaceId) return;

    if (!canEdit) {
      setActionError("You have view-only access to this workspace.");
      return;
    }

    if (!editingNote && noteLimitReached) {
      setActionError("Upgrade your plan to add more notes.");
      return;
    }

    setBusyAction(true);
    setActionError(null);

    try {
      const tagList = parseTags(composer.tags);
      const title = composer.title.trim() || "Untitled note";
      const reminderAt = composer.reminderAt
        ? new Date(composer.reminderAt).toISOString()
        : null;
      const payload: Partial<Note> = {
        title,
        content: composer.content.trim(),
        tags: tagList.length > 0 ? tagList : null,
        reminder_at: reminderAt,
        updated_at: new Date().toISOString(),
      };

      if (editingNote) {
        let attachmentUpdate: Partial<Note> | null = null;

        if (composer.file) {
          const uploaded = await uploadAttachment(
            composer.file,
            session.user.id,
            activeWorkspaceId
          );
          attachmentUpdate = uploaded || null;

          if (editingNote.attachment_path) {
            await supabase.storage
              .from(MEDIA_BUCKET)
              .remove([editingNote.attachment_path]);
          }
        } else if (removeAttachment && editingNote.attachment_path) {
          await supabase.storage
            .from(MEDIA_BUCKET)
            .remove([editingNote.attachment_path]);
          attachmentUpdate = {
            attachment_path: null,
            attachment_url: null,
            attachment_type: null,
          };
        }

        const { error } = await supabase
          .from("notes")
          .update({ ...payload, ...attachmentUpdate })
          .eq("id", editingNote.id);

        if (error) throw error;
      } else {
        let attachmentUpdate: Partial<Note> | null = null;
        if (composer.file) {
          attachmentUpdate = await uploadAttachment(
            composer.file,
            session.user.id,
            activeWorkspaceId
          );
        }

        const { error } = await supabase.from("notes").insert({
          user_id: session.user.id,
          workspace_id: activeWorkspaceId,
          title,
          content: composer.content.trim(),
          tags: tagList.length > 0 ? tagList : null,
          reminder_at: reminderAt,
          attachment_url: attachmentUpdate?.attachment_url ?? null,
          attachment_type: attachmentUpdate?.attachment_type ?? null,
          attachment_path: attachmentUpdate?.attachment_path ?? null,
        });

        if (error) throw error;
      }

      resetComposer();
      await fetchNotes();
      await fetchNoteCount();
    } catch (error) {
      if (error instanceof Error) {
        setActionError(error.message);
      } else {
        setActionError("Something went wrong while saving the note.");
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setComposer({
      title: note.title,
      content: note.content ?? "",
      tags: formatTagInput(note.tags),
      reminderAt: toDatetimeLocalValue(note.reminder_at),
      file: null,
    });
    setRemoveAttachment(false);
    setActionError(null);
  };

  const handleDeleteNote = async (note: Note) => {
    if (!supabase || !session?.user) return;
    if (!canEdit) {
      setActionError("You have view-only access to this workspace.");
      return;
    }
    setBusyAction(true);
    setActionError(null);

    try {
      if (note.attachment_path) {
        await supabase.storage.from(MEDIA_BUCKET).remove([note.attachment_path]);
      }

      const { error } = await supabase
        .from("notes")
        .delete()
        .eq("id", note.id);

      if (error) throw error;

      if (editingNote?.id === note.id) {
        resetComposer();
      }

      await fetchNotes();
      await fetchNoteCount();
    } catch (error) {
      if (error instanceof Error) {
        setActionError(error.message);
      } else {
        setActionError("Failed to delete note.");
      }
    } finally {
      setBusyAction(false);
    }
  };

  const handleWorkspaceSwitch = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setEditingNote(null);
    setComposer(emptyDraft);
    setSearchTerm("");
    setTagFilter(null);
    setDateFilter("all");
    setContentFilter("all");
    setAiResults([]);
    setAiError(null);
    setAiTargetId("draft");
    setAiQuestion("");
  };

  const handleCreateWorkspace = async () => {
    if (!supabase || !session?.user) return;
    setWorkspaceError(null);

    if (workspaceLimitReached) {
      setWorkspaceError("Workspace limit reached for this plan.");
      return;
    }

    const name = workspaceName.trim();
    if (!name) {
      setWorkspaceError("Workspace name is required.");
      return;
    }

    setWorkspaceBusy(true);
    const { data: workspace, error } = await supabase
      .from("workspaces")
      .insert({ name, owner_id: session.user.id })
      .select()
      .single();

    if (error || !workspace) {
      setWorkspaceError(error?.message ?? "Failed to create workspace.");
      setWorkspaceBusy(false);
      return;
    }

    const { error: memberError } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: workspace.id,
        user_id: session.user.id,
        role: "owner",
      });

    if (memberError) {
      setWorkspaceError(memberError.message);
      setWorkspaceBusy(false);
      return;
    }

    setWorkspaces((prev) => [
      ...prev,
      {
        workspace_id: workspace.id,
        user_id: session.user.id,
        role: "owner",
        workspace,
      },
    ]);
    setWorkspaceName("");
    handleWorkspaceSwitch(workspace.id);
    setWorkspaceBusy(false);
  };

  const handleInvite = async () => {
    if (!session?.user || !activeWorkspaceId) return;
    if (!isOwner) {
      setInviteStatus("Only owners can invite collaborators.");
      return;
    }
    const email = inviteEmail.trim();
    if (!email) {
      setInviteStatus("Enter an email address.");
      return;
    }

    setInviteBusy(true);
    setInviteStatus(null);

    const response = await fetch("/api/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        email,
        role: inviteRole,
      }),
    });

    const result = (await response.json()) as {
      status?: string;
      inviteLink?: string | null;
      error?: string;
    };

    if (!response.ok) {
      setInviteStatus(result.error ?? "Invite failed.");
    } else if (result.status === "added") {
      setInviteStatus("Member added to workspace.");
    } else if (result.inviteLink) {
      try {
        await navigator.clipboard.writeText(result.inviteLink);
        setInviteStatus("Invite link copied. Send it via email.");
      } catch {
        setInviteStatus(`Invite link: ${result.inviteLink}`);
      }
    } else {
      setInviteStatus("Invite sent.");
    }

    setInviteEmail("");
    setInviteBusy(false);
    fetchWorkspaceMembers(activeWorkspaceId);
  };

  const handleAiAction = async (action: AiAction) => {
    if (!aiEnabled) {
      setAiError("Upgrade your plan to unlock AI features.");
      return;
    }

    const content = buildAiContent(aiTargetNote);
    const sourceText = aiTargetNote
      ? aiTargetNote.content?.trim()
      : composer.content.trim();
    const hasContent = Boolean(sourceText);

    if (action === "generate" && !aiPrompt.trim()) {
      setAiError("Add a topic to generate a note.");
      return;
    }

    if (action === "ask" && !aiQuestion.trim()) {
      setAiError("Ask a question about your notes.");
      return;
    }

    if (!hasContent && !["generate", "ask"].includes(action)) {
      setAiError("Select a note with content or write a draft first.");
      return;
    }

    setAiBusy(action);
    setAiError(null);

    const notesContext =
      action === "ask" ? buildVaultContext(notes) : undefined;

    if (action === "ask" && !notesContext) {
      setAiError("Add at least one note before asking the vault.");
      setAiBusy(null);
      return;
    }

    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        content,
        tone: aiTone,
        prompt: aiPrompt.trim(),
        question: aiQuestion.trim(),
        notesContext,
      }),
    });

    const result = (await response.json()) as {
      text?: string;
      tags?: string[];
      error?: string;
    };

    if (!response.ok || !result.text) {
      setAiError(result.error ?? "AI request failed.");
      setAiBusy(null);
      return;
    }

    const targetLabel = aiTargetNote?.title ?? "Draft";
    const entry: AiResult = {
      id: crypto.randomUUID(),
      title:
        action === "summarize"
          ? `Summary (${targetLabel})`
          : action === "improve"
          ? `Improved note (${targetLabel})`
          : action === "tags"
          ? `Suggested tags (${targetLabel})`
          : action === "ask"
          ? "Vault answer"
          : "Draft note",
      content: result.text,
      tags: result.tags,
    };

    setAiResults((prev) => [entry, ...prev]);

    if (action === "generate") {
      setComposer((prev) => ({ ...prev, content: result.text ?? "" }));
    }

    if (action === "tags" && result.tags?.length) {
      setComposer((prev) => ({
        ...prev,
        tags: result.tags.map((tag) => `#${tag}`).join(" "),
      }));
    }

    if (action === "ask") {
      setAiQuestion("");
    }

    setAiBusy(null);
  };

  const allTags = useMemo(() => {
    const tags = notes.flatMap((note) => note.tags ?? []);
    return Array.from(new Set(tags)).sort();
  }, [notes]);

  const memberSummary = useMemo(() => {
    const summary = { total: 0, editors: 0, viewers: 0, owners: 0 };
    workspaceMembers.forEach((member) => {
      summary.total += 1;
      if (member.role === "owner") summary.owners += 1;
      if (member.role === "editor") summary.editors += 1;
      if (member.role === "viewer") summary.viewers += 1;
    });
    return summary;
  }, [workspaceMembers]);

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    return notes
      .filter((note) => note.reminder_at)
      .map((note) => ({
        ...note,
        reminder_at: note.reminder_at as string,
      }))
      .filter((note) => new Date(note.reminder_at).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.reminder_at).getTime() -
          new Date(b.reminder_at).getTime()
      )
      .slice(0, 3);
  }, [notes]);

  const latestNoteDate = useMemo(() => {
    if (notes.length === 0) return null;
    return notes
      .map((note) => note.updated_at || note.created_at)
      .sort()
      .at(-1);
  }, [notes]);
  
  if (!session?.user) {
    return (
      <div className="min-h-screen text-slate-100">
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[130px]" />
          <div className="pointer-events-none absolute left-[-8%] top-[35%] h-80 w-80 rounded-full bg-cyan-400/10 blur-[120px]" />

          <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16">
            <div className="w-full max-w-xl space-y-6 fade-in">
              <div className="text-center">
                <p className="text-xs uppercase tracking-[0.4em] text-slate-300/70">
                  MindVault
                </p>
                <h1 className="mt-3 font-serif text-4xl text-white sm:text-5xl">
                  Enter your vault
                </h1>
                <p className="mt-3 text-sm text-slate-300/80">
                  Sign in to save, search, and organize your ideas in a clean,
                  focused space.
                </p>
              </div>

              <div className="glass-card space-y-6 p-6 sm:p-8">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                    Sign in
                  </p>
                  <h2 className="font-serif text-2xl text-white">
                    Access MindVault
                  </h2>
                </div>

                <form className="space-y-4" onSubmit={handleAuthSubmit}>
                  <label className="block text-xs uppercase tracking-[0.2em] text-slate-300/70">
                    Email
                  </label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                    placeholder="you@mindvault.app"
                  />
                  <label className="block text-xs uppercase tracking-[0.2em] text-slate-300/70">
                    Password
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                    placeholder="Enter your secret"
                  />

                  {authError && (
                    <p className="text-xs text-rose-200">{authError}</p>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
                    >
                      {authMode === "signin" ? "Sign in" : "Create account"}
                    </button>
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white transition hover:border-white/60"
                    >
                      Continue with Google
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAuthMode((prev) =>
                          prev === "signin" ? "signup" : "signin"
                        )
                      }
                      className="text-xs text-slate-200/80 hover:text-white"
                    >
                      {authMode === "signin"
                        ? "Need an account- Sign up"
                        : "Already have an account- Sign in"}
                    </button>
                  </div>
                </form>
              </div>

              {!envReady && (
                <div className="glass-card border border-amber-300/40 bg-amber-200/10 p-5 text-sm text-amber-100">
                  <p className="font-semibold text-amber-50">
                    Supabase keys are missing
                  </p>
                  <p className="mt-2 text-amber-100/80">
                    Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and
                    <code> NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your
                    <code> .env.local</code> file to enable auth and storage.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-[130px]" />
        <div className="pointer-events-none absolute left-[-8%] top-[35%] h-80 w-80 rounded-full bg-cyan-400/10 blur-[120px]" />

        <div className="relative z-10 px-6 pb-20 pt-10 lg:px-12">
          <header className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between fade-in">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-300/70">
                MindVault
              </p>
              <h1 className="font-serif text-4xl text-slate-50 sm:text-5xl">
                A calm vault for your loudest ideas.
              </h1>
              <p className="max-w-xl text-sm text-slate-300/80 sm:text-base">
                Capture sparks, shape essays, and keep every thought in a
                minimal, glassy workspace built for flow.
              </p>
            </div>
            <div className="glass-card w-full max-w-md space-y-4 p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                    Vault Status
                  </p>
                  <p className="text-lg font-semibold text-white">
                    {session?.user ? "Signed in" : "Ready"}
                  </p>
                </div>
                <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200/80">
                  {activePlan?.name ?? "Free"}
                </span>
              </div>
              {session?.user ? (
                <div className="space-y-3 text-xs text-slate-200/80">
                  <div className="flex items-center justify-between">
                    <span>{session.user.email}</span>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-medium text-slate-100 transition hover:border-white/50 hover:text-white"
                    >
                      Sign out
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>
                      Workspace:{" "}
                      {activeWorkspace?.workspace?.name ?? "Loading..."}
                    </span>
                    <a
                      href="/dashboard"
                      className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white transition hover:border-white/50"
                    >
                      Analytics
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-200/70">
                  {envReady
                    ? "Sign in to unlock cloud saves and smart search."
                    : "Add Supabase keys to start authenticating users."}
                </div>
              )}
            </div>
          </header>

          <nav className="mx-auto mt-8 max-w-6xl fade-in fade-in-delay-1">
            <div className="glass-card flex flex-wrap justify-center gap-2 p-2">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                      isActive
                        ? "bg-white text-slate-900"
                        : "border border-white/20 text-slate-200/80 hover:border-white/50 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {!envReady && (
            <section className="mx-auto mt-10 max-w-6xl">
              <div className="glass-card border border-amber-300/40 bg-amber-200/10 p-6 text-sm text-amber-100">
                <p className="font-semibold text-amber-50">
                  Supabase keys are missing
                </p>
                <p className="mt-2 text-amber-100/80">
                  Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and
                  <code> NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your
                  <code> .env.local</code> file to enable auth and storage.
                </p>
              </div>
            </section>
          )}

          <main className="mx-auto mt-10 max-w-6xl fade-in fade-in-delay-1">
            <section className="space-y-6">
                {(activeTab === "home" || activeTab === "ai") && (
                  <div className="space-y-6">
                  {activeTab === "home" && (
                    <div className="glass-card space-y-5 p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                            {editingNote ? "Editing" : "New Note"}
                          </p>
                          <h2 className="font-serif text-2xl text-white">
                            {editingNote
                              ? "Refine your thought"
                              : "Capture a fresh idea"}
                          </h2>
                          <p className="mt-1 text-xs text-slate-200/70">
                            Workspace: {activeWorkspace?.workspace?.name ?? "-"} /{" "}
                            {activeWorkspace?.role ?? "viewer"}
                          </p>
                        </div>
                        {editingNote && (
                          <button
                            type="button"
                            onClick={resetComposer}
                            className="rounded-full border border-white/20 px-4 py-2 text-xs text-slate-100 transition hover:border-white/60"
                          >
                            Cancel edit
                          </button>
                        )}
                      </div>

                      {!canEdit && (
                        <div className="rounded-2xl border border-amber-200/40 bg-amber-200/10 p-3 text-xs text-amber-100">
                          View-only access. Ask an owner to upgrade your role.
                        </div>
                      )}

                      <div className="grid gap-4">
                        <input
                          type="text"
                          value={composer.title}
                          onChange={(event) =>
                            handleComposerChange("title", event.target.value)
                          }
                          disabled={!canEdit}
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 disabled:opacity-70"
                          placeholder="Note title"
                        />
                        <textarea
                          value={composer.content}
                          onChange={(event) =>
                            handleComposerChange("content", event.target.value)
                          }
                          disabled={!canEdit}
                          className="min-h-[160px] w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 font-serif leading-relaxed disabled:opacity-70"
                          placeholder="Write your thought..."
                        />
                        <input
                          type="text"
                          value={composer.tags}
                          onChange={(event) =>
                            handleComposerChange("tags", event.target.value)
                          }
                          disabled={!canEdit}
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 disabled:opacity-70"
                          placeholder="#focus #research #dream"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                              Reminder
                            </label>
                            <input
                              type="datetime-local"
                              value={composer.reminderAt}
                              onChange={(event) =>
                                handleComposerChange("reminderAt", event.target.value)
                              }
                              disabled={!canEdit}
                              className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 disabled:opacity-70"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                              Attachments
                            </label>
                            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-3 text-xs text-slate-200/70 transition hover:border-white/40">
                              <input
                                type="file"
                                accept="image/*,audio/*,application/pdf"
                                className="hidden"
                                disabled={!canEdit}
                                onChange={(event) =>
                                  handleComposerChange("file", event.target.files?.[0] ?? null)
                                }
                              />
                              <span>
                                {composer.file
                                  ? `Attached: ${composer.file.name}`
                                  : "Attach image, audio, or PDF"}
                              </span>
                            </label>
                            {editingNote?.attachment_url && (
                              <label className="flex items-center gap-2 text-xs text-slate-200/70">
                                <input
                                  type="checkbox"
                                  checked={removeAttachment}
                                  onChange={(event) =>
                                    setRemoveAttachment(event.target.checked)
                                  }
                                />
                                <span>Remove current attachment</span>
                              </label>
                            )}
                          </div>
                        </div>
                      </div>

                      {actionError && (
                        <p className="text-xs text-rose-200">{actionError}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleSaveNote}
                          disabled={busyAction || !canEdit}
                          className="rounded-full bg-white px-5 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {busyAction
                            ? "Saving..."
                            : editingNote
                            ? "Update note"
                            : "Save note"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleComposerChange("content", "")}
                          disabled={!canEdit}
                          className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold text-white transition hover:border-white/60 disabled:opacity-70"
                        >
                          Clear content
                        </button>
                      </div>
                    </div>
                  )}
                  {activeTab === "ai" && (
                <div className="glass-card space-y-5 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                        AI Studio
                      </p>
                      <h3 className="font-serif text-2xl text-white">
                        Gemini assistant
                      </h3>
                    </div>
                    {!aiEnabled && (
                      <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200/80">
                        Locked
                      </span>
                    )}
                  </div>

                  {!aiEnabled ? (
                    <p className="text-sm text-slate-200/70">
                      Upgrade your plan to unlock summaries, tag suggestions,
                      and drafting tools.
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                            AI source
                          </label>
                          <select
                            value={aiTargetId}
                            onChange={(event) => setAiTargetId(event.target.value)}
                            className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                          >
                            <option value="draft">Current draft</option>
                            {notes.map((note) => (
                              <option key={note.id} value={note.id}>
                                {(note.title || "Untitled note") +
                                  " - " +
                                  formatDate(note.updated_at || note.created_at)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                            Tone
                          </label>
                          <select
                            value={aiTone}
                            onChange={(event) =>
                              setAiTone(event.target.value as AiTone)
                            }
                            className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                          >
                            <option value="professional">Professional</option>
                            <option value="casual">Casual</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => handleAiAction("summarize")}
                          disabled={aiBusy !== null}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Summarize note
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiAction("improve")}
                          disabled={aiBusy !== null}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Improve clarity
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiAction("tags")}
                          disabled={aiBusy !== null}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Suggest tags
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAiAction("generate")}
                          disabled={aiBusy !== null}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Generate draft
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                            Draft topic
                          </label>
                          <input
                            type="text"
                            value={aiPrompt}
                            onChange={(event) => setAiPrompt(event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                            placeholder="e.g. Launch plan for Q3"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                            Ask your vault
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={aiQuestion}
                              onChange={(event) =>
                                setAiQuestion(event.target.value)
                              }
                              className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                              placeholder="Do I have a note about..."
                            />
                            <button
                              type="button"
                              onClick={() => handleAiAction("ask")}
                              disabled={aiBusy !== null}
                              className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                            >
                              Ask
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {aiError && <p className="text-xs text-rose-200">{aiError}</p>}

                  {aiBusy && (
                    <p className="text-xs text-slate-200/70">
                      Gemini is thinking...
                    </p>
                  )}

                  {aiResults.length > 0 && (
                    <div className="space-y-3">
                      {aiResults.map((result) => (
                        <div
                          key={result.id}
                          className="rounded-2xl border border-white/15 bg-white/5 p-4 text-xs text-slate-200/80"
                        >
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">
                            {result.title}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap font-serif text-sm text-slate-100/80">
                            {result.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}
                {activeTab === "home" && (
                  <>
                    <div className="glass-card space-y-5 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                          Search & Filter
                        </p>
                        <h3 className="font-serif text-2xl text-white">
                          Find the right thought
                        </h3>
                      </div>
                      <button
                        type="button"
                      onClick={() => {
                        setSearchTerm("");
                        setTagFilter(null);
                        setDateFilter("all");
                        setContentFilter("all");
                        setSortOrder("newest");
                      }}
                        className="text-xs text-slate-200/70 hover:text-white"
                      >
                        Reset filters
                      </button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                          Full-text search
                        </label>
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                          placeholder="Search titles or content"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                          Date filter
                        </label>
                        <select
                          value={dateFilter}
                          onChange={(event) =>
                            setDateFilter(event.target.value as DateFilter)
                          }
                          className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                        >
                          {dateFilters.map((filter) => (
                            <option key={filter.value} value={filter.value}>
                              {filter.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                          Content type
                        </label>
                        <select
                          value={contentFilter}
                          onChange={(event) =>
                            setContentFilter(event.target.value as ContentFilter)
                          }
                          className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                        >
                          {contentFilters.map((filter) => (
                            <option key={filter.value} value={filter.value}>
                              {filter.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                          Sort by
                        </label>
                        <select
                          value={sortOrder}
                          onChange={(event) =>
                            setSortOrder(
                              event.target.value as "newest" | "oldest"
                            )
                          }
                          className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                        >
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                          Active tag
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {tagFilter ? (
                            <button
                              type="button"
                              onClick={() => setTagFilter(null)}
                              className="rounded-full border border-white/20 px-3 py-2 text-xs text-white transition hover:border-white/50"
                            >
                              #{tagFilter} (clear)
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300/70">
                              No tag filter
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                          Notes
                        </p>
                        <h3 className="font-serif text-2xl text-white">
                          {notes.length} thought{notes.length === 1 ? "" : "s"}
                        </h3>
                      </div>
                      {loadingNotes && (
                        <span className="text-xs text-slate-200/70">
                          Syncing...
                        </span>
                      )}
                    </div>

                    {notesError && (
                      <div className="glass-card border border-rose-300/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                        {notesError}
                      </div>
                    )}

                    {notes.length === 0 && !loadingNotes ? (
                      <div className="glass-card p-6 text-sm text-slate-200/80">
                        Start by writing your first note. It will appear here as
                        a glassmorphism card.
                      </div>
                    ) : (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {notes.map((note) => (
                          <article
                            key={note.id}
                            className="glass-card group flex h-full flex-col gap-4 p-5 transition hover:-translate-y-1 hover:border-white/40"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-300/70">
                                  {formatDate(
                                    note.updated_at || note.created_at
                                  )}
                                </p>
                                <h4 className="mt-2 font-serif text-xl text-white">
                                  {note.title}
                                </h4>
                                {note.reminder_at && (
                                  <p className="mt-2 text-xs text-slate-200/70">
                                    Reminder: {formatDateTime(note.reminder_at)}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col gap-2 text-xs text-slate-200/70">
                                <button
                                  type="button"
                                  onClick={() => handleEditNote(note)}
                                  disabled={!canEdit}
                                  className="rounded-full border border-white/20 px-3 py-1 transition hover:border-white/60 disabled:opacity-60"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNote(note)}
                                  disabled={!canEdit}
                                  className="rounded-full border border-rose-200/40 px-3 py-1 text-rose-100 transition hover:border-rose-200/80 disabled:opacity-60"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>

                            <p className="text-sm text-slate-100/80 font-serif leading-relaxed">
                              {note.content || "No content yet."}
                            </p>

                            {note.attachment_url &&
                              note.attachment_type === "image" && (
                                <img
                                  src={note.attachment_url}
                                  alt="Note attachment"
                                  className="h-40 w-full rounded-2xl object-cover"
                                />
                              )}
                            {note.attachment_url &&
                              note.attachment_type === "audio" && (
                                <audio
                                  controls
                                  src={note.attachment_url}
                                  className="w-full"
                                />
                              )}
                            {note.attachment_url &&
                              note.attachment_type === "pdf" && (
                                <a
                                  href={note.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs text-slate-200/80 transition hover:border-white/40"
                                >
                                  Open PDF attachment
                                </a>
                              )}
                            {note.attachment_url &&
                              note.attachment_type === "file" && (
                                <a
                                  href={note.attachment_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-xs text-slate-200/80 transition hover:border-white/40"
                                >
                                  Open attachment
                                </a>
                              )}

                            <div className="mt-auto flex flex-wrap gap-2">
                              {(note.tags ?? []).map((tag) => (
                                <button
                                  key={`${note.id}-${tag}`}
                                  type="button"
                                  onClick={() => setTagFilter(tag)}
                                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200/80 transition hover:border-white/50"
                                >
                                  #{tag}
                                </button>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  </>
                )}
                </div>
                )}
                {(activeTab === "manage" || activeTab === "plan") && (
                <aside className="space-y-6">
                  {activeTab === "manage" && (
                  <>
                  <div className="glass-card space-y-4 p-6">
                    <div className="flex items-center justify-between">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                        Workspaces
                      </p>
                      <span className="text-xs text-slate-200/70">
                        {workspaces.length}/{formatLimit(workspaceLimit)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      <select
                        value={activeWorkspaceId ?? ""}
                        onChange={(event) =>
                          handleWorkspaceSwitch(event.target.value)
                        }
                        className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                      >
                        {workspaces.map((workspace) => (
                          <option
                            key={workspace.workspace_id}
                            value={workspace.workspace_id}
                          >
                            {workspace.workspace?.name ?? "Workspace"}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={workspaceName}
                          onChange={(event) =>
                            setWorkspaceName(event.target.value)
                          }
                          disabled={workspaceLimitReached}
                          className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60"
                          placeholder="New workspace name"
                        />
                        <button
                          type="button"
                          onClick={handleCreateWorkspace}
                          disabled={workspaceBusy || workspaceLimitReached}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                    {workspaceError && (
                      <p className="text-xs text-rose-200">{workspaceError}</p>
                    )}
                    {workspaceLimitReached && (
                      <p className="text-xs text-slate-200/70">
                        Upgrade your plan to add more workspaces.
                      </p>
                    )}
                  </div>
                  <div className="glass-card space-y-4 p-6">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                      Collaboration
                    </p>
                    <div className="text-xs text-slate-200/70">
                      {memberSummary.total} members / {memberSummary.editors} editors /{" "}
                      {memberSummary.viewers} viewers
                    </div>
                    <div className="grid gap-3">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        disabled={!isOwner}
                        className="w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 disabled:opacity-70"
                        placeholder="Invite by email"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={inviteRole}
                          onChange={(event) =>
                            setInviteRole(
                              event.target.value as "viewer" | "editor"
                            )
                          }
                          disabled={!isOwner}
                          className="glass-select w-full rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white outline-none ring-1 ring-transparent transition focus:border-white/30 focus:ring-sky-400/60 disabled:opacity-70"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleInvite}
                          disabled={!isOwner || inviteBusy}
                          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white transition hover:border-white/50 disabled:opacity-70"
                        >
                          Invite
                        </button>
                      </div>
                    </div>
                    {inviteStatus && (
                      <p className="text-xs text-slate-200/70">
                        {inviteStatus}
                      </p>
                    )}
                    {!isOwner && (
                      <p className="text-xs text-slate-200/70">
                        Only owners can invite collaborators.
                      </p>
                    )}
                  </div>

                  <div className="glass-card space-y-4 p-6">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                      Reminders
                    </p>
                    {upcomingReminders.length === 0 ? (
                      <p className="text-sm text-slate-200/70">
                        No upcoming reminders.
                      </p>
                    ) : (
                      <div className="space-y-3 text-sm text-slate-200/80">
                        {upcomingReminders.map((note) => (
                          <div key={note.id} className="space-y-1">
                            <p className="text-white">{note.title}</p>
                            <p className="text-xs text-slate-300/70">
                              {formatDateTime(note.reminder_at as string)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="glass-card space-y-4 p-6">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                      Vault Stats
                    </p>
                    <div className="space-y-3 text-sm text-slate-200/80">
                    <div className="flex items-center justify-between">
                      <span>Notes in workspace</span>
                      <span className="text-white">{noteCount}</span>
                    </div>
                      <div className="flex items-center justify-between">
                        <span>Unique tags</span>
                        <span className="text-white">{allTags.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Latest update</span>
                        <span className="text-white">
                          {latestNoteDate ? formatDate(latestNoteDate) : "-"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="glass-card space-y-4 p-6">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                      Tag Shelf
                    </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-slate-200/70">
                      Add tags to organize your vault.
                    </p>
                  ) : (
                      <div className="flex flex-wrap gap-2">
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setTagFilter(tag)}
                            className={`rounded-full border px-3 py-1 text-xs transition ${
                              tagFilter === tag
                                ? "border-white/60 bg-white/10 text-white"
                                : "border-white/15 text-slate-200/80 hover:border-white/50"
                            }`}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  </>
                  )}

                {activeTab === "plan" && (
                  <>
                    <div className="glass-card space-y-4 p-6">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                        Plan
                      </p>
                      <h3 className="font-serif text-2xl text-white">
                        MindVault {activePlan?.name ?? "Free"}
                      </h3>
                      <p className="text-sm text-slate-200/70">
                        {formatLimit(workspaceLimit)} workspaces /{" "}
                        {formatLimit(noteLimit)} notes /{" "}
                        {aiEnabled ? "AI enabled" : "AI locked"}
                      </p>
                      <p className="text-xs text-slate-200/70">
                        Plan upgrades are handled manually for now.
                      </p>
                      {plansError && (
                        <p className="text-xs text-rose-200">{plansError}</p>
                      )}
                    </div>
                    <div className="glass-card space-y-4 p-6">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-300/70">
                        What improves with Pro
                      </p>
                      <div className="space-y-2 text-sm text-slate-200/80">
                        <div className="flex items-center justify-between">
                          <span>Workspace limit</span>
                          <span className="text-white">Unlimited</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Note limit</span>
                          <span className="text-white">Unlimited</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>AI assistance</span>
                          <span className="text-white">Enabled</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Attachments</span>
                          <span className="text-white">Included</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-200/70">
                        To upgrade, update your plan in Supabase for now.
                      </p>
                    </div>
                  </>
                )}
                </aside>
                )}
              </section>
          </main>
        </div>
      </div>
    </div>
  );
}
