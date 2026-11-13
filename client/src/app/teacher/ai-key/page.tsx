"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle, KeyRound, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiKeyStatus, deleteAiKeyService, getAiKeyStatusService, saveAiKeyService } from "@/services/aiKey.service";

const errorMessage = (err: any, fallback: string) => err?.response?.data?.message || err?.message || fallback;

export default function AiKeyPage() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Replacing a key that already works: the form is hidden until they ask for it.
  const [replacing, setReplacing] = useState(false);

  useEffect(() => {
    getAiKeyStatusService()
      .then(setStatus)
      .catch((err) => setLoadError(errorMessage(err, "Could not load your key status")))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste your OpenAI API key first");
      return;
    }
    setSaving(true);
    try {
      const next = await saveAiKeyService(apiKey);
      setStatus(next);
      setApiKey("");
      setReplacing(false);
      toast.success("Key saved. AI features are ready.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the key"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove your OpenAI key? AI features will stop working until you add one again.")) return;
    setRemoving(true);
    try {
      setStatus(await deleteAiKeyService());
      toast.success("Key removed");
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove the key"));
    } finally {
      setRemoving(false);
    }
  };

  const working = Boolean(status?.hasKey && status.status === "valid");
  const rejected = Boolean(status?.hasKey && status.status === "invalid");
  const showForm = !working || replacing;

  return (
    <div className="min-h-full overflow-y-auto bg-[#050505] p-4 text-white sm:p-6 md:p-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI key</h1>
          <p className="mt-1 text-sm text-gray-400">
            Writing questions and grading answers with AI runs on your own OpenAI account, so the cost goes straight to you and you stay in control of it.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : loadError ? (
          <p className="text-sm text-red-300">{loadError}</p>
        ) : status?.mode !== "byok" ? (
          <p className="text-sm text-gray-300">AI is included on this site, so you don&apos;t need to add a key.</p>
        ) : (
          <>
            <section className="space-y-4 rounded-2xl border border-white/10 bg-[#0f0f11] p-5 sm:p-6">
              <div className="flex items-start gap-3">
                {working ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                ) : rejected ? (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                ) : (
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
                )}
                <div className="min-w-0">
                  {working ? (
                    <>
                      <p className="font-semibold">Your key is saved and working</p>
                      <p className="mt-0.5 text-sm text-gray-400">
                        OpenAI key ending in <span className="font-mono text-gray-200">{status?.last4}</span>
                      </p>
                    </>
                  ) : rejected ? (
                    <>
                      <p className="font-semibold">OpenAI rejected your key</p>
                      <p className="mt-0.5 text-sm text-gray-400">
                        The key ending in <span className="font-mono text-gray-200">{status?.last4}</span> no longer works, so AI features are paused. Add a new key below.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold">No key added yet</p>
                      <p className="mt-0.5 text-sm text-gray-400">Add your OpenAI API key to use AI features.</p>
                    </>
                  )}
                </div>
              </div>

              {showForm ? (
                <div className="space-y-3">
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void save()}
                    placeholder="sk-..."
                    className="font-mono text-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void save()} disabled={saving} className="bg-orange-600 text-white hover:bg-orange-700">
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {saving ? "Checking key..." : "Save key"}
                    </Button>
                    {replacing && (
                      <Button variant="ghost" onClick={() => { setReplacing(false); setApiKey(""); }} disabled={saving} className="text-gray-400 hover:text-white">
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    We check the key with OpenAI before saving it (this uses a tiny fraction of a cent). It is stored encrypted and is never shown again.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => setReplacing(true)} className="border-white/15 bg-transparent text-white hover:bg-white/5">
                    Replace key
                  </Button>
                  <Button variant="ghost" onClick={() => void remove()} disabled={removing} className="text-red-400 hover:bg-red-500/10 hover:text-red-300">
                    {removing ? "Removing..." : "Remove key"}
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 bg-[#0f0f11] p-5 sm:p-6">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-300">How to get a key</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-300">
                <li>
                  Open{" "}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-orange-300 hover:underline">
                    platform.openai.com/api-keys <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  and create a new secret key.
                </li>
                <li>Add some credit under Billing in your OpenAI account. A few dollars is enough to start.</li>
                <li>Paste the key above and save.</li>
              </ol>
              <p className="border-t border-white/10 pt-3 text-xs text-gray-500">
                Tip: set a monthly spending limit in your OpenAI billing settings so your costs can never surprise you. Anyone you share an exam with is graded with your key, so keep some credit in the account.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
