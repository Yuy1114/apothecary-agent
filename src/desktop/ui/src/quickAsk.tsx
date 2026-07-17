import { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./markdown.js";

const api = window.apothecary;

/** What a quick ask is about: bounded context resolved by the hosting view. */
export type QuickAskContext = { contextText: string; source: "chat" | "note"; sourcePath?: string };

// Everything a window needs, snapshotted the moment the fab appears — the
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

// First placement only — once open a window floats free and a ResizeObserver
// keeps it inside the viewport as it grows or moves.
const initialPos = (rect: Snapshot["rect"]) => ({
  left: clamp(rect.left, MARGIN, window.innerWidth - POP_WIDTH - MARGIN),
  top: rect.bottom + MARGIN + POP_EST_HEIGHT > window.innerHeight
    ? Math.max(MARGIN, rect.top - POP_EST_HEIGHT - MARGIN)
    : rect.bottom + MARGIN,
});

/** How a saved quick-ask should land: into which thread, and did we mint it. */
export type QuickAskSaved = { threadId: string; isNew: boolean };

export type QuickAskHandle = { openDirect: () => void };

/**
 * 划词快问: selecting text inside `containerRef` shows a floating 快问 button;
 * each click opens an independent draggable floating window whose Q&A streams
 * over runEvent with its own runIds. Clicking a window raises it; Esc closes
 * the frontmost one. With a `direct` resolver the view also gets selection-less
 * asks (button via ref, or Cmd/Ctrl+J) grounded by a vault search server-side.
 * Thread-free by default — closing discards everything; the explicit 存入 /
 * 转新对话 actions are the only way a transcript enters conversation memory.
 */
export const QuickAsk = forwardRef<QuickAskHandle, {
  containerRef: { current: HTMLElement | null };
  resolveContext: (range: Range, selectionText: string) => QuickAskContext | null;
  notify: (t: string) => void;
  onSaved: (saved: QuickAskSaved, goWorkspace: boolean) => void;
  /** Resolves "what am I looking at" for a selection-less direct ask. */
  direct?: () => QuickAskContext | null;
  /** The workspace's active thread — target of 存入当前对话 (null = mint one). */
  currentThreadId?: string | null;
  /** True while the hosting view streams a chat run — blocks 存入当前对话. */
  chatBusy?: boolean;
}>(function QuickAsk({ containerRef, resolveContext, notify, onSaved, direct, currentThreadId, chatBusy }, ref) {
  const [fab, setFab] = useState<Snapshot | null>(null);
  // `windows` keeps creation order (stable DOM order, so raising a window never
  // moves its node and never blurs its input); `stack` holds the z-order, last
  // id on top.
  const [windows, setWindows] = useState<Array<{ id: string; snapshot: Snapshot; initial: { left: number; top: number } }>>([]);
  const [stack, setStack] = useState<string[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);

  // Selection detection: after any mouseup/keyup, offer the fab when a valid
  // selection sits inside the host container and the view can resolve context.
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
      // Copying text out of a quick-ask window must not offer a nested fab
      // (in the Vault view the windows mount inside the preview container).
      if (element.closest(".qa-pop")) return;
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
  // just hide it (open windows float free and stay).
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

  // Every fab click opens a fresh window on the snapshotted selection.
  const openAt = useCallback((snapshot: Snapshot) => {
    const id = crypto.randomUUID();
    setWindows((current) => {
      let pos = initialPos(snapshot.rect);
      // Cascade away from windows spawned at the same anchor (e.g. asking
      // about the same selection twice) so none hides another completely.
      while (current.some((w) => Math.abs(w.initial.left - pos.left) < 16 && Math.abs(w.initial.top - pos.top) < 16)) {
        pos = { left: pos.left + 28, top: pos.top + 28 };
      }
      return [...current, { id, snapshot, initial: pos }];
    });
    setStack((current) => [...current, id]);
    setFab(null);
    // The snapshot is taken — collapse the real selection so the mouseup that
    // follows the fab click cannot re-offer a stale fab for it.
    window.getSelection()?.removeAllRanges();
  }, []);

  // Selection-less direct ask: anchored to the viewport's top-right (openAt's
  // cascade separates repeats). Exposed to the view's toolbar button via ref
  // and to Cmd/Ctrl+J while this view is mounted.
  const openDirect = useCallback(() => {
    const context = direct?.();
    if (!context) return;
    const right = window.innerWidth - MARGIN;
    openAt({ selection: "", context, rect: { top: 64, bottom: 64, left: right - POP_WIDTH, right } });
  }, [direct, openAt]);
  useImperativeHandle(ref, () => ({ openDirect }), [openDirect]);
  useEffect(() => {
    if (!direct) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j" && !event.isComposing) {
        event.preventDefault();
        openDirect();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [direct, openDirect]);

  const closeWindow = useCallback((id: string) => {
    setWindows((current) => current.filter((w) => w.id !== id));
    setStack((current) => current.filter((stackId) => stackId !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setStack((current) => (current.at(-1) === id ? current : [...current.filter((stackId) => stackId !== id), id]));
  }, []);

  // Esc closes the frontmost window only.
  const hasWindows = windows.length > 0;
  useEffect(() => {
    if (!hasWindows) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const top = stackRef.current.at(-1);
      if (top) closeWindow(top);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hasWindows, closeWindow]);

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
            // before the window captures it.
            event.preventDefault();
            openAt(fab);
          }}
        >
          快问
        </button>
      )}
      {windows.map((w) => (
        <QuickAskWindow
          key={w.id}
          snapshot={w.snapshot}
          initial={w.initial}
          zIndex={50 + Math.max(0, stack.indexOf(w.id))}
          onClose={() => closeWindow(w.id)}
          onFocus={() => focusWindow(w.id)}
          notify={notify}
          onSaved={onSaved}
          currentThreadId={currentThreadId ?? null}
          chatBusy={chatBusy ?? false}
        />
      ))}
    </>
  );
});

