import api from "@/utils/axios";

// "Bring your own key": each teacher adds their own OpenAI API key, and the AI features (writing questions, grading
// answers) are billed to it. The key is sent to the server once, encrypted there, and never comes back: only whether
// there is one, its last four characters and whether it works.
export interface AiKeyStatus {
  // "byok" = people use their own key. "server" = the site pays for AI itself and no key is needed.
  mode: "byok" | "server";
  hasKey: boolean;
  provider: string | null;
  last4: string | null;
  // "invalid" once OpenAI has rejected the saved key.
  status: "valid" | "invalid" | null;
  updatedAt: string | null;
}

// Tells anything showing the key's state (the banner on every teacher page) to look again after a change.
export const AI_KEY_CHANGED_EVENT = "ai-key-changed";
const announceChange = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_KEY_CHANGED_EVENT));
};

export const getAiKeyStatusService = async (): Promise<AiKeyStatus> => {
  const res = await api.get("/ai-key");
  return res.data.data;
};

/** Checks the key with OpenAI and saves it. Throws with a readable message (invalid key, no credit, ...) if it can't be used. */
export const saveAiKeyService = async (apiKey: string): Promise<AiKeyStatus> => {
  const res = await api.put("/ai-key", { apiKey });
  announceChange();
  return res.data.data;
};

export const deleteAiKeyService = async (): Promise<AiKeyStatus> => {
  const res = await api.delete("/ai-key");
  announceChange();
  return res.data.data;
};
