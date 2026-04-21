/**
 * Barcodes on bottles are UPCs. Barcodes on MLCC shelf tags are MLCC codes (numeric, 3–5 digits).
 * Both are handled by getProductByCode in api/catalog.ts, which resolves MLCC code first then UPC fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sentry } from "../lib/sentry";

type BarcodeScannerProps = {
  onScan: (code: string) => void;
  active: boolean;
};

const COOLDOWN_MS = 2000;
const DETECT_INTERVAL_MS = 220;
const ZXING_COOLDOWN_MS = 200;

type ZxDecodeHintType = import("@zxing/library").DecodeHintType;

async function buildZxingDecodeHints(): Promise<Map<ZxDecodeHintType, unknown> | null> {
  let lib: typeof import("@zxing/library");
  try {
    lib = await import("@zxing/library");
  } catch (e) {
    try {
      await import("@zxing/browser");
    } catch {
      /* ignore */
    }
    console.warn("[BarcodeScanner] @zxing/library unavailable; scanning without decode hints", e);
    return null;
  }
  const { DecodeHintType, BarcodeFormat } = lib;
  const hints = new Map<ZxDecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const invKey = (DecodeHintType as unknown as Record<string, number | undefined>).ALSO_INVERTED;
  if (typeof invKey === "number") {
    hints.set(invKey as ZxDecodeHintType, true);
  }
  return hints;
}

type NativeBarcodeDetector = {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string; format?: string }>>;
};

type ScannerEngine = "native" | "zxing" | "unsupported";

function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

function hasCameraSupport(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zxingResetRef = useRef<(() => void) | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef(0);
  const lastZxingScanRef = useRef<{ code: string; at: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [engine, setEngine] = useState<ScannerEngine>("unsupported");

  const reportCameraError = useCallback((error: unknown) => {
    const sentryCapture = Sentry?.captureException;
    if (typeof sentryCapture === "function") {
      sentryCapture(error);
      return;
    }
    if (typeof window !== "undefined") {
      const winSentry = (window as Window & { Sentry?: { captureException?: (err: unknown) => void } }).Sentry;
      if (typeof winSentry?.captureException === "function") {
        winSentry.captureException(error);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function detectEngine() {
      if (hasNativeBarcodeDetector()) {
        if (!cancelled) setEngine("native");
        return;
      }
      if (!hasCameraSupport()) {
        if (!cancelled) setEngine("unsupported");
        return;
      }
      try {
        await import("@zxing/browser");
        if (!cancelled) setEngine("zxing");
      } catch (error) {
        reportCameraError(error);
        if (!cancelled) {
          setEngine("unsupported");
          setPermissionError("Camera unavailable. Please enter codes manually.");
        }
      }
    }

    void detectEngine();

    return () => {
      cancelled = true;
    };
  }, [reportCameraError]);

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    detectorRef.current = null;
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    zxingResetRef.current?.();
    zxingResetRef.current = null;
    setScanning(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!active || engine === "unsupported") {
      stopCamera();
      return;
    }

    let cancelled = false;

    async function start() {
      setPermissionError(null);
      if (engine === "native") {
        try {
          const formats = ["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"];
          const Detector = window.BarcodeDetector!;
          const detector = new Detector({ formats }) as NativeBarcodeDetector;
          detectorRef.current = detector;

          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const v = videoRef.current;
          if (v) {
            v.srcObject = stream;
            await v.play().catch(() => {});
          }
          setScanning(true);

          timerRef.current = setInterval(async () => {
            const vid = videoRef.current;
            const det = detectorRef.current;
            if (!vid || !det || vid.readyState < 2) return;
            const now = Date.now();
            if (now - lastScanRef.current < COOLDOWN_MS) return;
            try {
              const codes = await det.detect(vid);
              if (codes.length > 0) {
                const raw = codes[0].rawValue?.trim();
                if (raw) {
                  lastScanRef.current = Date.now();
                  onScan(raw);
                }
              }
            } catch {
              /* ignore frame errors */
            }
          }, DETECT_INTERVAL_MS);
        } catch (error) {
          reportCameraError(error);
          setPermissionError("Camera unavailable. Please enter codes manually.");
          stopCamera();
        }
        return;
      }

      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const v = videoRef.current;
        if (!v) {
          setPermissionError("Camera unavailable. Please enter codes manually.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const readerOptions = { delayBetweenScanSuccess: 200 };
        let reader: InstanceType<typeof BrowserMultiFormatReader>;
        try {
          const hints = await buildZxingDecodeHints();
          reader = hints
            ? new BrowserMultiFormatReader(hints, readerOptions)
            : new BrowserMultiFormatReader(undefined, readerOptions);
        } catch (hintErr) {
          console.warn("[BarcodeScanner] ZXing decode hints failed; using default reader", hintErr);
          reportCameraError(hintErr);
          reader = new BrowserMultiFormatReader(undefined, readerOptions);
        }
        zxingResetRef.current = () => {
          (reader as unknown as { reset?: () => void }).reset?.();
        };
        const controls = await reader.decodeFromStream(stream, v, (result) => {
          if (!result) return;
          const raw = result.getText().trim();
          if (!raw) return;
          const now = Date.now();
          const prev = lastZxingScanRef.current;
          if (prev && prev.code === raw && now - prev.at < ZXING_COOLDOWN_MS) return;
          lastZxingScanRef.current = { code: raw, at: now };
          onScan(raw);
        });
        zxingControlsRef.current = controls;
        setScanning(true);
      } catch (error) {
        reportCameraError(error);
        setPermissionError("Camera unavailable. Please enter codes manually.");
        stopCamera();
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [active, engine, onScan, reportCameraError, stopCamera]);

  const submitManual = () => {
    const c = manualCode.trim();
    if (c) {
      onScan(c);
      setManualCode("");
    }
  };

  return (
    <section className="scanner-panel">
      {permissionError ? (
        <p className="scanner-permission-msg">{permissionError}</p>
      ) : null}
      {active && engine !== "unsupported" && !permissionError ? (
        <>
          <div className="scanner-video-wrap">
            <video ref={videoRef} className="scanner-video" playsInline muted />
            {scanning ? (
              <div className="scanner-overlay">
                <span className="scanner-pulse" />
                <span>Scanning…</span>
              </div>
            ) : null}
          </div>
          <p className="muted small">{engine === "native" ? "Using native scanner" : "Using ZXing fallback"}</p>
        </>
      ) : null}
      {engine === "unsupported" ? (
        <p className="scanner-fallback-title">Camera not available on this browser — enter codes manually</p>
      ) : null}
      <div className="scanner-manual">
        <label className="muted small">Enter code manually</label>
        <div className="scanner-manual-row">
          <input
            className="scanner-manual-input"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="MLCC code"
            enterKeyHint="done"
          />
          <button type="button" className="btn secondary" onClick={submitManual}>
            Use code
          </button>
        </div>
      </div>
    </section>
  );
}
