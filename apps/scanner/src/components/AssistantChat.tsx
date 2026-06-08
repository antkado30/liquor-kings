import { useEffect, useMemo, useRef, useState } from "react";
import { askAssistant } from "../api/assistant";
import { downscaleImageFile } from "../lib/downscaleImage";
import type { CartContextValue } from "../hooks/useCart";
import { IconCamera, IconPaperclip, IconX } from "./Icons";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

/**
 * Compute context-aware suggestions for the assistant (task #74,
 * 2026-06-04). Static "what's the 9L rule" got stale fast — these
 * change based on what's happening in the app right now.
 */
export function buildContextualSuggestions(cart: CartContextValue): string[] {
  const out: string[] = [];
  const hasItems = cart.items.length > 0;
  const distinctSkus = new Set(cart.items.map((it) => it.product.code)).size;
  const hour = new Date().getHours();
  const morning = hour >= 6 && hour < 12;
  const evening = hour >= 17 && hour < 22;

  if (hasItems) {
    out.push("Will my current cart pass MLCC validation?");
    if (distinctSkus >= 3) {
      out.push("Which distributor in my cart has the smallest subtotal?");
    }
    out.push("Are any of my cart items new MLCC arrivals?");
  } else {
    if (morning) {
      out.push("What price changes happened in the last 7 days?");
      out.push("What did I order last week?");
    } else if (evening) {
      out.push("Summarize today's orders");
      out.push("What's selling on my shelf this week?");
    } else {
      out.push("What price changes happened in the last 7 days?");
      out.push("What new MLCC arrivals came out this week?");
    }
  }

  out.push("What's the 9 liter rule?");
  out.push("Can I order 8 bottles of a 750ml?");

  return [...new Set(out)].slice(0, 5);
}

type AssistantChatProps = {
  /** Cart state to drive contextual suggestions. Optional for back-compat. */
  cart?: CartContextValue;
  /** When true, messages area grows to fill the page shell. */
  layout?: "page" | "drawer";
};

/**
 * Shared assistant chat UI — used by AssistantPage (full screen) and
 * AssistantPanel (drawer overlay). Each question is an independent
 * call to POST /assistant/ask; conversation is client-side only.
 */
export function AssistantChat({ cart, layout = "page" }: AssistantChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(1);

  const suggestions = useMemo(
    () =>
      cart
        ? buildContextualSuggestions(cart)
        : [
            "What's the 9 liter rule?",
            "How much does code 100009 cost?",
            "Can I order 8 bottles of a 750ml?",
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart?.items.length],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, isAsking, pendingImage]);

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageBusy(true);
    setError(null);
    try {
      const dataUri = await downscaleImageFile(file);
      setPendingImage(dataUri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not process image.");
    } finally {
      setImageBusy(false);
    }
  };

  const submit = async (question: string) => {
    const q = question.trim();
    const imageDataUri = pendingImage;
    if ((!q && !imageDataUri) || isAsking || imageBusy) return;

    const displayText = q || "What's in this photo?";
    setError(null);
    setInput("");
    setPendingImage(null);
    setMessages((prev) => [
      ...prev,
      {
        id: nextIdRef.current++,
        role: "user",
        text: displayText,
        ...(imageDataUri ? { imagePreview: imageDataUri } : {}),
      },
    ]);
    setIsAsking(true);
    const result = await askAssistant(displayText, imageDataUri ?? undefined);
    setIsAsking(false);
    if (result.ok) {
      setMessages((prev) => [
        ...prev,
        { id: nextIdRef.current++, role: "assistant", text: result.answer },
      ]);
    } else {
      setError(result.error);
    }
  };

  const canSend =
    !isAsking && !imageBusy && (input.trim().length > 0 || pendingImage != null);

  return (
    <div
      className={`assistant-chat${layout === "page" ? " assistant-chat--page" : ""}`}
    >
      <div className="assistant-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <p className="muted">
              Ask anything about your catalog, pricing, MLCC rules, or orders.
              Attach a photo from your camera roll or take one live.
            </p>
            <div className="assistant-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="assistant-suggestion"
                  onClick={() => void submit(s)}
                  disabled={isAsking}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`assistant-msg assistant-msg--${m.role}`}>
              {m.imagePreview ? (
                <img
                  src={m.imagePreview}
                  alt=""
                  className="assistant-msg-image"
                />
              ) : null}
              {m.text}
            </div>
          ))
        )}
        {isAsking ? (
          <div className="assistant-msg assistant-msg--assistant assistant-msg--loading">
            Thinking…
          </div>
        ) : null}
      </div>

      {error ? <p className="banner banner-err">{error}</p> : null}

      {pendingImage ? (
        <div className="assistant-image-preview">
          <img src={pendingImage} alt="Attached photo preview" />
          <button
            type="button"
            className="assistant-image-remove"
            onClick={() => setPendingImage(null)}
            disabled={isAsking || imageBusy}
            aria-label="Remove attached photo"
          >
            <IconX size={16} strokeWidth={2} />
          </button>
        </div>
      ) : null}

      <form
        className="assistant-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="assistant-file-input"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void handleImageFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="assistant-file-input"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void handleImageFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="assistant-attach-btn"
          onClick={() => galleryInputRef.current?.click()}
          disabled={isAsking || imageBusy}
          aria-label="Attach photo from library"
        >
          <IconPaperclip size={20} strokeWidth={1.85} />
        </button>
        <button
          type="button"
          className="assistant-attach-btn"
          onClick={() => cameraInputRef.current?.click()}
          disabled={isAsking || imageBusy}
          aria-label="Take a photo"
        >
          <IconCamera size={20} strokeWidth={1.85} />
        </button>
        <input
          type="text"
          className="assistant-input"
          placeholder="Ask the assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isAsking || imageBusy}
          aria-label="Ask the assistant"
        />
        <button type="submit" className="btn primary" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}
