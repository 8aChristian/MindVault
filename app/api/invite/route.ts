import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type InvitePayload = {
  workspaceId?: string;
  email?: string;
  role?: "viewer" | "editor";
};

const getBearerToken = (request: Request) => {
  const header = request.headers.get("authorization") || "";
  const [, token] = header.split(" ");
  return token;
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const payload = (await request.json()) as InvitePayload;
    const workspaceId = payload.workspaceId?.trim();
    const email = payload.email?.trim().toLowerCase();
    const role = payload.role ?? "viewer";

    if (!workspaceId || !email) {
      return NextResponse.json(
        { error: "Workspace and email are required." },
        { status: 400 }
      );
    }

    if (!["viewer", "editor"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: membership } = await supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only workspace owners can invite." },
        { status: 403 }
      );
    }

    const { data: existingUser } =
      await supabaseAdmin.auth.admin.getUserByEmail(email);

    if (existingUser?.user) {
      const { error: memberError } = await supabaseAdmin
        .from("workspace_members")
        .upsert(
          {
            workspace_id: workspaceId,
            user_id: existingUser.user.id,
            role,
          },
          { onConflict: "workspace_id,user_id" }
        );

      if (memberError) {
        return NextResponse.json(
          { error: memberError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ status: "added" });
    }

    const inviteToken = crypto.randomUUID();
    const { error: inviteError } = await supabaseAdmin
      .from("workspace_invites")
      .insert({
        workspace_id: workspaceId,
        email,
        role,
        token: inviteToken,
      });

    if (inviteError) {
      return NextResponse.json(
        { error: inviteError.message },
        { status: 500 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "";
    const inviteLink = siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/invite?token=${inviteToken}`
      : null;

    if (siteUrl) {
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteLink ?? undefined,
      });
    }

    return NextResponse.json({ status: "invited", inviteLink });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send invite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
