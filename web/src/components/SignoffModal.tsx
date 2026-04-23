import { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import Modal from "./Modal";

type Mode = "comment" | "blocked";

interface SignoffModalProps {
  open: boolean;
  mode: Mode;
  blockerCount?: number;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}

export default function SignoffModal({
  open,
  mode,
  blockerCount = 0,
  onConfirm,
  onCancel,
}: SignoffModalProps) {
  const [comment, setComment] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* reset + autofocus when opened */
  useEffect(() => {
    if (open) {
      setComment("");
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, mode]);

  function handleSubmit() {
    onConfirm(comment.trim());
  }

  const isBlocked = mode === "blocked";

  return (
    <Modal open={open} onClose={onCancel}>
      {/* icon + title */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-full ${
            isBlocked
              ? "bg-amber-100 dark:bg-amber-900/40"
              : "bg-emerald-100 dark:bg-emerald-900/40"
          }`}
        >
          {isBlocked ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isBlocked ? "Override required" : "Sign off artifact"}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isBlocked
              ? `${blockerCount} high-severity gap${blockerCount !== 1 ? "s" : ""} blocking sign-off`
              : "Add an optional comment before signing"}
          </p>
        </div>
      </div>

      {isBlocked && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300 text-sm">
          Open documentation gaps will be overridden. Please provide a reason to continue.
        </div>
      )}

      <label className="block mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
        {isBlocked ? "Override reason" : "Comment"}{" "}
        {!isBlocked && (
          <span className="text-slate-400 font-normal">(optional)</span>
        )}
      </label>
      <textarea
        ref={inputRef}
        rows={3}
        className="input w-full text-sm resize-none"
        placeholder={
          isBlocked
            ? "Explain why these gaps can be overridden…"
            : "e.g. Reviewed and approved"
        }
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
        }}
      />
      <p className="mt-1 text-xs text-slate-400">
        Press ⌘ + Enter to submit
      </p>

      <div className="mt-5 flex items-center justify-end gap-3">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${isBlocked ? "bg-amber-600 hover:bg-amber-700 text-white" : "btn-primary"}`}
          onClick={handleSubmit}
          disabled={isBlocked && !comment.trim()}
        >
          {isBlocked ? (
            <>
              <AlertTriangle className="w-4 h-4" /> Override & sign
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" /> Sign off
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
