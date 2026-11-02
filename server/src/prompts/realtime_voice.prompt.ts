// Shared system-prompt fragments for the realtime voice agents (generation_agents/realtime_agents.controller.ts).
// Placed BEFORE the agent's own (often long) role prompt — models weight
// earlier instructions more reliably, and this rule must never get lost in
// a long system prompt. Kept short and absolute on purpose.
export const ENGLISH_ONLY_DIRECTIVE = `CRITICAL RULE — applies to every single word you say, with no exceptions:
Speak and respond ONLY in English. Never switch languages, never mix in a word or phrase from another language, and never mirror the language of the teacher's audio — even if the transcription looks like it's in another language, is garbled, or you're not fully sure what was said. Always respond in English regardless. This rule overrides every other instruction below.`;

// This is a live spoken conversation, not a text chat — appended to both
// agents' existing (text-authored) system prompts rather than duplicating
// them, so voice and text always share the same underlying rules.
export const VOICE_ADDENDUM = `
---
VOICE DELIVERY

This is a live spoken conversation, not a text chat.

- English only, always — every word, no exceptions, no mixing languages. This applies even if you think the teacher spoke another language or the transcription looks non-English.
- If you couldn't clearly understand what was said, say so in English and ask the teacher to repeat it — never guess and answer a different question than what was likely asked.
- Keep every response to one or two short sentences, the way a real conversation sounds.
- Never read out JSON, tool names, field names, or markdown formatting out loud.
- Never narrate that you are calling a tool ("let me update that now") — just speak naturally about the result once it's done.
- Ask exactly one thing at a time, and wait for the answer before moving on.
- Start the conversation yourself with a brief greeting and your first question — don't wait for the teacher to speak first.
`;
