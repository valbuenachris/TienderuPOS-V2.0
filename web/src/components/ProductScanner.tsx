import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Notice } from '../components/ui';

type ScannerMode = 'barcode' | 'qr';

export interface ScannerResult {
  ok: boolean;
  message: string;
}

interface ProductScannerProps {
  open: boolean;
  mode: ScannerMode;
  onClose: () => void;
  onScan: (rawValue: string) => Promise<ScannerResult>;
}

interface Html5QrcodeInstance {
  start: (
    camera: { facingMode: string },
    config: unknown,
    onSuccess: (decodedText: string) => void,
    onFailure: () => void
  ) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  getRunningTrackCapabilities: () => MediaTrackCapabilities & { torch?: boolean };
  applyVideoConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
}

function friendlyCameraError(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Permiso de cámara denegado. Habilítalo en la configuración del navegador e inténtalo de nuevo.';
    case 'NotFoundError':
      return 'No se encontró una cámara en este dispositivo. Usa la entrada manual.';
    case 'NotReadableError':
      return 'La cámara está siendo usada por otra aplicación.';
    case 'OverconstrainedError':
      return 'La cámara disponible no soporta la configuración solicitada. Usa la entrada manual.';
    default:
      return 'No fue posible iniciar la cámara. Usa la entrada manual.';
  }
}

function playBeep(): void {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => {
      void context.close();
    };
  } catch (_error: unknown) {
    // Optional feedback; ignore audio failures.
  }
}

export default function ProductScanner({ open, mode, onClose, onScan }: ProductScannerProps) {
  const elementId = useMemo(() => `html5qr-${Math.random().toString(36).slice(2, 10)}`, []);
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const continuousRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  const [continuous, setContinuous] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<'ok' | 'error' | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualCode, setManualCode] = useState('');

  onScanRef.current = onScan;
  onCloseRef.current = onClose;
  continuousRef.current = continuous;

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setError('');
    setMessage('');
    setFeedback(null);
    setReady(false);
    setTorchAvailable(false);
    setTorchOn(false);
    setScanCount(0);

    void (async () => {
      try {
        if (!window.isSecureContext) {
          setError('La cámara requiere HTTPS. Abre el POS con una conexión segura o usa la entrada manual.');
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Este dispositivo o navegador no soporta cámara. Usa la entrada manual.');
          return;
        }
        const mod = await import('html5-qrcode');
        if (disposed) return;
        const formats = mode === 'qr'
          ? [mod.Html5QrcodeSupportedFormats.QR_CODE]
          : [
              mod.Html5QrcodeSupportedFormats.EAN_13,
              mod.Html5QrcodeSupportedFormats.EAN_8,
              mod.Html5QrcodeSupportedFormats.UPC_A,
              mod.Html5QrcodeSupportedFormats.UPC_E,
              mod.Html5QrcodeSupportedFormats.CODE_128,
              mod.Html5QrcodeSupportedFormats.CODE_39,
              mod.Html5QrcodeSupportedFormats.ITF,
              mod.Html5QrcodeSupportedFormats.CODABAR
            ];
        const scanner = new mod.Html5Qrcode(elementId, { formatsToSupport: formats, verbose: false }) as unknown as Html5QrcodeInstance;
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (viewWidth: number, viewHeight: number) => mode === 'qr'
              ? { width: Math.min(viewWidth, viewHeight) * 0.7, height: Math.min(viewWidth, viewHeight) * 0.7 }
              : { width: viewWidth * 0.85, height: Math.min(viewHeight * 0.4, 160) }
          },
          (decodedText: string) => { void handleDecoded(decodedText); },
          () => undefined
        );
        if (disposed) {
          await scanner.stop().catch(() => undefined);
          scanner.clear();
          return;
        }
        setReady(true);
        const capabilities = scanner.getRunningTrackCapabilities();
        setTorchAvailable(Boolean(capabilities.torch));
      } catch (startError: unknown) {
        if (!disposed) setError(friendlyCameraError(startError));
      }
    })();

    return () => {
      disposed = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      setReady(false);
      setTorchAvailable(false);
      setTorchOn(false);
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => undefined);
      }
    };
  }, [open, mode, elementId]);

  async function handleDecoded(rawValue: string): Promise<void> {
    const value = rawValue.trim();
    if (!value) return;
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.value === value && now - last.at < 2000) return;
    lastScanRef.current = { value, at: now };
    try {
      navigator.vibrate?.(50);
    } catch (_error: unknown) {
      // Haptics optional.
    }

    setFeedback(null);
    setMessage('');
    const result = await onScanRef.current(value);
    setFeedback(result.ok ? 'ok' : 'error');
    setMessage(result.message);
    if (result.ok) {
      playBeep();
      setScanCount((count) => count + 1);
      if (!continuousRef.current) {
        window.setTimeout(() => onCloseRef.current(), 650);
      }
    }
  }

  async function toggleTorch(): Promise<void> {
    const scanner = scannerRef.current;
    if (!scanner) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch (_error: unknown) {
      setError('No fue posible cambiar la linterna en esta cámara.');
    }
  }

  return (
    <Modal
      open={open}
      eyebrow="SCANNER"
      title={mode === 'qr' ? 'Escanear código QR' : 'Escanear código de barras'}
      className="scanner-modal"
      onClose={onClose}
    >
      <div className="stack">
        <div className="scanner-view">
          <div id={elementId} className="scanner-video" />
          {ready ? (
            <>
              <div className="scanner-frame" aria-hidden />
              <div className="scanner-laser" aria-hidden />
            </>
          ) : null}
          {feedback ? <div className={`scanner-feedback ${feedback}`} aria-hidden /> : null}
          {!ready && !error ? <div className="scanner-placeholder">Iniciando cámara…</div> : null}
        </div>

        <p className="muted">
          Apunte el código {mode === 'qr' ? 'QR' : 'de barras'} hacia la cámara. También puede ingresarlo manualmente.
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? <Notice tone={feedback === 'error' ? 'error' : 'success'}>{message}</Notice> : null}

        <div className="scanner-controls">
          <label className="checkbox-label">
            <input type="checkbox" checked={continuous} onChange={(event) => setContinuous(event.target.checked)} />
            Escaneo continuo
          </label>
          {torchAvailable ? (
            <button className="quiet" type="button" onClick={() => { void toggleTorch(); }}>
              {torchOn ? '🔦 Linterna activada' : '🔦 Linterna'}
            </button>
          ) : null}
          {continuous ? <span className="scanner-count">Escaneados: {scanCount}</span> : null}
        </div>

        <form
          className="scanner-manual"
          onSubmit={(event) => {
            event.preventDefault();
            const value = manualCode.trim();
            if (!value) return;
            void handleDecoded(value);
            setManualCode('');
          }}
        >
          <input
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder="O ingrese el código manualmente"
            maxLength={120}
          />
          <button className="primary" type="submit" disabled={!manualCode.trim()}>Agregar</button>
        </form>
      </div>
    </Modal>
  );
}
