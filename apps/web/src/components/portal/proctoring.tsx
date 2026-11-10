import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { publicApi } from '@/lib/api';
import { cx } from '../ui';

export type ProctorEventType =
  | 'tab_hidden'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'copy'
  | 'paste'
  | 'right_click'
  | 'camera_denied'
  | 'camera_off'
  | 'multiple_displays';

const WARNING: Partial<Record<ProctorEventType, string>> = {
  tab_hidden: 'You left the test window. Switching tabs is recorded.',
  window_blur: 'The test window lost focus. Please stay on this page.',
  fullscreen_exit: 'You exited full-screen mode. Please return to full-screen.',
  paste: 'Pasting is not allowed and has been recorded.',
  copy: 'Copying is not allowed.',
  camera_off: 'Your camera stopped. Please keep your camera on.',
};

/**
 * Captures browser integrity signals and posts them in batches to `/<base>/proctor`.
 * `base` example: `/assessment/<token>` or `/interview/<token>`.
 */
export function useProctoring(base: string, enabled: boolean) {
  const queue = useRef<{ type: ProctorEventType; details?: Record<string, unknown>; at: string }[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [violations, setViolations] = useState(0);
  const lastBlur = useRef(0);

  const record = useCallback(
    (type: ProctorEventType, details?: Record<string, unknown>) => {
      if (!enabled) return;
      queue.current.push({ type, details, at: new Date().toISOString() });
      if (WARNING[type]) {
        setWarning(WARNING[type]!);
        setViolations((v) => v + 1);
      }
    },
    [enabled],
  );

  const flush = useCallback(async () => {
    if (!queue.current.length) return;
    const events = queue.current.splice(0, queue.current.length);
    try {
      await publicApi.post(`${base}/proctor`, { events });
    } catch {
      queue.current.unshift(...events); // retry next tick
    }
  }, [base]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => document.visibilityState === 'hidden' && record('tab_hidden');
    const onBlur = () => {
      // avoid double-counting blur immediately followed by visibilitychange
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastBlur.current > 2000) record('window_blur');
      lastBlur.current = now;
    };
    const onFs = () => !document.fullscreenElement && record('fullscreen_exit');
    const onCopy = () => record('copy');
    const onPaste = () => record('paste');
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      record('right_click');
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('contextmenu', onCtx);

    // Multiple displays (Chromium only)
    const scr = window.screen as Screen & { isExtended?: boolean };
    if (scr.isExtended) record('multiple_displays');

    const timer = setInterval(() => void flush(), 5000);
    const onUnload = () => {
      if (!queue.current.length) return;
      const url = `${(import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/public${base}/proctor`;
      try {
        navigator.sendBeacon?.(url, new Blob([JSON.stringify({ events: queue.current })], { type: 'application/json' }));
      } catch {
        /* best effort */
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('pagehide', onUnload);
      clearInterval(timer);
      void flush();
    };
  }, [enabled, record, flush, base]);

  return { record, flush, warning, dismissWarning: () => setWarning(null), violations };
}

export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    /* not supported / denied */
  }
}

export async function exitFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

/** Camera stream management. Returns the stream + status. */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'on' | 'denied' | 'off'>('idle');
  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('denied');
      return null;
    }
    setStatus('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      setStream(s);
      setStatus('on');
      return s;
    } catch {
      setStatus('denied');
      return null;
    }
  }, []);
  useEffect(() => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    const onEnd = () => setStatus('off');
    track?.addEventListener('ended', onEnd);
    return () => track?.removeEventListener('ended', onEnd);
  }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  return { stream, status, request };
}

export function CameraPreview({ stream, status, className }: { stream: MediaStream | null; status: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={cx('relative overflow-hidden rounded-xl bg-zinc-900', className)}>
      {stream && status === 'on' ? (
        <video ref={ref} autoPlay muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-zinc-400">
          {status === 'requesting' ? <Camera className="size-5 animate-pulse" /> : <CameraOff className="size-5" />}
          {status === 'requesting' ? 'Requesting camera…' : 'Camera off'}
        </div>
      )}
      {status === 'on' && (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-red-500" /> Live
        </span>
      )}
    </div>
  );
}

/** Dismissible violation banner */
export function ProctorWarning({ message, onDismiss, onFullscreen }: { message: string | null; onDismiss: () => void; onFullscreen?: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div className="flex max-w-xl items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
        <span className="flex-1">{message}</span>
        {onFullscreen && !document.fullscreenElement && (
          <button className="cursor-pointer font-medium underline" onClick={onFullscreen}>
            Return to full-screen
          </button>
        )}
        <button className="cursor-pointer font-medium" onClick={onDismiss}>
          OK
        </button>
      </div>
    </div>
  );
}

/** mm:ss / h:mm:ss */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Countdown to `deadline` corrected by server clock offset (serverTime - local time at fetch). */
export function useCountdown(deadline: string | null | undefined, offsetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  return new Date(deadline).getTime() - (now + offsetMs);
}
