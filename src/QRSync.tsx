/**
 * QRSync - Transfer LifeTrack data from desktop to mobile via QR code.
 * No cloud, no account, no internet required.
 */
/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { exportAllData } from "./store";

interface QRSyncProps {
  open: boolean;
  onClose: () => void;
}

async function buildQr(compress: boolean): Promise<string> {
  const json = JSON.stringify(exportAllData());
  let payload = json;
  if (compress && json.length > 3500) {
    const data = JSON.parse(json) as { checkIns: { date: string }[] };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    data.checkIns = data.checkIns.filter((ci) => ci.date >= cutoffStr);
    payload = JSON.stringify(data);
  }
  return QRCode.toDataURL(payload, {
    width: 400,
    margin: 2,
    color: { dark: "#1f2937", light: "#ffffff" },
    errorCorrectionLevel: "L",
  });
}

export default function QRSync({ open, onClose }: QRSyncProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    buildQr(true)
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "QR generation failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const handleClose = useCallback(() => {
    setQrDataUrl(null);
    setError(null);
    setCopied(false);
    onClose();
  }, [onClose]);

  const handleRegenerate = useCallback(() => {
    setLoading(true);
    setError(null);
    setQrDataUrl(null);
    buildQr(false)
      .then((url) => setQrDataUrl(url))
      .catch((e) => setError(e instanceof Error ? e.message : "QR generation failed"))
      .finally(() => setLoading(false));
  }, []);

  const handleCopyPayload = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportAllData()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError("Clipboard not available"); }
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") handleClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sync to Mobile</h2>
          <button className="btn-icon modal-close" onClick={handleClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="qr-body">
          <p className="qr-instruction">
            Scan this QR code with LifeTrack on your Android device to transfer all your data.
            <strong> No cloud, no account, no internet.</strong>
          </p>
          {error && <div className="qr-error">{error}</div>}
          {loading ? (
            <div className="qr-loading">Generating QR code...</div>
          ) : qrDataUrl ? (
            <div className="qr-code-wrapper">
              <img src={qrDataUrl} alt="QR code for mobile sync" className="qr-code-img" />
              <button className="btn-qr-regenerate" onClick={handleRegenerate}>Regenerate</button>
            </div>
          ) : null}
          <div className="qr-actions">
            <button className="btn-secondary" onClick={handleCopyPayload}>
              {copied ? "Copied!" : "Copy JSON"}
            </button>
            <span className="qr-hint">Or use Export then Export JSON for file download.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
