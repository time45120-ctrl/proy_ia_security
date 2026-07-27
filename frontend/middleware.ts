import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    .trim();
  const requestHost = (forwardedHost ?? request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();

  if (requestHost === "www.afcrtecnologia.com") {
    const canonicalUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      "https://afcrtecnologia.com",
    );
    return NextResponse.redirect(canonicalUrl, 301);
  }

  if (request.nextUrl.pathname.startsWith("/desarrollo")) {
    return updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
