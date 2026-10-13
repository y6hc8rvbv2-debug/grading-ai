import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const db = await createClient();
    await db.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/student", url.origin));
}
