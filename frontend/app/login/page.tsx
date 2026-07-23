"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";

// Single-owner login (replaces Phase 3.9's /gate shared-password page).
// Sign-up is intentionally open — anyone can create a Firebase account here,
// but that grants nothing: api/server.py's auth_gate only ever accepts
// OWNER_EMAIL, so a non-owner account (Google or email/password, new or
// existing) just lands on AuthGate's waitlist screen. See CLAUDE.md for the
// OWNER_EMAIL / NEXT_PUBLIC_FIREBASE_* setup this depends on.
const ERROR_MESSAGES: Record<string, string> = {
  "auth/wrong-password": "Wrong password.",
  "auth/user-not-found": "No account with that email.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/too-many-requests": "Too many attempts. Try again in a bit.",
  "auth/email-already-in-use": "An account with that email already exists — try signing in instead.",
  "auth/weak-password": "Password should be at least 6 characters.",
  "auth/unauthorized-domain": "This domain isn't authorized in Firebase yet — add it under Authentication -> Settings -> Authorized domains.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups for this site and try again.",
};

function messageFor(err: unknown): string {
  const code = (err as AuthError)?.code;
  return (code && ERROR_MESSAGES[code]) || "Something went wrong. Try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleGoogle() {
    if (!auth) return;
    setLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.replace("/");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailPassword(e: FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.replace("/");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  if (!firebaseEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-gray-600">
          Firebase isn&apos;t configured (NEXT_PUBLIC_FIREBASE_* env vars are missing) — see
          CLAUDE.md.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-sm text-gray-600">
          Shh 🤫 — this one&apos;s still in beta. You&apos;re only getting in if you&apos;re{" "}
          <em>the</em> developer.
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Sign in with Google
        </button>

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="h-px flex-1 bg-gray-200" />
          or
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={handleEmailPassword} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="username"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading
              ? mode === "signup"
                ? "Creating account…"
                : "Signing in…"
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError("");
          }}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {mode === "signin" ? "Or create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
