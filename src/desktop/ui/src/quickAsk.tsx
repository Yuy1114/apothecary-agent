import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

// First placement only — once open the popover is a free-floating window and
// a ResizeObserver keeps it inside the viewport as it grows or moves.
const initialPos = (rect: Snapshot["rect"]) => ({
  left: clamp(rect.left, MARGIN, window.innerWidth - POP_WIDTH - MARGIN),
  top: rect.bottom + MARGIN + POP_EST_HEIGHT > window.innerHeight
    ? Math.max(MARGIN, rect.top - POP_EST_HEIGHT - MARGIN)
    : rect.bottom + MARGIN,
});

/**
 * 划词快问: selecting text inside `containerRef` shows a floating 快问 button;
 * it opens a draggable floating popover whose Q&A streams over runEvent with
 * its own runIds. Deliberately thread-free — closing discards the transcript.
 */
export function QuickAsk({ containerRef, resolveContext }: {
  containerRef: { current: HTMLElement | null };
  resolveContext: (range: Range, selectionText: string) => QuickAskContext | null;
}) {
  const [fab, setFab] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState<Snapshot | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const popRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  const busy = turns.some((turn) => turn.status === "streaming");

  // Selection detection: after any mouseup/keyup, offer the fab when a valid
  // selection sits inside the host container and the view can resolve context.
  // Works with the popover open too — the fab then re-targets it.
  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setFab(null); return; }
      const text = sel.toString().trim();
      if (text.length < 2 || text.length > 8000) { setFab(null); return; }
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const container = containerRef.current;
      if (!element || !container || !container.contains(element)) { setFab(null); return; }
      // Copying text out of the popover itself must not offer a nested fab
      // (in the Vault view the popover mounts inside the preview container).
      if (popRef.current?.contains(element)) return;
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
  // just hide it (the open popover floats free and stays).
  useEffect(() => {
    if (!fab) return;
    const hide = () => setFab(null);
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [fab]);

  const dropStream = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  // Open (or re-target) the floating window onto a fresh selection snapshot.
  const openAt = (snapshot: Snapshot) => {
    dropStream();
    setTurns([]);
    setQuestion("");
    setOpen(snapshot);
    setPos(initialPos(snapshot.rect));
    setFab(null);
  };

  const close = useCallback(() => {
    setOpen(null);
    setPos(null);
    setTurns([]);
    setQuestion("");
    dropStream();
  }, []);

  // Unmount (view switch) must also drop the stream subscription.
  useEffect(() => () => { unsubRef.current?.(); }, []);

  // Floating-window closing: only Esc or the × button (outside clicks are how
  // the user keeps reading / selects the next fragment while it stays open).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Keep the whole window inside the viewport, measured at its real size: on
  // open, whenever streamed content grows it, and on viewport resize.
  useLayoutEffect(() => {
    if (!open) return;
    const element = popRef.current;
    if (!element) return;
    const clampIntoView = () => {
      const rect = element.getBoundingClientRect();
      setPos((current) => {
        if (!current) return current;
        const left = clamp(current.left, MARGIN, window.innerWidth - rect.width - MARGIN);
        const top = clamp(current.top, MARGIN, window.innerHeight - rect.height - MARGIN);
        return left === current.left && top === current.top ? current : { left, top };
      });
    };
    clampIntoView();
    const observer = new ResizeObserver(clampIntoView);
    observer.observe(element);
    window.addEventListener("resize", clampIntoView);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampIntoView);
    };
  }, [open]);

  // Drag by the header. Pointer capture keeps fast drags from escaping.
  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".qa-close")) return;
    if (!pos) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseLeft: pos.left, baseTop: pos.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHeadPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = popRef.current;
    if (!drag || !element) return;
    setPos({
      left: clamp(drag.baseLeft + event.clientX - drag.startX, MARGIN, window.innerWidth - element.offsetWidth - MARGIN),
      top: clamp(drag.baseTop + event.clientY - drag.startY, MARGIN, window.innerHeight - element.offsetHeight - MARGIN),
    });
  };
  const onHeadPointerUp = () => { dragRef.current = null; };

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
      dropStream();
    };
    const unsub = api.onRunEvent(({ runId: eventRunId, event }) => {
      if (eventRunId !== runId) return;
      if (event.type === "text_delta") {
        setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, answer: turn.answer + event.text } : turn)));
      } else if (event.type === "completed") {
        setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, status: "done" } : turn)));
        dropStream();
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

  const fabStyle = fab
    ? {
        left: clamp(fab.rect.right - 8, MARGIN, window.innerWidth - FAB_WIDTH - MARGIN),
        top: fab.rect.top - 34 >= MARGIN ? fab.rect.top - 34 : fab.rect.bottom + MARGIN,
      }
    : undefined;

  return (
    <>
      {fab && (
        <button
          className="qa-fab"
          style={fabStyle}
          onMouseDown={(event) => {
            // preventDefault keeps the browser from collapsing the selection
            // before the popover captures it.
            event.preventDefault();
            openAt(fab);
          }}
        >
          快问
        </button>
      )}
      {open && pos && (
        <div className="qa-pop" style={pos} ref={popRef}>
          <div
            className="qa-head"
            onPointerDown={onHeadPointerDown}
            onPointerMove={onHeadPointerMove}
            onPointerUp={onHeadPointerUp}
          >
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
