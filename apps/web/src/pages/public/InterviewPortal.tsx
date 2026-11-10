import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Bot, CheckCircle2, Clock, Hourglass, Lightbulb, Maximize, Mic, MicOff, RotateCw, Send, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, errorMessage, publicApi } from '@/lib/api';
import { PortalMessage, PortalShell } from '@/components/layout/PortalShell';
import { Button, PageLoader, Textarea, cx } from '@/components/ui';
import { CameraPreview, ProctorWarning, enterFullscreen, exitFullscreen, formatClock, useCamera, useCountdown, useProctoring } from '@/components/portal/proctoring';

interface Message {
  seq: number;
  role: 'interviewer' | 'candidate';
  content: string;
  createdAt?: string;
}

interface InterviewState {
  status: 'pending' | 'invited' | 'scheduled' | 'in_progress' | 'completed' | 'evaluated' | 'cancelled' | 'expired' | 'no_show';
  candidateName: string;
  jobTitle: string;
  roundName: string;
  kind: 'ai_screening' | 'ai_proctored' | 'human';
  durationMin: number;
  questionCount: number;
  proctored: boolean;
  companyName: string;
  startedAt: string | null;
  deadlineAt: string | null;
  serverTime: string;
  messages: Message[];
}

/* ---- Web Speech API (optional voice dictation) ---- */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = false;
  r.lang = navigator.language || 'en-US';
  return r;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

