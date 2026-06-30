/**
 * QRSync — Transfer LifeTrack data from desktop to mobile via QR code.
 *
 * The desktop generates a QR code containing the full JSON export.
 * The mobile app scans it with the camera to import.
 * No cloud, no account, no internet required.
 *
 * Differentiation: no other habit tracker offers local-first QR transfer.
 */

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { exportAllData } from './store';

interface QRSyncProps {
  open: boolean;
  onClose: () => void;
}

export default function QRSync({ open, onClose }: QRSyncProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    try {
      setError(null);
      const json = JSON.stringify(exportAllData());
      // QR codes have a practical limit of ~4KB of data.
      // If the JSON is too large, compress by removing check-ins older than 90 days.
      let payload = json;
      if (json.length > 3500) {
        const data = JSON.parse(json);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        data.checkIns = data.checkIns.filter(
          (ci: { date: string }) => ci.date >= cutoffStr,
        );
        payload = JSON.stringify(data);
      }

      const dataUrl = await QRCode.toDataURL(payload, {
        width: 400,
        margin: 2,
        color: {
          dark: '#1f2937',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'L',
      });
      setQrDataUrl(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QR generation failed');
    }
  }, []);

  useEffect(() => {
    if (open) {
      generate();
    } else {
      setQrDataUrl(null);
      setError(null);
      setCopied(false);
    }
  }, [open, generate]);

  const handleCopyPayload = useCallback(async () => {
    try {
      const json = JSON.stringify(exportAllData());
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard not available');
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sync to Mobile</h2>
          <button className="btn-icon modal-close" onClick={onClose} aria-label="Close">
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

          {qrDataUrl ? (
            <div className="qr-code-wrapper">
              <img
                src={qrDataUrl}
                alt="QR code for mobile sync"
                className="qr-code-img"
              />
              <button className="btn-qr-regenerate" onClick={generate}>
                Regenerate
              </button>
            </div>
          ) : (
            <div className="qr-loading">Generating QR code…</div>
          )}

          <div className="qr-actions">
            <button className="btn-secondary" onClick={handleCopyPayload}>
              {copied ? '✓ Copied!' : 'Copy JSON'}
            </button>
            <span className="qr-hint">
              Or use Export → Export JSON for file download.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
