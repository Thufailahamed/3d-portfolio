"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/store/useApp";

const NAME_MAX = 32;
const LINE_MAX = 110;

/** Loads the guestbook for the tablet in the hall, and the form visitors sign it with. */
export default function GuestbookPanel() {
  const open = useApp((s) => s.guestbookOpen);
  const set = useApp((s) => s.set);
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trap = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/guestbook")
      .then((r) => r.json())
      .then((d) => Array.isArray(d.entries) && set({ guestbook: d.entries }))
      .catch(() => {});
  }, [set]);

  if (!open) return null;

  const close = () => {
    setError(null);
    set({ guestbookOpen: false });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, line, website: trap.current?.value ?? "" }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Something went wrong.");
        return;
      }
      if (d.entry) set({ guestbook: [d.entry, ...useApp.getState().guestbook] });
      setLine("");
      set({ guestbookOpen: false, toast: "Signed. Look up at the marble panel on the right-hand wall of the hall." });
    } catch {
      setError("Couldn't reach the guestbook. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={close}
      onKeyDown={(e) => {
        // keep the pavilion's shortcuts out of the form
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-white/20 bg-black/90 p-5 shadow-2xl"
        aria-labelledby="guestbook-title"
      >
        <div className="flex items-center justify-between">
          <h2 id="guestbook-title" className="text-[11px] font-mono uppercase tracking-[0.2em] text-white">
            Guestbook · Sign the marble
          </h2>
          <button type="button" onClick={close} className="font-mono text-xs text-white/50 hover:text-white" aria-label="Close guestbook">
            ✕
          </button>
        </div>
        <p className="mt-2 text-xs text-white/50">Leave your name and a line. It is carved into the marble panel high on the right-hand wall of the hall.</p>

        <label className="mt-4 block text-[10px] font-mono uppercase tracking-widest text-white/50">
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            required
            autoComplete="nickname"
            className="mt-1 block w-full rounded border border-white/20 bg-white/5 px-3 py-2 font-sans text-sm normal-case tracking-normal text-white outline-none focus:border-accent"
          />
        </label>
        <label className="mt-3 block text-[10px] font-mono uppercase tracking-widest text-white/50">
          Your line
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            maxLength={LINE_MAX}
            required
            className="mt-1 block w-full rounded border border-white/20 bg-white/5 px-3 py-2 font-sans text-sm normal-case tracking-normal text-white outline-none focus:border-accent"
          />
          <span className="mt-1 block text-right text-[9px] text-white/30">
            {line.length}/{LINE_MAX}
          </span>
        </label>
        {/* bots fill this in; people never see it */}
        <input ref={trap} name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />

        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded border border-accent/60 py-2 font-mono text-[11px] uppercase tracking-[0.25em] text-accent transition-colors hover:bg-accent hover:text-black disabled:opacity-50"
        >
          {busy ? "Carving…" : "Sign"}
        </button>
      </form>
    </div>
  );
}
