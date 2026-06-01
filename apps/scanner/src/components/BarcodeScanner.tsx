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
/*
  Time (ms) of continuous scanning with no successful read before we
  show the "trouble scanning?" hint. Tuned to feel natural: under 5s
  is too aggressive (interrupts during normal aim), >12s is too late
  (user already gave up). 8s is the sweet spot we landed on based on
  Tony's 23-min Captain Morgan plastic-shot failure 2026-06-01.
*/
const TROUBLE_HINT_MS = 8000;

/*
  Tighter focusing window for the BarcodeDetector. Higher resolution
  means more pixels per barcode, which dramatically improves recognition
  of small/curved labels (50ml shots, pints). 1280×720 is the iPhone
  rear-cam default sweet spot — bigger and the frame analysis slows
  down without giving the decoder more info.
*/
const VIDEO_IDEAL_WIDTH = 1280;
const VIDEO_IDEAL_HEIGHT = 720;

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

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

type ScannerEngine = "native" | "zxing" | "unsupported";

/**
 * Categorize getUserMedia failure modes so we can render a helpful
 * device-specific message instead of "Camera unavailable" for everything.
 *
 * Refs:
 *   https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
 *
 * iOS Safari specifically throws NotAllowedError when the user previously
 * tapped "Don't Allow" — and the only way to re-enable is via Settings
 * (the in-page prompt won't re-appear). That UX is unintuitive enough
 * that we surface explicit instructions for it.
 */
type CameraFailureKind =
  | "permission_denied" // NotAllowedError — user actively denied
  | "no_camera_found" // NotFoundError / DevicesNotFoundError
  | "in_use" // NotReadableError — another app/tab has the camera
  | "constraints" // OverconstrainedError / ConstraintNotSatisfiedError
  | "insecure_context" // SecurityError / non-HTTPS
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
  // Modern iPads identify as Mac; detect the touch-on-Mac quirk.
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

/*
  Try to coax the active video track into continuous autofocus +
  whatever focal helpers the device exposes. This is the SINGLE LARGEST
  reliability improvement for handheld scanning of small/curved labels
  — without it, the camera locks focus where it was when the stream
  started and the user has to physically position the bottle at that
  distance. With it, focus follows the bottle as the user moves.

  We probe capabilities first and only request supported modes (passing
  unsupported modes throws OverconstrainedError on iOS Safari). Quiet
  failures are fine — the camera still works without continuous focus,
  just less well on small labels.
*/
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
    // Non-fatal — log and continue. The video stream is still usable
    // without continuous focus, just less reliable on small labels.
    console.warn("[BarcodeScanner] continuous-focus apply failed (continuing without)", err);
  }
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
  /*
    Becomes true if we've been scanning for TROUBLE_HINT_MS without a
    successful read. Drives the "Having trouble?" prompt with manual-
    entry / search shortcuts. Reset whenever a scan succeeds — see the
    handleScan wrapper below.
  */
  const [showTroubleHint, setShowTroubleHint] = useState(false);
  const troubleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
    Wrap the prop's onScan so we can reset the trouble-hint timer on
    every successful read. Without this, the hint would stay up forever
    after one bad scan, even after subsequent scans succeed.
  */
  const handleSuccessfulScan = useCallback(
    (code: string) => {
      setShowTroubleHint(false);
      if (troubleTimerRef.current) {
        clearTimeout(troubleTimerRef.current);
        // Restart the timer for the next scan attempt.
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

          /*
            Camera constraints upgrade (task #60, 2026-06-01). We request
            1280×720 (ideal) so the BarcodeDetector gets enough pixels
            per barcode to read curved/small labels on plastic shots.
            facingMode: "environment" stays — back camera. After the
            stream starts, applyAutofocusEnhancements probes the track's
            capabilities and turns on continuous focus / exposure /
            white-balance for whatever the device supports.
          */
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
        // Same higher-res + continuous-focus pass as the native path
        // (task #60). ZXing benefits from the larger frame too.
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
          handleSuccessfulScan(raw);
        });
        zxingControlsRef.current = controls;
        setScanning(true);
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
  }, [active, engine, onScan, reportCameraError, stopCamera]);

  /*
    Trouble-hint timer (task #60, 2026-06-01). When scanning starts,
    arm a TROUBLE_HINT_MS timer. If the user successfully scans before
    it fires, handleSuccessfulScan resets it. If it fires, we render
    the "Having trouble?" prompt below the video to surface manual
    entry / search. This is the soft fallback before #37 ships.
  */
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

  return (
    <section className="scanner-panel">
      {permissionError ? (
        <p className="scanner-permission-msg">{permissionError}</p>
      ) : null}
      {active && engine !== "unsupported" && !permissionError ? (
        <>
          <div className="scanner-video-wrap">
            <video ref={videoRef} className="scanner-video" playsInline muted />
            {/*
              Visual aim rectangle (task #60). Gives the user a clear
              "point here" target instead of a blank video frame. The
              dashed inner box matches the BarcodeDetector's sweet spot
              for label-sized barcodes. Pointer-events:none so it
              never blocks the manual-entry field below.
            */}
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
          <p className="muted small">{engine === "native" ? "Using native scanner" : "Using ZXing fallback"}</p>
          {/*
            Trouble-scanning prompt (task #60). Renders after
            TROUBLE_HINT_MS of unsuccessful scanning. Surfaces the
            highest-leverage fallback inline so the user doesn't have
            to remember the manual input field exists below. The
            "Type code instead" button focuses the manual input so
            the next tap puts the cursor where it needs to be.
          */}
          {showTroubleHint ? (
            <div className="scanner-trouble" role="status">
              <strong>Can&apos;t read the barcode?</strong>
              <p className="muted small">
                Try moving the bottle closer, better light, or hold steady.
                Plastic shots and curved labels can be tricky.
              </p>
              <div className="scanner-trouble-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    // Scroll/focus the manual entry input.
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