/** One independent floating quick-ask window: own transcript, stream, drag. */
function QuickAskWindow({ snapshot, initial, zIndex, onClose, onFocus, notify, onSaved, currentThreadId, chatBusy }: {
  snapshot: Snapshot;
  initial: { left: number; top: number };
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  notify: (t: string) => void;
  onSaved: (saved: QuickAskSaved, goWorkspace: boolean) => void;
  currentThreadId: string | null;
  chatBusy: boolean;
}) {
  const [pos, setPos] = useState(initial);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseLeft: number; baseTop: number } | null>(null);
  const busy = turns.some((turn) => turn.status === "streaming");

  const dropStream = () => {
    unsubRef.current?.();
    unsubRef.current = null;
  };

  // Unmount (close / view switch) must drop the stream subscription.
  useEffect(() => () => { unsubRef.current?.(); }, []);

  // Keep the whole window inside the viewport, measured at its real size: on
  // mount, whenever streamed content grows it, and on viewport resize.
  useLayoutEffect(() => {
    const element = popRef.current;
    if (!element) return;
    const clampIntoView = () => {
      const rect = element.getBoundingClientRect();
      setPos((current) => {
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
  }, []);

  // Drag by the header. Pointer capture keeps fast drags from escaping.
  const onHeadPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".qa-close")) return;
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

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [turns]);

  const ask = (asked: string) => {
    if (busy) return;
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
      selection: snapshot.selection,
      contextText: snapshot.context.contextText,
      source: snapshot.context.source,
      sourcePath: snapshot.context.sourcePath,
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

  // The explicit "enter memory" outcomes. The transcript becomes real thread
  // messages (first user turn prefixed with the source, so later turns keep
  // their grounding); saving closes the window — its content lives on there.
  const doneTurns = turns.filter((turn) => turn.status === "done");
  const save = async (target: "current" | "new") => {
    if (doneTurns.length === 0 || saving) return;
    setSaving(true);
    try {
      const sourceNote = snapshot.context.source === "note" ? `笔记 ${snapshot.context.sourcePath ?? ""}`.trim() : "对话";
      const header = `（快问 · 来源：${sourceNote}${snapshot.selection ? `，选中：「${snapshot.selection.slice(0, 60)}」` : ""}）`;
      const messages = doneTurns.flatMap((turn, index) => [
        { role: "user" as const, content: index === 0 ? `${header}\n${turn.question}` : turn.question },
        { role: "assistant" as const, content: turn.answer },
      ]);
      const toCurrent = target === "current" && currentThreadId !== null;
      const result = await api.threadAppend(
        toCurrent ? currentThreadId : null,
        doneTurns[0].question.slice(0, 30),
        messages,
      );
      notify(toCurrent ? "已存入当前对话，作为后续上下文" : "已存入新对话");
      onSaved({ threadId: result.threadId, isNew: !toCurrent }, target === "new");
      onClose();
    } catch (error) {
      notify(`存入失败：${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="qa-pop" style={{ ...pos, zIndex }} ref={popRef} onPointerDownCapture={onFocus}>
      <div
        className="qa-head"
        onPointerDown={onHeadPointerDown}
        onPointerMove={onHeadPointerMove}
        onPointerUp={onHeadPointerUp}
      >
        <span className="qa-title">快问</span>
        {snapshot.context.source === "note" && snapshot.context.sourcePath && (
          <span className="qa-src" title={snapshot.context.sourcePath}>{snapshot.context.sourcePath}</span>
        )}
        <span className="spacer" />
        <button className="qa-close" onClick={onClose} title="关闭（Esc 关闭最前面的窗口）">×</button>
      </div>
      {snapshot.selection ? (
        <div className="qa-selection" title={snapshot.selection}>{snapshot.selection}</div>
      ) : (
        <div className="qa-selection" title="没有选区的直接快问：提问时会自动检索 vault 里的相关笔记">
          直接快问 · {snapshot.context.source === "note" ? (snapshot.context.sourcePath ?? "当前笔记") : "当前对话"} · 自动检索相关笔记
        </div>
      )}
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
          placeholder={snapshot.selection ? "就选中内容提问…（Enter 发送）" : "问点什么…（自动检索相关笔记，Enter 发送）"}
          disabled={busy}
        />
        <button className="btn btn-primary sm" onClick={submit} disabled={busy || !question.trim()}>发送</button>
      </div>
      {doneTurns.length > 0 && (
        <div className="qa-actions">
          <button
            className="btn btn-secondary sm"
            disabled={busy || saving || chatBusy}
            title={chatBusy ? "对话正在运行，稍后再存入" : currentThreadId ? "把这段问答写进当前对话，作为后续上下文" : "还没有进行中的对话，会新建一个"}
            onClick={() => void save("current")}
          >存入当前对话</button>
          <button
            className="btn btn-ghost sm"
            disabled={busy || saving}
            title="把这段问答另存为一个新对话并切换过去"
            onClick={() => void save("new")}
          >转为新对话</button>
        </div>
      )}
      <div className="qa-hint">默认临时问答 · 不存入则关闭即丢弃</div>
    </div>
  );
}