export default function InterviewPortal() {
  const { token } = useParams<{ token: string }>();
  const base = `/interview/${token}`;
  const [state, setState] = useState<InterviewState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [offset, setOffset] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // content that failed to send
  const [inSession, setInSession] = useState(false);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const recog = useRef<SpeechRecognitionLike | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const speechSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const proctored = !!state?.proctored;
  const camera = useCamera();
  const proctor = useProctoring(base, proctored && inSession && !done);

  const apply = useCallback((s: InterviewState) => {
    setState(s);
    setOffset(new Date(s.serverTime).getTime() - Date.now());
    setMessages(s.messages ?? []);
  }, []);

  useEffect(() => {
    publicApi.get<InterviewState>(base).then(apply).catch(setLoadError);
  }, [base, apply]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  useEffect(() => {
    if (!inSession || !proctored) return;
    if (camera.status === 'denied') proctor.record('camera_denied');
    if (camera.status === 'off') proctor.record('camera_off');
  }, [camera.status, inSession, proctored]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => {
    setDone(true);
    void proctor.flush();
    camera.stream?.getTracks().forEach((t) => t.stop());
    recog.current?.stop();
    void exitFullscreen();
  }, [proctor, camera.stream]);

  async function begin() {
    setStarting(true);
    try {
      if (proctored) {
        await enterFullscreen();
        if (camera.status !== 'on') await camera.request();
      }
      const res = await publicApi.post<{ messages: Message[]; done: boolean }>(`${base}/start`);
      setMessages(res.messages);
      const fresh = await publicApi.get<InterviewState>(base).catch(() => null);
      if (fresh) {
        setState(fresh);
        setOffset(new Date(fresh.serverTime).getTime() - Date.now());
      }
      setInSession(true);
      if (res.done) finish();
    } catch (err) {
      toast.error(err instanceof ApiError && err.status >= 502 ? 'Our AI interviewer is busy. Please try again in a moment.' : errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || thinking) return;
    recog.current?.stop();
    setFailed(null);
    setDraft('');
    const optimistic: Message = { seq: (messages.at(-1)?.seq ?? 0) + 1, role: 'candidate', content: text };
    setMessages((m) => [...m, optimistic]);
    setThinking(true);
    try {
      const res = await publicApi.post<{ messages: Message[]; done: boolean }>(`${base}/answer`, { content: text });
      setMessages(res.messages);
      if (res.done) finish();
    } catch (err) {
      setMessages((m) => m.filter((x) => x !== optimistic));
      setFailed(text);
      setDraft(text);
      if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
        const s = await publicApi.get<InterviewState>(base).catch(() => null);
        if (s && ['completed', 'evaluated', 'expired'].includes(s.status)) {
          apply(s);
          finish();
          return;
        }
      }
      toast.error(err instanceof ApiError && err.status >= 502 ? 'Connection to the AI interviewer was interrupted. Your answer is kept — please retry.' : errorMessage(err));
    } finally {
      setThinking(false);
    }
  }

  function toggleMic() {
    if (listening) {
      recog.current?.stop();
      return;
    }
    const r = getRecognition();
    if (!r) return;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text) setDraft((d) => (d ? `${d.trimEnd()} ${text.trim()}` : text.trim()));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recog.current = r;
    r.start();
    setListening(true);
  }

  const deadline = state?.deadlineAt ?? (state?.startedAt ? new Date(new Date(state.startedAt).getTime() + state.durationMin * 60_000).toISOString() : null);
  const remaining = useCountdown(deadline, offset);

  /* ---------------------------------------------------------------- states */
  if (loadError)
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This interview link is not valid">
          {errorMessage(loadError)}
        </PortalMessage>
      </PortalShell>
    );
  if (!state)
    return (
      <PortalShell>
        <PageLoader />
      </PortalShell>
    );
  if (done || state.status === 'completed' || state.status === 'evaluated')
    return (
      <PortalShell>
        <PortalMessage icon={<CheckCircle2 className="size-6" />} title="Interview complete — thank you!">
          Thanks for your time, {state.candidateName.split(' ')[0]}. Your responses for the <strong>{state.roundName}</strong> round have been submitted. The {state.companyName} team will be in touch about the next steps.
        </PortalMessage>
      </PortalShell>
    );
  if (state.status === 'expired')
    return (
      <PortalShell>
        <PortalMessage icon={<Hourglass className="size-6" />} title="This interview link has expired">
          Please contact your recruiter if you'd like a new link.
        </PortalMessage>
      </PortalShell>
    );
  if (!['invited', 'in_progress'].includes(state.status))
    return (
      <PortalShell>
        <PortalMessage icon={<XCircle className="size-6" />} title="This interview is not available" />
      </PortalShell>
    );

  /* ---------------------------------------------------------------- intro */
  if (!inSession) {
    const resuming = state.status === 'in_progress';
    return (
      <PortalShell>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Bot className="size-5" />
            </div>
            <div>
              <p className="text-sm text-zinc-500">
                {state.jobTitle} · {state.companyName}
              </p>
              <h1 className="text-xl font-semibold text-zinc-900">{state.roundName}</h1>
            </div>
          </div>
          <p className="mt-5 text-sm text-zinc-700">
            Hi {state.candidateName.split(' ')[0]}! This is a conversational interview with our AI interviewer. It will ask about <strong>{state.questionCount}</strong> questions and may follow up on your answers. Plan for about <strong>{state.durationMin} minutes</strong>.
          </p>
          <div className="mt-5 rounded-xl bg-zinc-50 p-4 text-sm text-zinc-600">
            <p className="mb-2 flex items-center gap-1.5 font-medium text-zinc-900">
              <Lightbulb className="size-4 text-amber-500" /> Tips for a great interview
            </p>
            <ul className="space-y-1.5">
              <li>• Answer in your own words — specific examples from your experience work best.</li>
              <li>• Take a moment to think; there's no penalty for a short pause.</li>
              <li>• Aim for a few clear paragraphs per answer.{speechSupported ? ' You can also dictate with the microphone.' : ''}</li>
              {proctored && (
                <>
                  <li className="flex gap-1.5">
                    <Maximize className="mt-0.5 size-4 shrink-0 text-brand-500" /> This round is proctored: it runs in full-screen and tab switching, copy/paste are recorded.
                  </li>
                  <li className="flex gap-1.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" /> Keep your camera on. Video is not recorded.
                  </li>
                </>
              )}
            </ul>
          </div>

          {proctored && (
            <div className="mt-5 flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-4 sm:flex-row">
              <CameraPreview stream={camera.stream} status={camera.status} className="h-32 w-44 shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-zinc-900">Camera check</p>
                <p className="mt-0.5 text-zinc-500">{camera.status === 'on' ? 'Camera is working.' : camera.status === 'denied' ? 'Camera access was blocked. Please allow it in your browser settings.' : 'Allow camera access to continue.'}</p>
                {camera.status !== 'on' && (
                  <Button size="sm" variant="outline" className="mt-2" loading={camera.status === 'requesting'} onClick={() => void camera.request()}>
                    Enable camera
                  </Button>
                )}
              </div>
            </div>
          )}
          {proctored && (
            <label className="mt-5 flex items-start gap-2 text-sm text-zinc-600">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I agree to the proctoring rules for this interview.
            </label>
          )}
          <Button size="lg" className="mt-6 w-full" loading={starting} disabled={proctored && !consent} onClick={begin}>
            {resuming ? 'Resume interview' : "I'm ready — start interview"}
          </Button>
        </div>
      </PortalShell>
    );
  }

  /* ---------------------------------------------------------------- chat */
  const answered = messages.filter((m) => m.role === 'candidate').length;
  const qNum = Math.min(answered + 1, state.questionCount);
  const low = remaining !== null && remaining < 3 * 60_000;

  return (
    <div className="flex h-full flex-col bg-zinc-50">
      <ProctorWarning message={proctor.warning} onDismiss={proctor.dismissWarning} onFullscreen={proctored ? () => void enterFullscreen() : undefined} />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <div className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900">{state.roundName}</p>
            <p className="text-xs text-zinc-500">
              Question {qNum} of {state.questionCount}
            </p>
          </div>
          {remaining !== null && (
            <div className={cx('flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm font-semibold tabular-nums', low ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-700')}>
              <Clock className="size-3.5" /> {formatClock(remaining)}
            </div>
          )}
          {proctored && <CameraPreview stream={camera.stream} status={camera.status} className="hidden h-12 w-16 sm:block" />}
        </div>
        <div className="h-0.5 bg-zinc-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${(answered / state.questionCount) * 100}%` }} />
        </div>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {messages.map((m) => (
            <div key={`${m.seq}-${m.role}`} className={cx('flex gap-3', m.role === 'candidate' && 'flex-row-reverse')}>
              {m.role === 'interviewer' && (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                  <Bot className="size-4" />
                </div>
              )}
              <div
                className={cx(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap',
                  m.role === 'interviewer' ? 'rounded-tl-sm border border-zinc-200 bg-white text-zinc-800 shadow-xs' : 'rounded-tr-sm bg-brand-600 text-white',
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                <Bot className="size-4" />
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-zinc-200 bg-white px-4 py-3.5 shadow-xs">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {failed && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="size-4" /> Your last answer wasn't delivered.
              <button className="ml-auto inline-flex cursor-pointer items-center gap-1 font-medium underline" onClick={() => void send(failed)}>
                <RotateCw className="size-3" /> Retry
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              rows={3}
              value={draft}
              disabled={thinking}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              onPaste={(e) => {
                if (proctored) {
                  e.preventDefault();
                  toast.warning('Pasting is disabled in this interview');
                }
              }}
              placeholder={listening ? 'Listening… speak your answer' : 'Type your answer…'}
              className="resize-none"
            />
            <div className="flex flex-col gap-2">
              {speechSupported && (
                <Button
                  variant={listening ? 'danger' : 'outline'}
                  onClick={toggleMic}
                  title={listening ? 'Stop dictation' : 'Dictate answer'}
                  icon={listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                />
              )}
              <Button onClick={() => void send(draft)} disabled={!draft.trim() || thinking} icon={<Send className="size-4" />} />
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400">Press Ctrl + Enter to send · {proctor.violations > 0 ? `${proctor.violations} proctoring warning(s) recorded` : 'Your answers are saved as you go'}</p>
        </div>
      </div>
    </div>
  );
}
