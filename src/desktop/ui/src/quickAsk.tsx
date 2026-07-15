import { KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown.js";

const api = window.apothecary;

/** What a quick ask is about: bounded context resolved by the hosting view. */
export type QuickAskContext = { contextText: string; source: "chat" | "note"; sourcePath?: string };

// Everything the popover needs, snapshotted the moment the fab appears — the
// browser collapses the selection on the next click, so nothing may be read
// from the live selection after that.
type Snapshot = {
  selection: string;
  context: QuickAskContext;
  rect: { top: number; bottom: number; left: number; right: number };
};

type Turn = {
  runId: string;
  question: string;
  answer: string;
  status: "streaming" | "done" | "failed";
  error?: string;
};

const FAB_WIDTH = 64;
const POP_WIDTH = 380;
const POP_EST_HEIGHT = 320;
const MARGIN = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 划词快问: selecting text inside `containerRef` shows a floating 快问 button;
 * it opens an anchored popover whose Q&A streams over runEvent with its own
 * runIds. Deliberately thread-free — closing discards the whole transcript.
 */
export function QuickAsk({ containerRef, resolveContext }: {
  containerRef: { current: HTMLElement | null };
  resolveContext: (range: Range, selectionText: string) => QuickAskContext | null;
}) {
  const [fab, setFab] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState<Snapshot | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const busy = turns.some((turn) => turn.status === "streaming");

  // Selection detection: after any mouseup/keyup, offer the fab when a valid
  // selection sits inside the host container and the view can resolve context.
  useEffect(() => {
    const onSelect = () => {
      if (openRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setFab(null); return; }
      const text = sel.toString().trim();
      if (text.length < 2 || text.length > 8000) { setFab(null); return; }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const container = containerRef.current;
      if (!element || !container || !container.contains(element)) { setFab(null); return; }
      const context = resolveContext(range, text);
      if (!context) { setFab(null); return; }
      const rect = range.getBoundingClientRect();
      setFab({ selection: text, context, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } });
    };
    document.addEventListener("mouseup", onSelect);
    document.addEventListener("keyup", onSelect);
    return () => {
      document.removeEventListener("mouseup", onSelect);
      document.removeEventListener("keyup", onSelect);
    };
  }, [containerRef, resolveContext]);

  // The fab is anchored to a viewport rect that goes stale on scroll/resize —
  // just hide it (the open popover instead behaves as a transient dialog).
  useEffect(() => {
    if (!fab || open) return;
    const hide = () => setFab(null);
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [fab, open]);

  const close = useCallback(() => {
    setOpen(null);
    setTurns([]);
    setQuestion("");
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  // Unmount (view switch) must also drop the stream subscription.
  useEffect(() => () => { unsubRef.current?.(); }, []);

  useEffect(() => {
    if (!open) { openRef.current = false; return; }
    openRef.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) close();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) close();
    };
    // Re-render so the fixed position re-clamps to the new viewport.
    const onResize = () => setOpen((current) => (current ? { ...current } : current));
    document.addEventListener("keydown", onKeyDown);
    // Register outside-click a tick later: the mousedown that opened the popover
    // is still dispatching, and must not immediately close it again.
    const outsideTimer = window.setTimeout(() => document.addEventListener("mousedown", onMouseDown), 0);
    window.addEventListener("resize", onResize);
    return () => {
      openRef.current = false;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(outsideTimer);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [turns]);

  const ask = (asked: string) => {
    if (!open || busy) return;
    const runId = crypto.randomUUID();
    const priorTurns = turns
      .filter((turn) => turn.status === "done")
      .slice(-2)
      .map(({ question: q, answer }) => ({ question: q, answer }));
    setTurns((current) => [...current, { runId, question: asked, answer: "", status: "streaming" }]);
    const fail = (message: string) => {
      setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, status: "failed", error: message } : turn)));
      unsubRef.current?.();
      unsubRef.current = null;
    };
    const unsub = api.onRunEvent(({ runId: eventRunId, event }) => {
      if (eventRunId !== runId) return;
      if (event.type === "text_delta") {
        setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, answer: turn.answer + event.text } : turn)));
      } else if (event.type === "completed") {
        setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, status: "done" } : turn)));
        unsubRef.current?.();
        unsubRef.current = null;
      } else if (event.type === "failed") {
        fail(event.message);
      }
    });
    unsubRef.current = unsub;
    void api.quickAsk({
      runId,
      question: asked,
      selection: open.selection,
      contextText: open.context.contextText,
      source: open.context.source,
      sourcePath: open.context.sourcePath,
      priorTurns,
    }).catch((error) => fail((error as Error).message));
  };

  const submit = () => {
    const asked = question.trim();
    if (!asked) return;
    setQuestion("");
    ask(asked);
  };

  const retry = (turn: Turn) => {
    setTurns((current) => current.filter((t) => t.runId !== turn.runId));
    ask(turn.question);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const viewWidth = window.innerWidth;
  const fabStyle = fab
    ? {
        left: clamp(fab.rect.right - 8, MARGIN, viewWidth - FAB_WIDTH - MARGIN),
        top: fab.rect.top - 34 >= MARGIN ? fab.rect.top - 34 : fab.rect.bottom + MARGIN,
      }
    : undefined;
  const popStyle = open
    ? {
        left: clamp(open.rect.left, MARGIN, viewWidth - POP_WIDTH - MARGIN),
        top: open.rect.bottom + MARGIN + POP_EST_HEIGHT > window.innerHeight
          ? Math.max(MARGIN, open.rect.top - POP_EST_HEIGHT - MARGIN)
          : open.rect.bottom + MARGIN,
      }
    : undefined;

  return (
    <>
      {fab && !open && (
        <button
          className="qa-fab"
          style={fabStyle}
          onMouseDown={(event) => {
            // preventDefault keeps the browser from collapsing the selection
            // before the popover captures it.
            event.preventDefault();
            setOpen(fab);
            setFab(null);
          }}
        >
          快问
        </button>
      )}
      {open && (
        <div className="qa-pop" style={popStyle} ref={popRef}>
          <div className="qa-head">
            <span className="qa-title">快问</span>
            {open.context.source === "note" && open.context.sourcePath && (
              <span className="qa-src" title={open.context.sourcePath}>{open.context.sourcePath}</span>
            )}
            <span className="spacer" />
            <button className="qa-close" onClick={close} title="关闭（Esc）">×</button>
          </div>
          <div className="qa-selection" title={open.selection}>{open.selection}</div>
          {turns.length > 0 && (
            <div className="qa-body" ref={bodyRef}>
              {turns.map((turn) => (
                <div key={turn.runId} className="qa-turn">
                  <div className="qa-q">{turn.question}</div>
                  {turn.status === "streaming" && !turn.answer && <div className="qa-pending">思考中…</div>}
                  {turn.answer && <Markdown className="qa-a" text={turn.answer} />}
                  {turn.status === "failed" && (
                    <div className="qa-error">
                      <span>{turn.error ?? "快问失败"}</span>
                      <button className="btn btn-ghost sm" onClick={() => retry(turn)}>重试</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="qa-input">
            <input
              ref={inputRef}
              className="input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="就选中内容提问…（Enter 发送）"
              disabled={busy}
            />
            <button className="btn btn-primary sm" onClick={submit} disabled={busy || !question.trim()}>发送</button>
          </div>
          <div className="qa-hint">临时问答 · 不进入对话记忆，关闭即丢弃</div>
        </div>
      )}
    </>
  );
}
