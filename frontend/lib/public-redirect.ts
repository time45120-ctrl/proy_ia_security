import type { NextRequest } from "next/server";

const DEFAULT_PRODUCTION_ORIGIN = "https://afcrseguridad.com";

export function createPublicRedirectUrl(request: NextRequest, pathname: string) {
  if (request.nextUrl.hostname !== "0.0.0.0") {
    return new URL(pathname, request.nextUrl.origin);
  }

  const configuredOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_PRODUCTION_ORIGIN;
  return new URL(pathname, configuredOrigin);
}
