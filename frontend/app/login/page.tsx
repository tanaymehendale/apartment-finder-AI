"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  type AuthError,
} from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";

// Open sign-up (Phase 5 — replaced the earlier single-owner login). Any
// verified account can use the app: 2 free searches, then your own OpenAI +
// RentCast/Apify keys in Settings. Google sign-in is verified automatically;
// email/password accounts need to click the verification link we email them
// (api/server.py's auth_gate requires email_verified) before AuthGate lets
// them into the app.
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
  const [verifyEmailSentTo, setVerifyEmailSentTo] = useState("");

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
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user);
        // Don't redirect yet — the backend requires email_verified, so this
        // account can't do anything useful until they click the link.
        setVerifyEmailSentTo(email);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        router.replace("/");
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }

  if (verifyEmailSentTo) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-sm text-gray-700">Check your email</p>
          <p className="text-xs text-gray-500">
            We sent a verification link to {verifyEmailSentTo}. Click it, then come back and sign in.
          </p>
          <button
            type="button"
            onClick={() => {
              setVerifyEmailSentTo("");
              setMode("signin");
            }}
            className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white"
          >
            Back to sign in
          </button>
        </div>
      </main>
    );
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
          Sign in to get 2 free searches — after that, add your own OpenAI + RentCast/Apify keys
          in Settings to keep going.
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
