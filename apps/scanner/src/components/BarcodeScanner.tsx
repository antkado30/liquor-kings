/**
 * Barcodes on bottles are UPCs. Barcodes on MLCC shelf tags are MLCC codes (numeric, 3–5 digits).
 * Both are handled by getProductByCode in api/catalog.ts, which resolves MLCC code first then UPC fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sentry } from "../lib/sentry";
import { IconCamera, IconFileText } from "./Icons";

type BarcodeScannerProps = {
  onScan: (code: string) => void;
  active: boolean;
  onPhotoCapture?: (jpegDataUri: string) => void | Promise<void>;
  hideManualInput?: boolean;
};

const COOLDOWN_MS = 2000;
const DETECT_INTERVAL_MS = 220;
const ZXING_COOLDOWN_MS = 200;
const TROUBLE_HINT_MS = 8000;
const VIDEO_IDEAL_WIDTH = 1280;
const VIDEO_IDEAL_HEIGHT = 720;
const ROTATIONS = [0, 90, 180, 270] as const;

type ZxDecodeHintType = import("@zxing/library").DecodeHintType;

type ZxingCanvasReader = {
  decodeFromCanvas?: (
    canvas: HTMLCanvasElement,
  ) => Promise<{ getText(): string }>;
  decodeFromCanvasElement?: (
    canvas: HTMLCanvasElement,
  ) => Promise<{ getText(): string }>;
  reset?: () => void;
};

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

function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: number,
  scratch?: HTMLCanvasElement,
): HTMLCanvasElement {
  if (degrees === 0) return source;
  // Reuse the caller's scratch canvas when provided — the live decode loop
  // runs every DETECT_INTERVAL_MS and allocating a fresh ~1MP canvas per
  // rotation per tick was a measurable CPU/GC burn (overheating phones).
  const canvas = scratch ?? document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const w = source.width;
  const h = source.height;
  if (degrees === 90 || degrees === 270) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2);
  return canvas;
}

async function tryDecodeCanvas(
  reader: ZxingCanvasReader,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const decode = reader.decodeFromCanvas ?? reader.decodeFromCanvasElement;
  if (!decode) return null;
  try {
    const result = await decode.call(reader, canvas);
    const raw = result.getText().trim();
    return raw || null;
  } catch {
    return null;
  }
}

async function decodeBarcodeFromCanvas(
  reader: ZxingCanvasReader,
  sourceCanvas: HTMLCanvasElement,
  opts?: { rotations?: readonly number[]; scratch?: HTMLCanvasElement },
): Promise<string | null> {
  const rotations = opts?.rotations ?? ROTATIONS;
  for (const degrees of rotations) {
    const canvas =
      degrees === 0 ? sourceCanvas : rotateCanvas(sourceCanvas, degrees, opts?.scratch);
    const code = await tryDecodeCanvas(reader, canvas);
    if (code) return code;
  }
  return null;
}

function captureVideoFrame(
  video: HTMLVideoElement,
  reusable?: HTMLCanvasElement,
): HTMLCanvasElement | null {
  // Reuse one canvas across ticks — the decode loop fires every
  // DETECT_INTERVAL_MS and a fresh 1280x720 allocation per tick churned
  // ~4MB of bitmap through the GC several times a second.
  const canvas = reusable ?? document.createElement("canvas");
  const w = video.videoWidth || VIDEO_IDEAL_WIDTH;
  const h = video.videoHeight || VIDEO_IDEAL_HEIGHT;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image file."));
    };
    img.src = objectUrl;
  });
}

type NativeBarcodeDetector = {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string; format?: string }>>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

type ScannerEngine = "native" | "zxing" | "unsupported";

type CameraFailureKind =
  | "permission_denied"
  | "no_camera_found"
  | "in_use"
  | "constraints"
  | "insecure_context"
  | "unknown";

function categorizeCameraError(err: unknown): CameraFailureKind {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "permission_denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no_camera_found";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "in_use";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "constraints";
  }
  if (name === "SecurityError") return "insecure_context";
  return "unknown";
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
}

function permissionDeniedMessage(): string {
  if (isIos()) {
    return (
      "Camera access was denied. To re-enable: open iOS Settings → Safari → " +
      "Camera → Allow, then reload this page. (iOS doesn't show the prompt " +
      "again once denied.)"
    );
  }
  return (
    "Camera access was denied. Open the site settings in your browser, " +
    "allow Camera access, and reload this page."
  );
}

function cameraFailureMessage(kind: CameraFailureKind): string {
  switch (kind) {
    case "permission_denied":
      return permissionDeniedMessage();
    case "no_camera_found":
      return "No camera found on this device. Enter codes manually below.";
    case "in_use":
      return "Camera is in use by another app or tab. Close other camera apps and reload.";
    case "constraints":
      return "Camera couldn't start with the requested settings. Reload to retry.";
    case "insecure_context":
      return "Camera requires a secure (HTTPS) connection. Reload over HTTPS.";
    default:
      return "Camera unavailable. Please enter codes manually below.";
  }
}

function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

function hasCameraSupport(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

async function applyAutofocusEnhancements(
  track: MediaStreamTrack,
): Promise<void> {
  try {
    const getCaps = (track as { getCapabilities?: () => MediaTrackCapabilities }).getCapabilities;
    if (typeof getCaps !== "function") return;
    const caps = getCaps.call(track) as MediaTrackCapabilities & {
      focusMode?: string[];
      exposureMode?: string[];
      whiteBalanceMode?: string[];
    };
    const advanced: Array<Record<string, unknown>> = [];
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    }
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) {
      advanced.push({ exposureMode: "continuous" });
    }
    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) {
      advanced.push({ whiteBalanceMode: "continuous" });
    }
    if (advanced.length === 0) return;
    await track.applyConstraints({ advanced } as MediaTrackConstraints);
  } catch (err) {
    console.warn("[BarcodeScanner] continuous-focus apply failed (continuing without)", err);
  }
}

export function BarcodeScanner({
  onScan,
  active,
  onPhotoCapture,
  hideManualInput = false,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zxingReaderRef = useRef<ZxingCanvasReader | null>(null);
  const zxingResetRef = useRef<(() => void) | null>(null);
  const barcodePhotoInputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef(0);
  const lastZxingScanRef = useRef<{ code: string; at: number } | null>(null);
  // Reused across decode ticks so the loop doesn't allocate fresh ~1MP
  // canvases several times a second (GC churn → heat on iPhone).
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotateScratchRef = useRef<HTMLCanvasElement | null>(null);
  const tickCountRef = useRef(0);
  // Pause the camera + decode loop whenever the page itself is hidden
  // (app backgrounded, tab switched) — scanning a screen nobody can see
  // just burns battery.
  const [pageVisible, setPageVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  const [scanning, setScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [engine, setEngine] = useState<ScannerEngine>("unsupported");
  const [showTroubleHint, setShowTroubleHint] = useState(false);
  const [barcodePhotoBusy, setBarcodePhotoBusy] = useState(false);
  const [barcodePhotoError, setBarcodePhotoError] = useState<string | null>(null);
  const troubleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSuccessfulScan = useCallback(
    (code: string) => {
      setShowTroubleHint(false);
      setBarcodePhotoError(null);
      if (troubleTimerRef.current) {
        clearTimeout(troubleTimerRef.current);
        troubleTimerRef.current = setTimeout(
          () => setShowTroubleHint(true),
          TROUBLE_HINT_MS,
        );
      }
      onScan(code);
    },
    [onScan],
  );

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
          setPermissionError(cameraFailureMessage(categorizeCameraError(error)));
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
    zxingReaderRef.current = null;
    zxingResetRef.current?.();
    zxingResetRef.current = null;
    setScanning(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!active || !pageVisible || engine === "unsupported") {
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
            video: {
              facingMode: "environment",
              width: { ideal: VIDEO_IDEAL_WIDTH },
              height: { ideal: VIDEO_IDEAL_HEIGHT },
            },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const track = stream.getVideoTracks()[0];
          if (track) {
            void applyAutofocusEnhancements(track);
          }
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
                  handleSuccessfulScan(raw);
                }
              }
            } catch {
              /* ignore frame errors */
            }
          }, DETECT_INTERVAL_MS);
        } catch (error) {
          reportCameraError(error);
          setPermissionError(cameraFailureMessage(categorizeCameraError(error)));
          stopCamera();
        }
        return;
      }

      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const v = videoRef.current;
        if (!v) {
          setPermissionError(cameraFailureMessage("unknown"));
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: VIDEO_IDEAL_WIDTH },
            height: { ideal: VIDEO_IDEAL_HEIGHT },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const zxTrack = stream.getVideoTracks()[0];
        if (zxTrack) {
          void applyAutofocusEnhancements(zxTrack);
        }
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }

        let reader: InstanceType<typeof BrowserMultiFormatReader>;
        try {
          const hints = await buildZxingDecodeHints();
          reader = hints
            ? new BrowserMultiFormatReader(hints, { delayBetweenScanSuccess: 200 })
            : new BrowserMultiFormatReader(undefined, { delayBetweenScanSuccess: 200 });
        } catch (hintErr) {
          console.warn("[BarcodeScanner] ZXing decode hints failed; using default reader", hintErr);
          reportCameraError(hintErr);
          reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanSuccess: 200 });
        }

        zxingReaderRef.current = reader as unknown as ZxingCanvasReader;
        zxingResetRef.current = () => {
          (reader as unknown as { reset?: () => void }).reset?.();
        };

        setScanning(true);

        timerRef.current = setInterval(() => {
          void (async () => {
            const vid = videoRef.current;
            const zxReader = zxingReaderRef.current;
            if (!vid || !zxReader || vid.readyState < 2) return;
            const now = Date.now();
            if (now - lastScanRef.current < COOLDOWN_MS) return;

            if (!frameCanvasRef.current) {
              frameCanvasRef.current = document.createElement("canvas");
            }
            const canvas = captureVideoFrame(vid, frameCanvasRef.current);
            if (!canvas) return;

            // Any-angle support without the constant burn: try the upright
            // frame every tick, the full 90/180/270 sweep every 3rd tick.
            // A rotated barcode still reads within ~660ms (well under the
            // 2s scan cooldown); idle CPU drops ~4x.
            tickCountRef.current += 1;
            const fullSweep = tickCountRef.current % 3 === 0;
            if (!rotateScratchRef.current) {
              rotateScratchRef.current = document.createElement("canvas");
            }
            const raw = await decodeBarcodeFromCanvas(zxReader, canvas, {
              rotations: fullSweep ? ROTATIONS : [0],
              scratch: rotateScratchRef.current,
            });
            if (!raw) return;

            const prev = lastZxingScanRef.current;
            if (prev && prev.code === raw && now - prev.at < ZXING_COOLDOWN_MS) return;
            lastZxingScanRef.current = { code: raw, at: now };
            lastScanRef.current = now;
            handleSuccessfulScan(raw);
          })();
        }, DETECT_INTERVAL_MS);
      } catch (error) {
        reportCameraError(error);
        setPermissionError(cameraFailureMessage(categorizeCameraError(error)));
        stopCamera();
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [active, pageVisible, engine, handleSuccessfulScan, reportCameraError, stopCamera]);

  useEffect(() => {
    if (troubleTimerRef.current) {
      clearTimeout(troubleTimerRef.current);
      troubleTimerRef.current = null;
    }
    if (!scanning) {
      setShowTroubleHint(false);
      return;
    }
    troubleTimerRef.current = setTimeout(
      () => setShowTroubleHint(true),
      TROUBLE_HINT_MS,
    );
    return () => {
      if (troubleTimerRef.current) {
        clearTimeout(troubleTimerRef.current);
        troubleTimerRef.current = null;
      }
    };
  }, [scanning]);

  const submitManual = () => {
    const c = manualCode.trim();
    if (c) {
      onScan(c);
      setManualCode("");
    }
  };

  const handlePhotoTap = () => {
    if (!onPhotoCapture) return;
    const vid = videoRef.current;
    if (!vid || vid.readyState < 2) {
      console.warn("[BarcodeScanner] cannot capture — video not ready");
      return;
    }
    try {
      const canvas = captureVideoFrame(vid);
      if (!canvas) return;
      const dataUri = canvas.toDataURL("image/jpeg", 0.85);
      void onPhotoCapture(dataUri);
    } catch (err) {
      console.warn("[BarcodeScanner] frame capture failed", err);
    }
  };

  const handleBarcodePhotoFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      setBarcodePhotoError("Please choose a photo that includes the barcode.");
      return;
    }
    setBarcodePhotoBusy(true);
    setBarcodePhotoError(null);
    try {
      const img = await loadImageFile(file);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setBarcodePhotoError("Couldn't process that photo.");
        return;
      }
      ctx.drawImage(img, 0, 0);

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      let reader: InstanceType<typeof BrowserMultiFormatReader>;
      try {
        const hints = await buildZxingDecodeHints();
        reader = hints
          ? new BrowserMultiFormatReader(hints)
          : new BrowserMultiFormatReader();
      } catch {
        reader = new BrowserMultiFormatReader();
      }

      const code = await decodeBarcodeFromCanvas(
        reader as unknown as ZxingCanvasReader,
        canvas,
      );
      if (code) {
        handleSuccessfulScan(code);
      } else {
        setBarcodePhotoError(
          "Couldn't read a barcode in that photo — try getting closer or use \"Take a photo of the bottle\" instead.",
        );
      }
    } catch (err) {
      console.warn("[BarcodeScanner] barcode photo decode failed", err);
      setBarcodePhotoError(
        "Couldn't read a barcode in that photo — try getting closer or use \"Take a photo of the bottle\" instead.",
      );
    } finally {
      setBarcodePhotoBusy(false);
    }
  };

  const photoFallbackButtons = (
    <div className="scanner-photo-actions">
      {onPhotoCapture ? (
        <button
          type="button"
          className="scanner-photo-compact-btn"
          onClick={handlePhotoTap}
          aria-label="Take a photo to identify the bottle"
        >
          <IconCamera size={18} strokeWidth={1.9} aria-hidden />
          Take a photo of the bottle
        </button>
      ) : null}
      <button
        type="button"
        className="scanner-photo-compact-btn scanner-photo-compact-btn--secondary"
        onClick={() => barcodePhotoInputRef.current?.click()}
        disabled={barcodePhotoBusy}
        aria-label="Scan barcode from a photo"
      >
        <IconFileText size={18} strokeWidth={1.9} aria-hidden />
        {barcodePhotoBusy ? "Reading barcode…" : "Scan barcode from photo"}
      </button>
    </div>
  );

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
              <div className="scanner-aim-rect" aria-hidden>
                <span className="scanner-aim-corner scanner-aim-corner--tl" />
                <span className="scanner-aim-corner scanner-aim-corner--tr" />
                <span className="scanner-aim-corner scanner-aim-corner--bl" />
                <span className="scanner-aim-corner scanner-aim-corner--br" />
              </div>
            ) : null}
            {scanning ? (
              <div className="scanner-overlay">
                <span className="scanner-pulse" />
                <span>Scanning…</span>
              </div>
            ) : null}
          </div>
          <p className="muted small">
            {engine === "native" ? "Using native scanner" : "Using ZXing fallback"}
          </p>

          <input
            ref={barcodePhotoInputRef}
            type="file"
            accept="image/*"
            className="scanner-file-input"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              void handleBarcodePhotoFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {hideManualInput ? photoFallbackButtons : null}

          {barcodePhotoError ? (
            <p className="scanner-photo-error banner banner-warn" role="alert">
              {barcodePhotoError}
            </p>
          ) : null}

          {!hideManualInput && showTroubleHint ? (
            <div className="scanner-trouble" role="status">
              <strong>Can&apos;t read the barcode?</strong>
              <p className="muted small">
                Try moving the bottle closer, better light, or hold steady.
                Plastic shots and curved labels can be tricky.
              </p>
              <div className="scanner-trouble-actions">
                {onPhotoCapture ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handlePhotoTap}
                  >
                    <IconCamera size={16} strokeWidth={1.9} aria-hidden />
                    Take a photo
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => barcodePhotoInputRef.current?.click()}
                  disabled={barcodePhotoBusy}
                >
                  <IconFileText size={16} strokeWidth={1.9} aria-hidden />
                  Scan from photo
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    const el = document.querySelector<HTMLInputElement>(".scanner-manual-input");
                    el?.focus();
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  Type code instead
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {engine === "unsupported" ? (
        <p className="scanner-fallback-title">Camera not available on this browser — enter codes manually</p>
      ) : null}
      {hideManualInput ? null : (
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
      )}
    </section>
  );
}
