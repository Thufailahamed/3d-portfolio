/** Hand-drawn SVG for the paper edition. Deterministic, so server and client render the same. */

/** Seeded PRNG: everything looks hand-placed but never shifts between renders. */
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The mark: a code bracket pair split by a slash. Human side in violet, machine side in cyan. */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg className={`p-mark ${className}`} viewBox="0 0 100 100" aria-hidden focusable="false">
      <path className="p-mark__front" d="M38 20 12 50l26 30" />
      <path className="p-mark__slash" d="M58 14 42 86" />
      <path className="p-mark__back" d="M62 20l26 30-26 30" />
    </svg>
  );
}

/** The street's horizon: a training run. Loss falls as you scroll along it. */
export function LossCurve() {
  const W = 3200;
  const H = 340;
  const train: string[] = [];
  const val: string[] = [];
  for (let x = 0; x <= W; x += 8) {
    const base = H - 40 - 230 * Math.exp(-x / 820);
    const noise = 13 * Math.exp(-x / 1500) * (Math.sin(x / 23) + 0.6 * Math.sin(x / 9.7 + 1));
    train.push(`${x} ${r1(base + noise)}`);
    val.push(`${x} ${r1(base - 16 + 22 * Math.exp(-x / 600) + 4 * Math.sin(x / 61))}`);
  }
  const notes = [
    // kept clear of where the end signboard comes to rest over the curve
    { x: 260, t: "epoch 01" },
    { x: 700, t: "epoch 03" },
    { x: 1700, t: "epoch 08" },
    { x: 2950, t: "converged" },
  ];
  const yAt = (x: number) => H - 40 - 230 * Math.exp(-x / 820);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMax meet" aria-hidden focusable="false">
      <defs>
        <linearGradient id="p-loss-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="p-loss__stop-a" />
          <stop offset="1" className="p-loss__stop-b" />
        </linearGradient>
      </defs>
      {[60, 140, 220, 300].map((y) => (
        <path key={y} className="p-loss__grid" d={`M0 ${y}H${W}`} />
      ))}
      {Array.from({ length: 16 }, (_, i) => (
        <path key={i} className="p-loss__grid" d={`M${i * 200 + 100} 20V${H}`} />
      ))}
      <path className="p-loss__area" d={`M0 ${H} L${train.join(" L")} L${W} ${H} Z`} fill="url(#p-loss-fill)" />
      <path className="p-loss__val" d={`M${val.join(" L")}`} />
      <path className="p-loss__train" d={`M${train.join(" L")}`} />
      {notes.map((n) => (
        <g key={n.t} transform={`translate(${n.x} ${r1(yAt(n.x))})`}>
          <circle className="p-loss__dot" r="5" />
          <path className="p-loss__tick" d="M0 -10V-34" />
          <text className="p-loss__note" x="6" y="-40">
            {n.t}
          </text>
        </g>
      ))}
      <text className="p-loss__axis" x="12" y="48">
        loss
      </text>
    </svg>
  );
}

