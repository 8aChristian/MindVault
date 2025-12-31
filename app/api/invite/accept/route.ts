import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const getBearerToken = (request: Request) => {
  const header = request.headers.get("authorization") || "";
  const [, token] = header.split(" ");
  return token;
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { token } = (await request.json()) as { token?: string };

    if (!token) {
      return NextResponse.json({ error: "Missing token." }, { status: 400 });
    }

    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("workspace_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (inviteError || !invite) {
      return NextResponse.json({ error: "Invalid invite." }, { status: 404 });
    }

    if (invite.accepted_at) {
      return NextResponse.json({ status: "already-accepted" });
    }

    const { error: membershipError } = await supabaseAdmin
      .from("workspace_members")
      .upsert(
        {
          workspace_id: invite.workspace_id,
          user_id: userData.user.id,
          role: invite.role,
        },
        { onConflict: "workspace_id,user_id" }
      );

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("workspace_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    return NextResponse.json({ status: "accepted" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to accept invite.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
