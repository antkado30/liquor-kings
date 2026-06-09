import { useEffect, useMemo, useRef, useState } from "react";
import { askAssistant, formatAssistantError } from "../api/assistant";
import { downscaleImageFile } from "../lib/downscaleImage";
import type { CartContextValue } from "../hooks/useCart";
import {
  IconAlert,
  IconCamera,
  IconLoader,
  IconPaperclip,
  IconX,
} from "./Icons";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

type FailedAsk = {
  question: string;
  imageDataUri?: string;
};

/** Max raw upload size before client-side downscale (15 MB). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Curated starters — mix of general catalog questions and store ops. */
const STARTER_PROMPTS = [
  "Best tequila for margaritas under $30?",
  "What should I reorder this week?",
  "Is Crown Royal Apple in MLCC's catalog?",
  "How many liters do I need per distributor?",
  "What's the 9 liter rule?",
] as const;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Compute context-aware suggestions for the assistant (task #74,
 * 2026-06-04). Static "what's the 9L rule" got stale fast — these
 * change based on what's happening in the app right now.
 */
export function buildContextualSuggestions(cart: CartContextValue): string[] {
  const out: string[] = [...STARTER_PROMPTS];
  const hasItems = cart.items.length > 0;
  const distinctSkus = new Set(cart.items.map((it) => it.product.code)).size;
  const hour = new Date().getHours();
  const morning = hour >= 6 && hour < 12;
  const evening = hour >= 17 && hour < 22;

  if (hasItems) {
    out[1] = "Will my current cart pass MLCC validation?";
    if (distinctSkus >= 3) {
      out[3] = "Which distributor in my cart has the smallest subtotal?";
    }
  } else if (morning) {
    out[1] = "What did I order last week?";
  } else if (evening) {
    out[1] = "Summarize today's orders";
  }

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
  const [askError, setAskError] = useState<string | null>(null);
  const [failedAsk, setFailedAsk] = useState<FailedAsk | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(1);

  const suggestions = useMemo(
    () =>
      cart
        ? buildContextualSuggestions(cart)
        : [...STARTER_PROMPTS].slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart?.items.length],
  );

  const showSuggestions = messages.length === 0 && !isAsking && !askError;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isAsking, pendingImage, askError]);

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return;

    setImageError(null);

    if (!file.type.startsWith("image/")) {
      setImageError("Please choose a photo (JPEG, PNG, or similar).");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `Photo is too large (${formatFileSize(file.size)}). Max ${formatFileSize(MAX_IMAGE_BYTES)}.`,
      );
      return;
    }

    setImageBusy(true);
    try {
      const dataUri = await downscaleImageFile(file);
      setPendingImage(dataUri);
    } catch (e) {
      setImageError(
        e instanceof Error ? e.message : "Could not process that photo.",
      );
    } finally {
      setImageBusy(false);
    }
  };

  const runAsk = async (
    question: string,
    imageDataUri?: string,
    options?: { appendUserMessage?: boolean },
  ) => {
    const q = question.trim();
    const image = imageDataUri?.trim() || undefined;
    if ((!q && !image) || isAsking || imageBusy) return;

    const displayText = q || "What's in this photo?";
    setAskError(null);
    setFailedAsk(null);

    if (options?.appendUserMessage !== false) {
      setInput("");
      setPendingImage(null);
      setMessages((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "user",
          text: displayText,
          ...(image ? { imagePreview: image } : {}),
        },
      ]);
    }

    setIsAsking(true);
    const result = await askAssistant(displayText, image);
    setIsAsking(false);

    if (result.ok) {
      setMessages((prev) => [
        ...prev,
        { id: nextIdRef.current++, role: "assistant", text: result.answer },
      ]);
    } else {
      const message = formatAssistantError(result.error);
      setAskError(message);
      setFailedAsk({ question: displayText, imageDataUri: image });
    }
  };

  const submit = (question: string) => {
    void runAsk(question, pendingImage ?? undefined);
  };

  const retryLastAsk = () => {
    if (!failedAsk || isAsking) return;
    void runAsk(failedAsk.question, failedAsk.imageDataUri, {
      appendUserMessage: false,
    });
  };

  const canSend =
    !isAsking && !imageBusy && (input.trim().length > 0 || pendingImage != null);

  return (
    <div
      className={`assistant-chat${layout === "page" ? " assistant-chat--page" : ""}`}
    >
      <div
        className="assistant-messages"
        ref={listRef}
        aria-live="polite"
        aria-busy={isAsking}
      >
        {showSuggestions ? (
          <div className="assistant-empty">
            <p className="muted">
              Ask anything about your catalog, pricing, MLCC rules, or orders.
              Attach a photo from your camera roll or take one live.
            </p>
            <p className="muted small" style={{ marginTop: 8 }}>
              Try one of these:
            </p>
            <div className="assistant-suggestions" role="list">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="assistant-suggestion"
                  role="listitem"
                  onClick={() => submit(s)}
                  disabled={isAsking || imageBusy}
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
          <div
            className="assistant-msg assistant-msg--assistant assistant-msg--loading"
            aria-label="Assistant is thinking"
          >
            <span
              className="settings-spinner"
              style={{ display: "inline-flex", marginRight: 8, verticalAlign: "middle" }}
              aria-hidden
            >
              <IconLoader size={16} strokeWidth={2} />
            </span>
            Thinking…
          </div>
        ) : null}

        {askError && !isAsking ? (
          <div
            className="assistant-msg assistant-msg--assistant"
            role="alert"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              border: "1px solid rgba(248, 113, 113, 0.35)",
              background: "rgba(248, 113, 113, 0.1)",
            }}
          >
            <span style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <IconAlert
                size={18}
                strokeWidth={2}
                style={{ flexShrink: 0, marginTop: 2, color: "#fecaca" }}
                aria-hidden
              />
              <span>{askError}</span>
            </span>
            <button
              type="button"
              className="btn secondary"
              onClick={retryLastAsk}
              disabled={!failedAsk}
              style={{ alignSelf: "flex-start" }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>

      {imageError ? (
        <p className="banner banner-err" role="alert">
          {imageError}
        </p>
      ) : null}

      {pendingImage ? (
        <div className="assistant-image-preview">
          <img src={pendingImage} alt="Attached photo preview" />
          <button
            type="button"
            className="assistant-image-remove"
            onClick={() => {
              setPendingImage(null);
              setImageError(null);
            }}
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
          submit(input);
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
