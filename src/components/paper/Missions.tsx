"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { missions } from "@/content/paper";
import { person, projects } from "@/content/site";
import { Arrow } from "./art";

const pad = (n: number) => String(n).padStart(2, "0");
const bySlug = new Map(projects.map((p) => [p.slug, p]));

/** "Choose your objective": the list on paper, the selected brief on the night screen. */
export default function Missions() {
  const [pick, setPick] = useState(0);
  const m = missions[pick];
  const mail = `mailto:${person.email}?subject=${encodeURIComponent(`New build: ${m.name}`)}&body=${encodeURIComponent(
    `Hi ${person.name.split(" ")[0]},\n\nI'd like to talk about a ${m.name.toLowerCase()} build.\n\n`,
  )}`;

  return (
    <section className="p-board" id="missions" data-chapter aria-labelledby="missions-title">
      {/* waypoints for the page rope: down the seam between the list and the screen */}
      {[
        ["92%", "3%"],
        ["56%", "18%"],
        ["50%", "48%"],
        ["40%", "72%"],
        ["50%", "97%"],
      ].map(([left, top], i) => (
        <i key={i} className="p-rope-at" data-rope-at style={{ left, top }} />
      ))}
      <div className="p-board__half p-board__half--front" data-tone="paper">
        <div className="p-board__inner">
          <p className="p-kicker p-mono">
            <b>05</b>
            <span>Objectives</span>
          </p>
          <h2 id="missions-title" className="p-title" data-chars>
            Choose your <em>objective.</em>
          </h2>
          <p className="p-board__lead">Four things worth optimising for. Pick one and the email arrives already written.</p>
          <ol className="p-board__list">
            {missions.map((x, i) => (
              <li key={x.name}>
                <button
                  type="button"
                  className="p-board__item"
                  aria-pressed={i === pick}
                  aria-controls="mission-panel"
                  onClick={() => setPick(i)}
                >
                  <span className="p-board__num p-mono">{pad(i + 1)}</span>
                  <span className="p-board__name">{x.name}</span>
                  <span className="p-board__arrow">
                    <Arrow />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="p-board__half p-board__half--back" data-tone="night">
        <div className="p-board__screen" aria-live="polite">
          <article key={pick} id="mission-panel" className="p-board__panel">
            <p className="p-board__tag p-mono">
              <span className="p-board__hex">{pad(pick + 1)}</span>Objective selected
            </p>
            <h3 className="p-board__title">{m.name}</h3>
            <p className="p-board__desc">{m.desc}</p>
            <p className="p-kicker p-mono">
              <b className="is-mark">—</b>
              <span>Loadout</span>
            </p>
            <ul className="p-pills" aria-label="Loadout">
              {m.loadout.map((l) => (
                <li key={l} className="p-pill">
                  {l}
                </li>
              ))}
            </ul>
            <p className="p-kicker p-mono">
              <b className="is-mark">—</b>
              <span>Live systems built this way</span>
            </p>
            <ul className="p-board__shops">
              {m.projects.map((slug) => {
                const p = bySlug.get(slug);
                if (!p) return null;
                return (
                  <li key={slug}>
                    <Link className="p-board__shop" href={`/projects/${slug}`} data-cursor="view">
                      <span className="p-board__thumb">
                        <Image src={p.cover} alt="" fill sizes="(min-width: 1024px) 12vw, 30vw" />
                      </span>
                      <span className="p-board__shop-name">{p.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <a className="p-button p-button--solid" href={mail} data-magnetic>
              <span className="p-button__fill" />
              <span>Optimise for this</span>
              <Arrow />
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
