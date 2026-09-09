"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, firebaseEnabled } from "@/lib/firebase";
import {
  getProfile,
  saveApiKey,
  testApiKey,
  type ByokProvider,
  type ProfileSummary,
} from "@/lib/api";
import { CheckCircleIcon, ChevronRightIcon, SpinnerIcon } from "@/lib/icons";

// Phase 5 onboarding: 2 free full-pipeline searches on the app's own keys,
// then OpenAI + a listing provider (RentCast or Apify) key are required here
// to keep going. Gemini and Google Maps stay app-managed always — see
// CLAUDE.md's Onboarding / BYOK section for why those two are excluded.
const PROVIDER_INFO: Record<
  ByokProvider,
  { label: string; href: string; hint: string }
> = {
  openai: {
    label: "OpenAI",
    href: "https://platform.openai.com/api-keys",
    hint: "Required. Powers the Manager, Analyst, and Summarizer.",
  },
  rentcast: {
    label: "RentCast",
    href: "https://app.rentcast.io/app/api",
    hint: "One listing-provider key is required — RentCast or Apify (or both).",
  },
  apify: {
    label: "Apify",
    href: "https://console.apify.com/settings/integrations",
    hint: "One listing-provider key is required — RentCast or Apify (or both).",
  },
};

function ApiKeyRow({
  provider,
  isSet,
  onSaved,
}: {
  provider: ByokProvider;
  isSet: boolean;
  onSaved: () => void;
}) {
  const info = PROVIDER_INFO[provider];
  const [value, setValue] = useState("");
  const [testResult, setTestResult] = useState<{ valid: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleTest() {
    if (!value.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testApiKey(provider, value.trim()));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveApiKey(provider, value.trim());
      setValue("");
      setTestResult(null);
      onSaved();
    } catch (err) {
      setSaveError((err as Error).message || "Failed to save key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <a
          href={info.href}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-neutral-800 hover:text-primary-700"
        >
          {info.label}
        </a>
        {isSet && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700">
            <CheckCircleIcon className="w-3.5 h-3.5" />
            Key saved
          </span>
        )}
      </div>
      <p className="text-xs text-neutral-500">{info.hint}</p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setTestResult(null);
          }}
          placeholder={isSet ? "Replace saved key…" : "Paste your key…"}
          autoComplete="off"
          className="flex-1 text-sm px-3 py-2 rounded-xl border border-neutral-200 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={!value.trim() || testing}
          className="px-3 py-2 text-sm font-medium rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {testing ? <SpinnerIcon className="w-4 h-4 animate-spin" /> : "Test"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="px-3 py-2 text-sm font-medium rounded-xl bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {testResult && (
        <p className={`text-xs ${testResult.valid ? "text-success-700" : "text-danger-600"}`}>
          {testResult.message}
        </p>
      )}
      {saveError && <p className="text-xs text-danger-600">{saveError}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    return onAuthStateChanged(auth, (u) => setUserEmail(u?.email ?? null));
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      setProfile(await getProfile());
    } catch {
      setError("Couldn't load your profile. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            aria-label="Back"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-neutral-100 transition-colors"
          >
            <ChevronRightIcon className="w-4 h-4 rotate-180 text-neutral-500" />
          </button>
          <h1 className="text-lg font-semibold text-neutral-900 font-display">Settings</h1>
        </div>

        {userEmail && (
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3">
            <span className="text-sm text-neutral-600 truncate">{userEmail}</span>
            <button
              type="button"
              onClick={() => auth && signOut(auth)}
              className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <SpinnerIcon className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && <p className="text-sm text-danger-600">{error}</p>}

        {profile && (
          <>
            <div className="rounded-xl border border-neutral-200 p-4">
              {profile.byok_active ? (
                <p className="text-sm text-success-700 flex items-center gap-1.5">
                  <CheckCircleIcon className="w-4 h-4" />
                  Your own keys are active — every search uses only your keys.
                </p>
              ) : (
                <p className="text-sm text-neutral-700">
                  {profile.free_runs_remaining > 0
                    ? `${profile.free_runs_remaining} of 2 free searches remaining.`
                    : "You've used your 2 free searches. Add your own OpenAI + a listing-provider key below to keep going."}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <ApiKeyRow provider="openai" isSet={profile.keys_set.openai} onSaved={loadProfile} />
              <ApiKeyRow provider="rentcast" isSet={profile.keys_set.rentcast} onSaved={loadProfile} />
              <ApiKeyRow provider="apify" isSet={profile.keys_set.apify} onSaved={loadProfile} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
