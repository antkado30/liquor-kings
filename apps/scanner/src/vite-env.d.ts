/// <reference types="vite/client" />

/** Experimental BarcodeDetector (Chromium). */
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: typeof BarcodeDetector;
  }
}

export {};
