import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { integrationStatus } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ integrations: integrationStatus() });
}
