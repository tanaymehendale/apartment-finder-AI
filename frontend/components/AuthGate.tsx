"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";

const OWNER_EMAIL = process.env.NEXT_PUBLIC_OWNER_EMAIL?.toLowerCase();

type Status = "checking" | "in" | "out";

// Single-owner Firebase Auth gate (replaces Phase 3.9's ACCESS_KEY gate). This
// is UX only — redirects a logged-out visitor to /login so they don't see the
// app shell first. The actual access boundary is api/server.py's auth_gate,
// which verifies the Firebase ID token server-side on every request; a
// determined visitor bypassing this component entirely still can't reach the
// backend without a token from the allowlisted owner's account.
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
  // same no-op convention as the backend's unset OWNER_EMAIL.
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

  if (OWNER_EMAIL && user?.email?.toLowerCase() !== OWNER_EMAIL) {
    // Anyone can sign in/sign up here (see app/login/page.tsx) — it grants
    // nothing, since api/server.py's auth_gate only ever accepts OWNER_EMAIL.
    // This screen is just the friendly face on that rejection.
    return (
      <FullScreenMessage>
        <p className="text-2xl">🎉</p>
        <p className="text-sm text-gray-700">You&apos;re on the list!</p>
        <p className="max-w-xs text-xs text-gray-500">
          ApartmentFinder AI isn&apos;t public yet — this will go live soon, and you&apos;ve been
          added to the waitlist.
        </p>
        <button
          type="button"
          onClick={() => auth && signOut(auth)}
          className="mt-1 rounded bg-gray-900 px-3 py-2 text-sm text-white"
        >
          Try a different account
        </button>
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
