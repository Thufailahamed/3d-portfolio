"use client";

import Link from "next/link";

/** Leaves the lite site for the WebGL journey (full reload, so the scene boots clean). */
export default function FullExperienceLink({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link
      href="/"
      onClick={(e) => {
        e.preventDefault();
        sessionStorage.setItem("mode", "full");
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a hard load boots the scene clean
        location.assign("/");
      }}
      className={className}
    >
      {children ?? "Full 3D experience ↗"}
    </Link>
  );
}
