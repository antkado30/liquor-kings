import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { askAssistant, formatAssistantError } from "../api/assistant";
import type { ResolvedOrderLine } from "../api/assistant";
import { ResolvedOrderCard } from "./ResolvedOrderCard";
import { downscaleImageFile } from "../lib/downscaleImage";
import type { CartContextValue } from "../hooks/useCart";
import {
  IconAlert,
  IconCamera,
  IconPaperclip,
  IconSparkles,
  IconX,
} from "./Icons";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /**
   * ALL attached photos (2026-07-23). Was a single `imagePreview` holding
   * only images[0] — the API sent every photo but the bubble showed ONE,
   * so a multi-photo send looked like the app dropped the rest. The bubble
   * must show exactly what was sent (doctrine: the app never lies).
   */
  imagePreviews?: string[];
  /** Bottles the assistant resolved → renders an inline Add-to-cart card. */
  resolvedOrder?: ResolvedOrderLine[];
};

type FailedAsk = {
  question: string;
  imageDataUris?: string[];
};

/** Max raw upload size before client-side downscale (15 MB). */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Max photos per message — matches the server cap (MAX_IMAGES_PER_MESSAGE). */
const MAX_IMAGES = 6;

/** Curated starters — mix of general catalog questions and store ops. */
const STARTER_PROMPTS = [
  "What's my cost on Tito's 750?",
  "What pairs with a bourbon flight?",
  "Is a 12-pack of 50ml Smirnoff a valid order?",
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

  return [...new Set(out)].slice(0, 4);
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 2;
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isTableRow(line)) {
      const headers = parseTableRow(line);
      i += 1;
      if (i < lines.length && isTableSeparator(lines[i])) {
        i += 1;
      }
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraphLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    if (match[2]) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{match[2]}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={`${keyPrefix}-i${index}`}>{match[3]}</em>);
    } else if (match[4]) {
      nodes.push(
        <code key={`${keyPrefix}-c${index}`} className="assistant-md__code">
          {match[4]}
        </code>,
      );
    }
    last = match.index + match[0].length;
    index += 1;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes.length ? nodes : [text];
}

function AssistantMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(text), [text]);

  return (
    <div className="assistant-md">
      {blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
          return (
            <p key={`p-${blockIndex}`} className="assistant-md__p">
              {renderInline(block.text, `p-${blockIndex}`)}
            </p>
          );
        }
        if (block.type === "ul") {
          return (
            <ul key={`ul-${blockIndex}`} className="assistant-md__ul">
              {block.items.map((item, itemIndex) => (
                <li key={`ul-${blockIndex}-${itemIndex}`}>
                  {renderInline(item, `ul-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={`ol-${blockIndex}`} className="assistant-md__ol">
              {block.items.map((item, itemIndex) => (
                <li key={`ol-${blockIndex}-${itemIndex}`}>
                  {renderInline(item, `ol-${blockIndex}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <div key={`table-${blockIndex}`} className="assistant-md__table-wrap">
            <table className="assistant-md__table">
              <thead>
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th key={`th-${blockIndex}-${headerIndex}`}>
                      {renderInline(header, `th-${blockIndex}-${headerIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`tr-${blockIndex}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`td-${blockIndex}-${rowIndex}-${cellIndex}`}>
                        {renderInline(cell, `td-${blockIndex}-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
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
  // Multi-photo (2026-07-17): a real weekly order is a page or two of
  // handwriting plus a few shelf shots. Capped to match the server.
  const [pendingImages, setPendingImages] = useState<string[]>([]);
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
        : [...STARTER_PROMPTS].slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart?.items.length],
  );

  const showSuggestions = messages.length === 0 && !isAsking && !askError;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isAsking, pendingImages, askError]);

  // Accepts one OR many files (gallery multi-select). Each is validated +
  // downscaled and appended, up to MAX_IMAGES total.
  const handleImageFiles = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    setImageError(null);

    const room = MAX_IMAGES - pendingImages.length;
    if (room <= 0) {
      setImageError(`You can attach up to ${MAX_IMAGES} photos.`);
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    const droppedForCount = files.length > room;

    setImageBusy(true);
    try {
      const added: string[] = [];
      let sawError: string | null = null;
      for (const file of chosen) {
        if (!file.type.startsWith("image/")) {
          sawError = "Some files were skipped — photos only (JPEG, PNG, etc.).";
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          sawError = `A photo was skipped — too large (max ${formatFileSize(MAX_IMAGE_BYTES)}).`;
          continue;
        }
        try {
          added.push(await downscaleImageFile(file));
        } catch (e) {
          sawError = e instanceof Error ? e.message : "Could not process a photo.";
        }
      }
      if (added.length > 0) setPendingImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES));
      if (droppedForCount) {
        setImageError(`Only the first ${MAX_IMAGES} photos were attached.`);
      } else if (sawError) {
        setImageError(sawError);
      }
    } finally {
      setImageBusy(false);
    }
  };

  const runAsk = async (
    question: string,
    imageList?: string[],
    options?: { appendUserMessage?: boolean },
  ) => {
    const q = question.trim();
    const images = (imageList ?? []).filter((u) => u && u.trim().length > 0);
    if ((!q && images.length === 0) || isAsking || imageBusy) return;

    const displayText =
      q || (images.length > 1 ? `What's in these ${images.length} photos?` : "What's in this photo?");
    // Send prior turns so the assistant keeps context (fixes "every one of what?").
    const priorTurns = messages
      .map((m) => ({ role: m.role, content: m.text }))
      .filter((m) => m.content.trim());
    setAskError(null);
    setFailedAsk(null);

    if (options?.appendUserMessage !== false) {
      setInput("");
      setPendingImages([]);
      setMessages((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "user",
          text: displayText,
          ...(images.length > 0 ? { imagePreviews: images } : {}),
        },
      ]);
    }

    setIsAsking(true);
    const result = await askAssistant(displayText, images, priorTurns);
    setIsAsking(false);

    if (result.ok) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "assistant",
          text: result.answer,
          ...(result.resolvedOrder ? { resolvedOrder: result.resolvedOrder } : {}),
        },
      ]);
    } else {
      const message = formatAssistantError(result.error);
      setAskError(message);
      setFailedAsk({ question: displayText, imageDataUris: images });
    }
  };

  const submit = (question: string) => {
    void runAsk(question, pendingImages);
  };

  const retryLastAsk = () => {
    if (!failedAsk || isAsking) return;
    void runAsk(failedAsk.question, failedAsk.imageDataUris, {
      appendUserMessage: false,
    });
  };

  const canSend =
    !isAsking && !imageBusy && (input.trim().length > 0 || pendingImages.length > 0);

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
            <div className="assistant-empty__hero">
              <span className="assistant-empty__icon" aria-hidden>
                <IconSparkles size={28} strokeWidth={1.8} />
              </span>
              <h2 className="assistant-empty__title">How can I help?</h2>
              <p className="assistant-empty__desc muted">
                Ask about your catalog, pricing, MLCC rules, or orders. Attach a
                photo from your library or take one live.
              </p>
            </div>
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
              <div className="assistant-msg__bubble">
                {m.imagePreviews && m.imagePreviews.length > 0 ? (
                  <div className="assistant-msg-images">
                    {m.imagePreviews.map((src, idx) => (
                      <img
                        key={idx}
                        src={src}
                        alt=""
                        className="assistant-msg-image"
                      />
                    ))}
                  </div>
                ) : null}
                {m.role === "assistant" ? (
                  <AssistantMarkdown text={m.text} />
                ) : (
                  <p className="assistant-msg__text">{m.text}</p>
                )}
              </div>
              {m.role === "assistant" && m.resolvedOrder && cart ? (
                <ResolvedOrderCard lines={m.resolvedOrder} cart={cart} />
              ) : null}
            </div>
          ))
        )}

        {isAsking ? (
          <div
            className="assistant-msg assistant-msg--assistant assistant-msg--thinking"
            aria-label="Assistant is thinking"
          >
            <div className="assistant-msg__bubble">
              <div className="assistant-thinking">
                <span className="assistant-thinking__dots" aria-hidden>
                  <span className="assistant-thinking__dot" />
                  <span className="assistant-thinking__dot" />
                  <span className="assistant-thinking__dot" />
                </span>
                <span className="assistant-thinking__label">Thinking</span>
              </div>
            </div>
          </div>
        ) : null}

        {askError && !isAsking ? (
          <div
            className="assistant-msg assistant-msg--assistant assistant-msg--error"
            role="alert"
          >
            <div className="assistant-msg__bubble assistant-msg__bubble--error">
              <span className="assistant-error">
                <IconAlert size={18} strokeWidth={2} aria-hidden />
                <span>{askError}</span>
              </span>
              <button
                type="button"
                className="btn secondary assistant-error__retry"
                onClick={retryLastAsk}
                disabled={!failedAsk}
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {imageError ? (
        <p className="banner banner-err assistant-composer__banner" role="alert">
          {imageError}
        </p>
      ) : null}

      {pendingImages.length > 0 ? (
        <div className="assistant-image-preview-row">
          {pendingImages.map((img, i) => (
            <div className="assistant-image-preview" key={`${i}-${img.slice(0, 24)}`}>
              <img src={img} alt={`Attached photo ${i + 1}`} />
              <button
                type="button"
                className="assistant-image-remove"
                onClick={() => {
                  setPendingImages((prev) => prev.filter((_, idx) => idx !== i));
                  setImageError(null);
                }}
                disabled={isAsking || imageBusy}
                aria-label={`Remove photo ${i + 1}`}
              >
                <IconX size={16} strokeWidth={2} />
              </button>
            </div>
          ))}
          {pendingImages.length < MAX_IMAGES ? (
            <button
              type="button"
              className="assistant-image-add"
              onClick={() => galleryInputRef.current?.click()}
              disabled={isAsking || imageBusy}
              aria-label="Add another photo"
            >
              <IconPaperclip size={18} strokeWidth={1.85} />
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="assistant-file-input"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void handleImageFiles(e.target.files);
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
            void handleImageFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="assistant-input-row">
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
          <button
            type="submit"
            className="btn primary assistant-send-btn"
            disabled={!canSend}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
