import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue as isValidManagerSession } from "@/lib/manager-session";
import { KITCHEN_SESSION_COOKIE, isValidSessionCookieValue as isValidKitchenSession } from "@/lib/kitchen-session";

// /manager and /kitchen each handle their own gate-vs-dashboard split at
// their bare route (same URL either way — see their page.tsx files).
// Everything deeper under either has no gate UI of its own, so an
// unauthenticated request there bounces back to that role's gate.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/manager/")) {
    const authed = isValidManagerSession(request.cookies.get(MANAGER_SESSION_COOKIE)?.value);
    if (!authed) return NextResponse.redirect(new URL("/manager", request.url));
  }

  if (pathname.startsWith("/kitchen/")) {
    const authed = isValidKitchenSession(request.cookies.get(KITCHEN_SESSION_COOKIE)?.value);
    if (!authed) return NextResponse.redirect(new URL("/kitchen", request.url));
  }
}

export const config = {
  matcher: ["/manager/:path+", "/kitchen/:path+"],
};
