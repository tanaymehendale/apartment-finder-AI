import { getApps, getApp, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Single-owner Firebase Auth (replaces the Phase 3.9 ACCESS_KEY gate). This web
// config is not secret — Firebase's own docs treat it as safe to ship to the
// client; the actual access boundary is api/server.py's auth_gate verifying the
// ID token server-side, not this config being hidden.
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Unset in plain local dev (no Firebase project configured yet) — mirrors the
// backend's "OWNER_EMAIL unset = gate disabled" convention. `auth` stays null
// and callers (AuthGate, lib/api.ts's authHeaders) treat that as "auth is off,"
// instead of calling into the Firebase SDK with an incomplete config.
export const firebaseEnabled = Boolean(firebaseConfig.apiKey);

// Guard against double-init under Next's dev fast-refresh (which re-runs this
// module without a full page reload).
const app = firebaseEnabled ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;

export const auth: Auth | null = app ? getAuth(app) : null;
