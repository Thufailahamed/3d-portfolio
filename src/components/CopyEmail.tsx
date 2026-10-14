"use client";

import { person } from "@/content/site";
import { useApp } from "@/store/useApp";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers / insecure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** The email as a button: click copies it and confirms with a toast. */
export default function CopyEmail({ className = "" }: { className?: string }) {
  const onClick = async () => {
    const ok = await copy(person.email);
    useApp.getState().set({ toast: ok ? "Email copied to clipboard" : `Copy failed — ${person.email}` });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-cursor="copy"
      className={`group inline-flex items-baseline gap-3 text-left ${className}`}
      aria-label={`Copy email address ${person.email}`}
    >
      <span className="underline decoration-fg/25 decoration-1 underline-offset-[0.18em] transition-colors group-hover:text-accent group-hover:decoration-accent">
        {person.email}
      </span>
      <span aria-hidden className="label hidden !text-fg/50 transition-colors group-hover:!text-accent md:inline">
        Click to copy
      </span>
    </button>
  );
}
