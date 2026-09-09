"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";

type Status = "checking" | "in" | "out";

// Open Firebase Auth gate (Phase 5 — replaced the earlier single-owner
// allowlist). This is UX only — redirects a logged-out visitor to /login so
// they don't see the app shell first. The actual access boundary is
// api/server.py's auth_gate, which verifies the Firebase ID token server-side
// on every request and requires a verified email (any account, not just one).
export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(firebaseEnabled ? "checking" : "in");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setStatus(u ? "in" : "out");
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (status === "out" && pathname !== "/login") {
      router.replace("/login");
    }
  }, [status, pathname, router]);

  // No Firebase project configured — plain local dev needs zero auth setup,
  // same no-op convention as the backend's unset FIREBASE_PROJECT_ID.
  if (!firebaseEnabled) return <>{children}</>;

  // /login must always render its own content, regardless of auth state, or a
  // logged-out visitor never gets past the loading/redirect flash to see the form.
  if (pathname === "/login") return <>{children}</>;

  if (status === "checking" || status === "out") {
    return (
      <FullScreenMessage>
        <p className="text-sm text-gray-400">
          {status === "checking" ? "Loading…" : "Redirecting to sign in…"}
        </p>
      </FullScreenMessage>
    );
  }

  if (user && !user.emailVerified) {
    // The backend's auth_gate requires email_verified — an unverified
    // email/password signup would otherwise hit a confusing 403 on first API
    // call. Google sign-in accounts are always already verified.
    return (
      <FullScreenMessage>
        <p className="text-sm text-gray-700">Verify your email to continue</p>
        <p className="max-w-xs text-xs text-gray-500">
          We sent a verification link to {user.email}. Once you&apos;ve verified, refresh this page.
        </p>
      </FullScreenMessage>
    );
  }

  return <>{children}</>;
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  );
}
