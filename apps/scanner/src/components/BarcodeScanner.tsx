/**
 * Barcodes on bottles are UPCs. Barcodes on MLCC shelf tags are MLCC codes (numeric, 3–5 digits).
 * Both are handled by getProductByCode in api/catalog.ts, which resolves MLCC code first then UPC fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type BarcodeScannerProps = {
  onScan: (code: string) => void;
  active: boolean;
};

const COOLDOWN_MS = 2000;
const DETECT_INTERVAL_MS = 220;

type NativeBarcodeDetector = {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string; format?: string }>>;
};

function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

export function BarcodeScanner({ onScan, active }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScanRef = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const native = hasNativeBarcodeDetector();

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    detectorRef.current = null;
    setScanning(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!active || !native) return;

    let cancelled = false;

    async function start() {
      setPermissionError(null);
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
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setPermissionError("Camera permission denied. Enter the MLCC code manually below.");
        } else {
          setPermissionError("Could not start camera. Enter the MLCC code manually below.");
        }
        stopCamera();
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [active, native, onScan, stopCamera]);

  const submitManual = () => {
    const c = manualCode.trim();
    if (c) {
      onScan(c);
      setManualCode("");
    }
  };

  if (!native) {
    return (
      <section className="scanner-panel">
        <p className="scanner-fallback-title">Camera not supported — enter code manually</p>
        <p className="muted small">
          This browser does not expose{" "}
          <code>BarcodeDetector</code>. Type or paste the shelf tag code.
        </p>
        <div className="scanner-manual">
          <input
            className="scanner-manual-input"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="MLCC code"
            enterKeyHint="done"
          />
          <button type="button" className="btn primary" onClick={submitManual}>
            Use code
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="scanner-panel">
      {permissionError ? (
        <p className="scanner-permission-msg">{permissionError}</p>
      ) : null}
      {active && !permissionError ? (
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
        </>
      ) : null}
      <div className="scanner-manual">
        <label className="muted small">Or enter code manually</label>
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
