"use client";

import { useEffect } from "react";
import { useApp } from "@/store/useApp";

/** One polite live region for short confirmations (e.g. "Email copied"). */
export default function Toast() {
  const toast = useApp((s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useApp.getState().set({ toast: null }), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-20 z-[65] flex justify-center px-gutter"
    >
      <p
        className={`label flex items-center gap-2 rounded-full bg-fg px-4 py-2.5 !text-bg shadow-lg transition-all duration-500 ${
          toast ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
        }`}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bg" />
        {toast ?? ""}
      </p>
    </div>
  );
}
