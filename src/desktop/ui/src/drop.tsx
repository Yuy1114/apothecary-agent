import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./drop.css";

/**
 * 倾倒站 — its own tiny renderer entry, deliberately not the 10-view console.
 * Summon it from the tray, drag files on, they land in `_inbox` and the intake
 * pass drafts a filing proposal for them. Escape dismisses it.
 */

type DropOutcome = {
  source: string;
  status: "filed" | "rejected" | "failed";
  target?: string;
  renamed?: boolean;
  reason?: string;
};
type DropResult = { outcomes: DropOutcome[]; filed: number };

type Bridge = {
  pathForFile: (file: File) => string;
  dropFiles: (paths: string[]) => Promise<DropResult>;
  lastDropResult: () => Promise<DropResult | null>;
  closeDropStation: () => Promise<void>;
  onDropResult: (listener: (result: DropResult) => void) => () => void;
};

const bridge = (): Bridge => (window as unknown as { apothecary: Bridge }).apothecary;

const REASONS: Record<string, string> = {
  already_in_vault: "已经在药柜里了",
  not_found: "文件找不到了",
  unnamed: "无法识别文件名",
  too_many_duplicates: "同名文件太多",
};

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

function Outcome({ outcome }: { outcome: DropOutcome }): React.JSX.Element {
  const name = outcome.target ? basename(outcome.target) : basename(outcome.source);
  return (
    <li className={`outcome outcome--${outcome.status}`}>
      <span className="outcome__name" title={outcome.source}>
        {name}
      </span>
      <span className="outcome__note">
        {outcome.status === "filed"
          ? outcome.renamed
            ? "已入库（重名，已改名）"
            : "已入库"
          : (REASONS[outcome.reason ?? ""] ?? outcome.reason ?? "失败")}
      </span>
    </li>
  );
}

function DropStation(): React.JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DropResult | null>(null);

  // The outcome always arrives from main, whoever triggered the drop — this
  // window, or a drag onto the tray icon. The mount fetch covers the case where
  // a tray drop filed the files before this page existed.
  useEffect(() => bridge().onDropResult(setResult), []);
  useEffect(() => {
    void bridge()
      .lastDropResult()
      .then((last) => {
        if (last) setResult((current) => current ?? last);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void bridge().closeDropStation();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    setBusy(true);
    try {
      // Paths must come from the preload: the renderer has no `File.path`.
      const paths = files.map((file) => bridge().pathForFile(file)).filter(Boolean);
      // The outcome comes back over the result channel, not from this call.
      await bridge().dropFiles(paths);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="station">
      <header className="station__bar">
        <span className="station__title">倾倒站</span>
        <button
          type="button"
          className="station__close"
          onClick={() => void bridge().closeDropStation()}
          aria-label="关闭"
        >
          ✕
        </button>
      </header>

      <div
        className={`zone${dragging ? " zone--over" : ""}${busy ? " zone--busy" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <div className="zone__icon">↓</div>
        <div className="zone__label">{busy ? "正在入库…" : "把文件拖到这里"}</div>
        <div className="zone__hint">落进 _inbox，稍后由归位提案决定去处</div>
      </div>

      {result && (
        <div className="report">
          <div className="report__head">
            {result.filed > 0
              ? `${result.filed} 项已入库，正在起草归位计划`
              : "没有入库任何东西"}
          </div>
          <ul className="report__list">
            {result.outcomes.map((outcome) => (
              <Outcome key={outcome.source} outcome={outcome} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DropStation />
  </StrictMode>,
);