/** A cluster of points in embedding space, drifting in the sky. */
export function EmbedCluster({ seed, label }: { seed: number; label: string }) {
  const rnd = seeded(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const dots = Array.from({ length: 34 }, () => ({ x: r1(80 + gauss() * 28), y: r1(56 + gauss() * 17), r: 1.6 + rnd() * 2.6, hot: rnd() > 0.8 }));
  return (
    <svg viewBox="0 0 160 112" aria-hidden focusable="false">
      <ellipse className="p-emb__hull" cx="80" cy="56" rx="66" ry="40" />
      {dots.map((d, i) => (
        <circle key={i} className={d.hot ? "p-emb__dot is-hot" : "p-emb__dot"} cx={d.x} cy={d.y} r={r1(d.r)} />
      ))}
      <text className="p-emb__label" x="80" y="108" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}

/** A signal mast between the units: a node broadcasting rings. */
export function Mast() {
  return (
    <svg viewBox="0 0 40 200" aria-hidden focusable="false">
      <circle className="p-mast__ring" cx="20" cy="30" r="16" />
      <circle className="p-mast__ring" cx="20" cy="30" r="16" style={{ animationDelay: "-1.2s" }} />
      <rect className="p-mast__ink" x="18" y="34" width="4" height="160" />
      <path className="p-mast__ink" d="M10 120h20M13 150h14" strokeWidth="2" />
      <circle className="p-mast__node" cx="20" cy="30" r="6" />
      <rect className="p-mast__ink" x="10" y="190" width="20" height="10" rx="2" />
    </svg>
  );
}

/** The hero behind the split: a small network, with activations running through it. */
export function NeuralNet() {
  const rnd = seeded(11);
  const layers = [
    { x: 80, n: 4, label: "Input" },
    { x: 225, n: 6, label: "Embed" },
    { x: 375, n: 6, label: "Attend" },
    { x: 520, n: 3, label: "Output" },
  ];
  const nodes = layers.map((l) => Array.from({ length: l.n }, (_, j) => ({ x: l.x, y: 300 + (j - (l.n - 1) / 2) * 74 })));
  const edges: { a: { x: number; y: number }; b: { x: number; y: number }; live: boolean; delay: number }[] = [];
  for (let i = 0; i < nodes.length - 1; i++)
    for (const a of nodes[i]) for (const b of nodes[i + 1]) edges.push({ a, b, live: rnd() > 0.66, delay: r1(rnd() * 3.2 + i * 0.5) });
  const outputs = ["answer", "citation", "action"];
  return (
    <svg viewBox="0 0 600 640" aria-hidden focusable="false">
      <defs>
        <radialGradient id="p-nn-glow">
          <stop offset="0" className="p-nn__glow-a" />
          <stop offset="1" className="p-nn__glow-b" />
        </radialGradient>
      </defs>
      <ellipse cx="300" cy="300" rx="300" ry="270" fill="url(#p-nn-glow)" />
      <ellipse className="p-nn__shadow" cx="300" cy="600" rx="220" ry="26" />
      {edges.map((e, i) => (
        <path key={i} className="p-nn__edge" d={`M${e.a.x} ${e.a.y}L${e.b.x} ${e.b.y}`} />
      ))}
      {edges
        .filter((e) => e.live)
        .map((e, i) => (
          <path
            key={i}
            className="p-nn__pulse"
            d={`M${e.a.x} ${e.a.y}L${e.b.x} ${e.b.y}`}
            pathLength={100}
            style={{ animationDelay: `-${e.delay}s` }}
          />
        ))}
      {nodes.map((col, i) =>
        col.map((n, j) => (
          <g key={`${i}-${j}`} className={`p-nn__unit p-nn__unit--${i}`}>
            <circle className="p-nn__node" cx={n.x} cy={n.y} r="13" />
            <circle className="p-nn__core" cx={n.x} cy={n.y} r="4.5" style={{ animationDelay: `-${r1(rnd() * 2.4)}s` }} />
          </g>
        )),
      )}
      {nodes[3].map((n, j) => (
        <text key={j} className="p-nn__out" x={n.x + 24} y={n.y + 4}>
          {outputs[j]}
        </text>
      ))}
      {layers.map((l) => (
        <text key={l.label} className="p-nn__label" x={l.x} y="560" textAnchor="middle">
          {l.label}
        </text>
      ))}
    </svg>
  );
}

/** Training floor backdrop: a hall of racks with blinking LEDs. */
export function ServerHall() {
  const rnd = seeded(31);
  const W = 3600;
  const H = 600;
  const racks = Array.from({ length: 24 }, (_, i) => {
    const h = 360 + Math.round(rnd() * 120);
    const x = i * 150 + 14;
    const leds = Array.from({ length: 5 }, () => ({ x: x + 18 + Math.floor(rnd() * 5) * 18, y: H - h + 28 + Math.floor(rnd() * ((h - 60) / 22)) * 22, d: r1(rnd() * 2.4) }));
    return { x, h, leds, cyan: rnd() > 0.5 };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMax meet" aria-hidden focusable="false">
      <defs>
        <pattern id="p-led" width="18" height="22" patternUnits="userSpaceOnUse">
          <rect x="4" y="9" width="10" height="3" rx="1.5" className="p-hall__slot" />
        </pattern>
      </defs>
      <path className="p-hall__tray" d={`M0 70H${W}`} />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} className="p-hall__cable" d={`M${i * 300 + 40} 70 C${i * 300 + 80} 150 ${i * 300 + 200} 150 ${i * 300 + 260} 70`} />
      ))}
      {racks.map((r, i) => (
        <g key={i}>
          <rect className="p-hall__rack" x={r.x} y={H - r.h} width={122} height={r.h} rx="4" />
          <rect x={r.x + 8} y={H - r.h + 16} width={106} height={r.h - 30} fill="url(#p-led)" />
          {r.leds.map((l, j) => (
            <rect
              key={j}
              className={`p-hall__led ${r.cyan ? "is-cyan" : ""}`}
              x={l.x + 4}
              y={l.y + 9}
              width="10"
              height="3"
              rx="1.5"
              style={{ animationDelay: `-${l.d}s` }}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Shared arrow glyph for buttons and signboards. */
export function Arrow() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden focusable="false">
      <polygon points="30,6 74,50 30,94 20,84 54,50 20,16" />
    </svg>
  );
}
