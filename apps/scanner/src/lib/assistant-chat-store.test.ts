// @vitest-environment jsdom
/**
 * assistant-chat-store tests (2026-07-25) — Tony's ask: chat must survive
 * leaving the AI tab, with simple Claude-style history. Pins:
 *  1. Save/restore round-trip; PHOTOS are stripped to a count (storage
 *     budget) while resolve cards persist.
 *  2. Title comes from the first user message.
 *  3. New chat keeps the old one in history; open/delete behave.
 *  4. Caps: max 15 chats, max 60 messages per chat.
 *  5. Corrupt storage fails soft to empty.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  deleteChat,
  listChats,
  loadActiveChat,
  openChat,
  saveActiveChat,
  startNewChat,
  toStored,
} from "./assistant-chat-store";

const STORE = "store-1";

beforeEach(() => localStorage.clear());

const msg = (id: number, role: "user" | "assistant", text: string, extra = {}) =>
  toStored({ id, role, text, ...extra });

describe("assistant-chat-store", () => {
  it("round-trips the active chat; photos become a count, cards persist", () => {
    saveActiveChat(STORE, [
      msg(1, "user", "add limoncello", { imagePreviews: ["data:image/jpeg;base64,xxxx", "data:..."] }),
      msg(2, "assistant", "done", { resolvedOrder: [{ requested: { name: "limoncello", size: null, qty: 1 } }] as never }),
    ]);
    const restored = loadActiveChat(STORE);
    expect(restored).toHaveLength(2);
    expect(restored[0].photoCount).toBe(2);
    expect((restored[0] as { imagePreviews?: unknown }).imagePreviews).toBeUndefined();
    expect(restored[1].resolvedOrder).toBeTruthy();
  });

  it("titles the chat from the first user message", () => {
    saveActiveChat(STORE, [msg(1, "user", "What have you learned about my store?")]);
    expect(listChats(STORE)[0].title).toBe("What have you learned about my store?");
  });

  it("New chat archives the old one; open restores it; delete removes it", () => {
    saveActiveChat(STORE, [msg(1, "user", "first convo")]);
    startNewChat(STORE);
    expect(loadActiveChat(STORE)).toHaveLength(0); // fresh
    saveActiveChat(STORE, [msg(1, "user", "second convo")]);
    const chats = listChats(STORE);
    expect(chats).toHaveLength(2);
    const first = chats.find((c) => c.title === "first convo");
    expect(openChat(STORE, first!.id)[0].text).toBe("first convo");
    const wasActive = deleteChat(STORE, first!.id);
    expect(wasActive).toBe(true); // we had just opened it
    expect(listChats(STORE)).toHaveLength(1);
  });

  it("caps history at 15 chats and 60 messages per chat", () => {
    for (let i = 0; i < 20; i++) {
      startNewChat(STORE);
      saveActiveChat(STORE, [msg(1, "user", `chat ${i}`)]);
    }
    expect(listChats(STORE)).toHaveLength(15);
    startNewChat(STORE);
    const many = Array.from({ length: 80 }, (_, i) => msg(i + 1, "user", `m${i}`));
    saveActiveChat(STORE, many);
    expect(loadActiveChat(STORE)).toHaveLength(60);
    expect(loadActiveChat(STORE)[0].text).toBe("m20"); // oldest trimmed
  });

  it("corrupt storage fails soft to an empty state", () => {
    localStorage.setItem("lk_assistant_chats_v1:store-1", "{not json");
    expect(loadActiveChat(STORE)).toEqual([]);
    expect(listChats(STORE)).toEqual([]);
  });
});
