import type { FlashKind } from "../types";

export function Msg({ type, text }: { type: FlashKind; text: string }) {
  if (!text) return null;
  return <div className={`msg ${type}`}>{text}</div>;
}
