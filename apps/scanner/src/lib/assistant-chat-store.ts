/**
 * assistant-chat-store — device-local persistence for the AI chat (Tony,
 * 2026-07-25 at Colony: "every single time I click out of the AI tab the
 * whole chat gets restarted… make it simple but work very well").
 *
 * Claude-style but minimal: conversations survive tab switches and app
 * restarts, a New-chat button starts fresh, and a small history list lets
 * you reopen or delete past chats. Everything lives in localStorage, keyed
 * per store — no backend, no sync (that's a later, deliberate upgrade).
 *
 * PHOTOS ARE STRIPPED before saving (base64 data URIs would blow the ~5MB
 * localStorage budget in two messages) — restored bubbles show a "N photos"
 * chip instead. Resolve cards persist fully (small JSON, and the card is
 * the record of what was matched).
 *
 * Every operation fails SOFT: quota errors / private browsing / corrupt
 * JSON degrade to "chat just doesn't persist", never a crash.
 */
import type { ResolvedOrderLine } from "../api/assistant";

export type StoredChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** How many photos the original bubble had (previews are stripped). */
  photoCount?: number;
  resolvedOrder?: ResolvedOrderLine[];
};

export type StoredChat = {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredChatMessage[];
};

type ChatState = { activeId: string | null; chats: StoredChat[] };

const MAX_CHATS = 15;
const MAX_MESSAGES_PER_CHAT = 60;
const KEY_PREFIX = "lk_assistant_chats_v1:";

const keyFor = (storeId: string | null | undefined) =>
  `${KEY_PREFIX}${storeId || "nostore"}`;

function readState(storeId: string | null | undefined): ChatState {
  try {
    const raw = localStorage.getItem(keyFor(storeId));
    if (!raw) return { activeId: null, chats: [] };
    const parsed = JSON.parse(raw) as ChatState;
    if (!parsed || !Array.isArray(parsed.chats)) return { activeId: null, chats: [] };
    return { activeId: parsed.activeId ?? null, chats: parsed.chats };
  } catch {
    return { activeId: null, chats: [] };
  }
}

function writeState(storeId: string | null | undefined, state: ChatState): void {
  try {
    localStorage.setItem(keyFor(storeId), JSON.stringify(state));
  } catch {
    // Quota / private mode — persistence silently off. Never break chat.
  }
}

function titleFrom(messages: StoredChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  const t = (first?.text ?? "New chat").trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

/** UI message → stored message (photos stripped to a count). */
export function toStored(m: {
  id: number;
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
  photoCount?: number;
  resolvedOrder?: ResolvedOrderLine[];
}): StoredChatMessage {
  const photoCount = m.imagePreviews?.length ?? m.photoCount ?? 0;
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    ...(photoCount > 0 ? { photoCount } : {}),
    ...(m.resolvedOrder ? { resolvedOrder: m.resolvedOrder } : {}),
  };
}

/** The active chat's messages (restore on mount), or [] when none. */
export function loadActiveChat(storeId: string | null | undefined): StoredChatMessage[] {
  const s = readState(storeId);
  const active = s.chats.find((c) => c.id === s.activeId);
  return active?.messages ?? [];
}

/** Persist the current messages into the active chat (creates it on first save). */
export function saveActiveChat(
  storeId: string | null | undefined,
  messages: StoredChatMessage[],
): void {
  if (messages.length === 0) return; // nothing to save; New chat handles clearing
  const s = readState(storeId);
  const trimmed = messages.slice(-MAX_MESSAGES_PER_CHAT);
  let active = s.chats.find((c) => c.id === s.activeId);
  if (!active) {
    // Collision-proof id (caught by test 2026-07-25: two chats created in
    // the same millisecond shared a Date.now() id — open/delete hit the
    // wrong one).
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    active = { id, title: "", updatedAt: 0, messages: [] };
    s.chats.unshift(active);
    s.activeId = active.id;
  }
  active.messages = trimmed;
  active.title = titleFrom(trimmed);
  active.updatedAt = Date.now();
  // Newest first; cap the shelf.
  s.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  s.chats = s.chats.slice(0, MAX_CHATS);
  writeState(storeId, s);
}

/** Start a fresh chat (the old one stays in history if it had messages). */
export function startNewChat(storeId: string | null | undefined): void {
  const s = readState(storeId);
  s.activeId = null;
  s.chats = s.chats.filter((c) => c.messages.length > 0);
  writeState(storeId, s);
}

/** All chats, newest first (for the history list). */
export function listChats(storeId: string | null | undefined): StoredChat[] {
  return readState(storeId).chats;
}

/** Open a past chat; returns its messages (and marks it active). */
export function openChat(
  storeId: string | null | undefined,
  chatId: string,
): StoredChatMessage[] {
  const s = readState(storeId);
  const chat = s.chats.find((c) => c.id === chatId);
  if (!chat) return [];
  s.activeId = chatId;
  writeState(storeId, s);
  return chat.messages;
}

/** Delete a chat from history. Returns true if the ACTIVE chat was deleted. */
export function deleteChat(storeId: string | null | undefined, chatId: string): boolean {
  const s = readState(storeId);
  const wasActive = s.activeId === chatId;
  s.chats = s.chats.filter((c) => c.id !== chatId);
  if (wasActive) s.activeId = null;
  writeState(storeId, s);
  return wasActive;
}
