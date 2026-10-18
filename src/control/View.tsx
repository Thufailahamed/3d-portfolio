"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PAYLOADS, RECOVERY_LABEL, VEHICLES, payloadById, siteById, vehicleById } from "./data";
import { dvBudget, marsC3, mc, network, resolveInclination, satNow, weather, type SimFailure } from "./engine";
import { chooseAzimuth, fmtT, minInclination } from "./flight";
import * as O from "./orbit";
import { clock, gmtStamp } from "./screens";
import { WARPS, useMC, type Burn, type Sat, type ViewId } from "./store";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

const ACCENT = "#c8ff3d";
const WARN = "#ffb020";
const BAD = "#ff4d5e";
const CYAN = "#4fd1ff";
const mono = { fontFamily: "var(--font-jetbrains), ui-monospace, monospace" } as const;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const dateStr = (jd: number) => O.dateOf(jd).toUTCString().slice(5, 16);

function Panel({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`pointer-events-auto rounded-xl border border-white/10 bg-[#0a0d12]/80 shadow-[0_20px_60px_-20px_rgba(0,0,0,.85)] backdrop-blur-md ${className}`} style={style}>
      {children}
    </div>
  );
}

function Btn({ onClick, children, active, title, className = "", tone, disabled }: { onClick: () => void; children: React.ReactNode; active?: boolean; title?: string; className?: string; tone?: "warn" | "bad" | "go"; disabled?: boolean }) {
  const toneCls =
    tone === "bad"
      ? "bg-[#ff4d5e] text-white hover:bg-[#ff6b79]"
      : tone === "warn"
        ? "bg-[#ffb020] text-[#0b0d12] hover:bg-[#ffc24d]"
        : tone === "go"
          ? "bg-[#c8ff3d] text-[#0b0d12] hover:bg-[#d6ff6b]"
          : active
            ? "bg-[#c8ff3d] text-[#0b0d12]"
            : "bg-white/[0.06] text-white/80 ring-1 ring-white/10 hover:bg-white/12 hover:text-white";
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={() => {
        mc.unlock();
        onClick();
      }}
      className={`pointer-events-auto flex h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${toneCls} ${className}`}
      style={mono}
    >
      {children}
    </button>
  );
}

function Stat({ k, v, sub, color }: { k: string; v: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-[5px] last:border-0">
      <span className="text-[10px] uppercase tracking-[0.13em] text-white/45">{k}</span>
      <span className="text-right text-[12px] text-white/90" style={{ ...mono, color }}>
        {v}
        {sub && <span className="ml-1 text-white/40">{sub}</span>}
      </span>
    </div>
  );
}

function Light({ on, color = ACCENT }: { on: boolean; color?: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: on ? color : "rgba(255,255,255,.15)", boxShadow: on ? `0 0 8px ${color}` : "none" }} />;
}

function H({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between first:mt-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45" style={mono}>
        {children}
      </p>
      {right}
    </div>
  );
}

// ———————————————————————————— planning ————————————————————————————

function PlanTab() {
  const d = useMC((s) => s.draft);
  const pr = useMC((s) => s.prediction);
  const predicting = useMC((s) => s.predicting);
  const err = useMC((s) => s.planError);
  const note = useMC((s) => s.planNote);
  const phase = useMC((s) => s.ops.phase);
  const counter = useMC((s) => s.counter);
  const jd = useMC((s) => Math.floor(s.jd));
  const p = payloadById[d.payload];
  const veh = vehicleById[d.vehicle];
  const site = siteById[d.site];
  const orbitTarget = p.target.kind === "orbit";
  const editableOrbit = orbitTarget && d.payload !== "crew" && d.payload !== "cargo";
  const inc = resolveInclination(d, site);
  const mars = p.target.kind === "escape" && p.target.c3 === "mars" ? marsC3(jd) : null;
  const w = weather(site, jd + 0.5);
  const busy = phase !== "idle";
  const el = pr?.el;
  const landing = pr?.boosters.filter((b) => b.outcome === "landed" || b.outcome === "lost" || b.outcome === "splash");
  return (
    <div>
      <H>1 · Payload</H>
      <div className="grid grid-cols-3 gap-1.5">
        {PAYLOADS.map((x) => (
          <button
            key={x.id}
            type="button"
            disabled={busy}
            onClick={() => mc.setDraft({ payload: x.id })}
            title={x.blurb}
            className={`rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-40 ${d.payload === x.id ? "bg-[#c8ff3d]/15 ring-1 ring-[#c8ff3d]/60" : "bg-white/[0.04] hover:bg-white/[0.08]"}`}
          >
            <span className="block text-[15px] leading-none" style={{ color: d.payload === x.id ? ACCENT : "rgba(255,255,255,.6)" }}>
              {x.icon}
            </span>
            <span className="mt-1 block text-[10.5px] leading-tight text-white/85">{x.short}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/55">{p.blurb}</p>

      <H>2 · Launch vehicle</H>
      <div className="space-y-1">
        {VEHICLES.map((v) => {
          const ok = !p.crew || v.crewRated;
          return (
            <button
              key={v.id}
              type="button"
              disabled={busy || !ok}
              onClick={() => mc.setDraft({ vehicle: v.id })}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:opacity-30 ${d.vehicle === v.id ? "bg-white/10 ring-1 ring-white/20" : "hover:bg-white/[0.05]"}`}
            >
              <span className="h-6 w-1 rounded-full" style={{ background: v.paint.metal ? "#b9bcc0" : v.paint.body === "#141414" ? "#555" : v.id === "sls" ? "#d9772b" : v.paint.accent }} />
              <span className="flex-1">
                <span className="block text-[12.5px] text-white">{v.name}</span>
                <span className="block text-[10px] text-white/40">
                  {v.maker} · {v.country}
                </span>
              </span>
              {p.prefer.includes(v.id) && (
                <span className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[#c8ff3d] ring-1 ring-[#c8ff3d]/40" style={mono}>
                  fit
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/50">{veh.blurb}</p>

      <H>3 · Pad, recovery, orbit</H>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-[0.12em] text-white/45">
          Pad
          <select disabled={busy} value={d.site} onChange={(e) => mc.setDraft({ site: e.target.value })} className="mt-1 block w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[12px] normal-case tracking-normal text-white ring-1 ring-white/10" style={mono}>
            {veh.pads.map((id) => (
              <option key={id} value={id} className="bg-[#0b0d12]">
                {siteById[id].short} · {siteById[id].place.split(",")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-[0.12em] text-white/45">
          Booster recovery
          <select disabled={busy} value={d.recovery} onChange={(e) => mc.setDraft({ recovery: e.target.value as typeof d.recovery })} className="mt-1 block w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[12px] normal-case tracking-normal text-white ring-1 ring-white/10" style={mono}>
            {veh.recovery.map((r) => (
              <option key={r} value={r} className="bg-[#0b0d12]">
                {RECOVERY_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 space-y-2">
        <Slider label="Payload mass" value={d.mass} min={50} max={Math.max(150_000, p.mass * 2)} step={d.mass < 2000 ? 10 : 50} unit="kg" disabled={busy} onChange={(v) => mc.setDraft({ mass: v })} log />
        {editableOrbit && (
          <>
            <Slider label="Perigee" value={d.hp} min={160} max={36_000} step={5} unit="km" disabled={busy} onChange={(v) => mc.setDraft({ hp: v, ha: Math.max(v, d.ha) })} log />
            <Slider label="Apogee" value={d.ha} min={160} max={40_000} step={5} unit="km" disabled={busy} onChange={(v) => mc.setDraft({ ha: v, hp: Math.min(v, d.hp) })} log />
            {d.payload === "custom" && <Slider label="Inclination" value={d.inc} min={0} max={140} step={0.1} unit="°" disabled={busy} onChange={(v) => mc.setDraft({ inc: v })} />}
          </>
        )}
      </div>
      <div className="mt-2 rounded-lg bg-white/[0.03] p-2.5">
        <Stat k="Target" v={p.target.kind === "orbit" ? `${fmt(Math.min(d.hp, d.ha))} × ${fmt(Math.max(d.hp, d.ha))} km` : p.target.kind === "gto" ? "GTO 200 × 35,786 km" : p.target.dest === "mars" ? "Trans-Mars injection" : p.target.dest === "moon" ? "Trans-lunar injection" : p.target.dest === "l2" ? "Sun–Earth L2" : "Jupiter (MEGA)"} />
        <Stat k="Inclination" v={`${inc.toFixed(2)}°`} sub={`min ${minInclination(site)}° from ${site.short}`} />
        <Stat k="Launch azimuth" v={chooseAzimuth(site, inc) ? `${chooseAzimuth(site, inc)!.groundDeg.toFixed(1)}°` : "outside corridor"} color={chooseAzimuth(site, inc) ? undefined : BAD} />
        <Stat k="Weather (L-12h fcst)" v={w.go ? `GO · ${w.pov}% violation` : `NO-GO · ${w.pov}%`} color={w.go ? ACCENT : WARN} />
      </div>
      {mars && (
        <div className="mt-2 rounded-lg p-2.5 ring-1" style={{ background: mars.open ? "rgba(200,255,61,.07)" : "rgba(255,176,32,.08)", borderColor: "transparent", boxShadow: `inset 0 0 0 1px ${mars.open ? "rgba(200,255,61,.35)" : "rgba(255,176,32,.35)"}` }}>
          <p className="text-[11.5px] text-white/80">
            Mars window: optimum <b style={mono}>{dateStr(mars.win.launch)}</b>
            {mars.open ? ` · open, C3 ${mars.c3.toFixed(1)} km²/s²` : ` · opens in ${fmt(mars.win.launch - 21 - jd)} days`}
          </p>
          {!mars.open && (
            <Btn className="mt-2 w-full" tone="warn" onClick={() => mc.warpToWindow()} disabled={busy}>
              Advance the clock to the window
            </Btn>
          )}
        </div>
      )}

      <H right={predicting ? <span className="text-[10px] text-white/50" style={mono}>computing…</span> : null}>4 · Flight dynamics</H>
      {err ? (
        <p className="rounded-lg bg-[#ff4d5e]/10 p-2.5 text-[12px] text-[#ff8a95] ring-1 ring-[#ff4d5e]/30">{err}</p>
      ) : pr ? (
        <div className={`rounded-lg p-2.5 ring-1 ${pr.ok ? "bg-[#c8ff3d]/[0.05] ring-[#c8ff3d]/25" : "bg-[#ffb020]/[0.07] ring-[#ffb020]/30"}`}>
          <p className="mb-1 text-[12px] font-semibold" style={{ color: pr.ok ? ACCENT : WARN }}>
            {pr.ok ? (pr.events.some((e) => e.id === "depl") ? "Reaches a lower orbit than planned" : "Trajectory closes") : `Does not close — ${pr.why}`}
          </p>
          {el && <Stat k="Predicted orbit" v={el.e < 1 ? `${fmt(O.periapsis(el))} × ${fmt(O.apoapsis(el))} km` : `C3 ${(-O.MU / el.a).toFixed(1)} km²/s²`} sub={`${((el.i * 180) / Math.PI).toFixed(2)}°`} />}
          <Stat k="Upper-stage margin" v={`${(pr.residualFrac * 100).toFixed(1)} %`} sub={`${fmt(pr.residual)} kg`} color={pr.residualFrac < 0.01 ? WARN : undefined} />
          <Stat k="Max-Q" v={`${pr.qMax.toFixed(1)} kPa`} sub={fmtT(pr.qMaxT)} />
          <Stat k="Peak acceleration" v={`${pr.maxG.toFixed(2)} g`} />
          {pr.events.filter((e) => /^(meco|seco1|seco2|deploy)$/.test(e.id)).map((e) => (
            <Stat key={e.id} k={e.id === "deploy" ? (p.crew ? "Spacecraft sep" : "Payload deploy") : e.id.toUpperCase().replace("SECO", "SECO-")} v={fmtT(e.t)} />
          ))}
          {landing?.map((b) => (
            <Stat key={b.label} k={b.label} v={b.outcome === "landed" ? `lands ${b.lz ? "· " + b.lz.slice(0, 22) : ""}` : b.outcome === "splash" ? "splashdown" : "lost"} color={b.outcome === "lost" ? BAD : ACCENT} />
          ))}
          {!pr.ok && pr.shortfall > 0 && <p className="mt-1 text-[11px] text-white/55">Short by {fmt(pr.shortfall)} m/s. Lighten the payload, expend the booster or pick a bigger rocket.</p>}
        </div>
      ) : null}
      {note && <p className="mt-2 text-[11px] leading-relaxed text-white/45">{note}</p>}
      <label className="mt-3 block text-[10px] uppercase tracking-[0.12em] text-white/45">
        Mission name
        <input
          disabled={busy}
          value={d.name}
          placeholder={`ODY-${counter} · ${p.short}`}
          onChange={(e) => useMC.getState().set({ draft: { ...d, name: e.target.value.slice(0, 40) } })}
          className="mt-1 block w-full rounded-md bg-white/[0.06] px-2 py-1.5 text-[12px] normal-case tracking-normal text-white ring-1 ring-white/10 placeholder:text-white/30"
          style={mono}
        />
      </label>
      <button
        type="button"
        disabled={busy || !!err || !pr}
        onClick={() => {
          mc.unlock();
          mc.startCount();
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#c8ff3d] py-3 text-[12.5px] font-bold uppercase tracking-[0.16em] text-[#0b0d12] transition-transform active:scale-[0.98] disabled:opacity-35"
        style={mono}
      >
        {busy ? "Mission in work" : "Pick up the count · T−45:00"} →
      </button>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange, disabled, log }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; disabled?: boolean; log?: boolean }) {
  const toS = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromS = (s: number) => {
    const v = log ? min * Math.pow(max / min, s) : min + s * (max - min);
    return Math.round(v / step) * step;
  };
  return (
    <label className="block">
      <span className="flex justify-between text-[10px] uppercase tracking-[0.12em] text-white/45">
        {label}
        <span className="normal-case tracking-normal text-white/85" style={mono}>
          {fmt(value, step < 1 ? 1 : 0)} {unit}
        </span>
      </span>
      <input type="range" disabled={disabled} min={0} max={1000} value={Math.round(toS(value) * 1000)} onChange={(e) => onChange(fromS(+e.target.value / 1000))} className="mc-range mt-1 w-full" />
    </label>
  );
}

// ———————————————————————————— countdown & flight ————————————————————————————

function LaunchTab() {
  const ops = useMC((s) => s.ops);
  const tele = useMC((s) => s.tele);
  const draft = useMC((s) => s.draft);
  const feedCam = useMC((s) => s.feedCam);
  const jd = useMC((s) => s.jd);
  const [armed, setArmed] = useState(false);
  const pd = mc.pending;
  const f = mc.flight;
  const site = siteById[(pd?.draft ?? draft).site];
  const w = weather(site, jd, mc.badWeather);
  if (ops.phase === "idle")
    return (
      <div className="py-6 text-center">
        <p className="text-[13px] text-white/70">No mission in work.</p>
        <p className="mt-1 text-[11.5px] text-white/45">Plan one in the Plan tab, then pick up the count.</p>
        <Btn className="mx-auto mt-4" onClick={() => useMC.getState().set({ tab: "plan" })}>
          Go to planning
        </Btn>
      </div>
    );
  const veh = vehicleById[(pd?.draft ?? draft).vehicle];
  const counting = ops.phase === "count";
  const flying = ops.phase === "flight";
  const tone = ops.holding ? WARN : flying ? ACCENT : counting ? CYAN : ops.result === "success" ? ACCENT : BAD;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
        {ops.mission}
      </p>
      <p className="text-[11.5px] text-white/50">
        {veh.name} · {site.name}
      </p>
      <div className="mt-2 flex items-end justify-between rounded-lg bg-black/30 px-3 py-2 ring-1 ring-white/10">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em]" style={{ ...mono, color: tone }}>
            {counting ? (ops.holding ? "Holding" : "Counting") : flying ? "In flight" : ops.result === "success" ? "Mission success" : ops.result}
          </p>
          <p className="text-[34px] font-bold leading-none tabular-nums" style={{ ...mono, color: tone }}>
            {counting ? `T−${clock(ops.tMinus)}` : f ? `T+${clock(f.t)}` : "—"}
          </p>
        </div>
        <div className="text-right text-[10.5px] text-white/50" style={mono}>
          <p>GMT {gmtStamp(jd)}</p>
          <p>{(() => { try { return O.dateOf(jd).toLocaleTimeString("en-GB", { timeZone: site.tz, hour12: false }); } catch { return ""; } })()} local</p>
        </div>
      </div>
      {ops.holding && <p className="mt-2 rounded-md bg-[#ffb020]/10 px-2.5 py-1.5 text-[11.5px] text-[#ffc861] ring-1 ring-[#ffb020]/30">{ops.hold}</p>}

      {counting && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {(ops.pollState === "due" || ops.pollState === "nogo") && (
              <Btn className="col-span-2" tone="go" onClick={() => mc.conductPoll()}>
                {ops.pollState === "nogo" ? "Re-poll the room" : "Conduct go / no-go poll"}
              </Btn>
            )}
            {ops.holding ? (
              <Btn onClick={() => mc.resume()} disabled={ops.pollState === "due" || ops.pollState === "nogo" || ops.pollState === "running"} tone="go">
                Resume count
              </Btn>
            ) : (
              <Btn onClick={() => mc.holdCount()} tone="warn">
                Hold
              </Btn>
            )}
            <Btn onClick={() => mc.recycle()} disabled={ops.tMinus > 600}>
              Recycle T−10
            </Btn>
            <Btn onClick={() => mc.skipTo(ops.pollState === "go" ? 600 : 2281)} disabled={ops.holding || (ops.pollState !== "go" && ops.tMinus <= 2281)}>
              Skip ›› T−{ops.pollState === "go" ? "10:00" : "38:00"}
            </Btn>
            <Btn onClick={() => mc.skipTo(60)} disabled={ops.holding || ops.pollState !== "go" || ops.tMinus <= 60}>
              Skip ›› T−1:00
            </Btn>
            <Btn className="col-span-2" tone="bad" onClick={() => mc.scrub("Scrubbed by the Launch Director")}>
              Scrub
            </Btn>
          </div>
          {ops.poll.length > 0 && (
            <>
              <H>Go / no-go poll</H>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {ops.poll.map((p) => (
                  <div key={p.who} className="flex items-center gap-2 text-[11px]">
                    <Light on={!!p.answer} color={p.answer === "nogo" ? BAD : ACCENT} />
                    <span className="flex-1 text-white/75">{p.label}</span>
                    <span className="text-[10px] uppercase" style={{ ...mono, color: p.answer === "nogo" ? BAD : p.answer ? ACCENT : "rgba(255,255,255,.3)" }}>
                      {p.answer === "go" ? "go" : p.answer === "nogo" ? "no-go" : "…"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <H>Launch commit criteria · weather</H>
          {w.rules.map((r) => (
            <Stat key={r.name} k={r.name} v={r.value} color={r.ok ? undefined : BAD} />
          ))}
          <Stat k="Recovery sea state" v={`${w.sea.toFixed(1)} m`} color={w.recoveryGo ? undefined : WARN} />
        </>
      )}

      {(flying || ops.phase === "post") && f && tele && (
        <>
          <H>Live telemetry</H>
          <Stat k="Altitude" v={`${fmt(tele.alt, 1)} km`} />
          <Stat k="Velocity" v={`${fmt(tele.vel)} m/s`} sub={`${fmt(tele.vs * 3.6)} km/h surface`} />
          <Stat k="Downrange" v={`${fmt(tele.dr)} km`} />
          <Stat k="Acceleration" v={`${tele.acc.toFixed(2)} g`} />
          <Stat k="Dynamic pressure" v={`${tele.q.toFixed(1)} kPa`} sub={tele.mach < 30 ? `Mach ${tele.mach.toFixed(1)}` : ""} />
          <Stat k="Throttle" v={`${(tele.thr * 100).toFixed(0)} %`} />
          <Stat k="Stage" v={tele.stage} />
          {tele.alt > 80 && <Stat k="Orbit" v={isFinite(tele.ha) && tele.ha < 1e6 ? `${fmt(tele.hp)} × ${fmt(tele.ha)} km` : "escape"} sub={`${tele.inc.toFixed(2)}°`} />}
          {tele.boosters.map((b) => (
            <Stat key={b.label} k={b.label} v={b.phase === "landed" ? "landed" : b.phase === "lost" ? "lost" : `${fmt(b.alt, 1)} km · ${fmt(b.vel)} m/s`} color={b.phase === "landed" ? ACCENT : b.phase === "lost" ? BAD : WARN} />
          ))}
          {flying && f.result === "flying" && (
            <>
              <H>Flight director</H>
              <div className="flex gap-1.5">
                <Btn className="flex-1" onClick={() => setArmed(!armed)} active={armed}>
                  {armed ? "Armed" : f.plan.crewed ? "Arm abort" : "Arm FTS"}
                </Btn>
                <Btn
                  className="flex-1"
                  tone="bad"
                  disabled={!armed}
                  onClick={() => {
                    mc.abort();
                    setArmed(false);
                  }}
                >
                  {f.plan.crewed ? "Abort" : "Terminate"}
                </Btn>
              </div>
              <H>SimSup · inject a failure</H>
              <div className="grid grid-cols-3 gap-1.5">
                {(["engine", "guidance", "comm"] as SimFailure[]).map((k) => (
                  <Btn key={k} onClick={() => mc.inject(k)}>
                    {k === "engine" ? "Engine out" : k === "guidance" ? "IMU fail" : "Telemetry"}
                  </Btn>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {ops.phase === "post" && (
        <div className="mt-3 rounded-lg p-3 ring-1" style={{ boxShadow: `inset 0 0 0 1px ${tone}55`, background: `${tone}12` }}>
          <p className="text-[13px] font-semibold" style={{ color: tone }}>
            {ops.result === "success" ? "Mission success" : ops.result === "partial" ? "Partial success" : ops.result === "abort" ? "Abort — crew recovered" : "Mission failure"}
          </p>
          <p className="mt-1 text-[11.5px] text-white/60">{f?.why || "Spacecraft handed over to operations."}</p>
          <Btn className="mt-3 w-full" tone="go" onClick={() => mc.closeMission()}>
            Close out · go to fleet ops
          </Btn>
        </div>
      )}
      <H>Launch camera</H>
      <div className="grid grid-cols-5 gap-1">
        {(["auto", "pad", "tracking", "onboard", "booster"] as const).map((c) => (
          <Btn key={c} className="px-1 text-[9px]" active={feedCam === c} onClick={() => useMC.getState().set({ feedCam: c })}>
            {c}
          </Btn>
        ))}
      </div>
      {(counting || flying) && (
        <>
          <H>SimSup · weather case</H>
          <Btn className="w-full" active={mc.badWeather} onClick={() => mc.inject("weather")}>
            {mc.badWeather ? "Clear the cumulus case" : "Inject cumulus over the range"}
          </Btn>
        </>
      )}
    </div>
  );
}

// ———————————————————————————— fleet operations ————————————————————————————

function FleetTab() {
  const fleet = useMC((s) => s.fleet);
  const sel = useMC((s) => s.selected);
  const jd = useMC((s) => s.jd);
  const [filter, setFilter] = useState<"ours" | "all">("ours");
  const list = fleet.filter((s) => s.kind !== "constellation" && (filter === "all" || s.owner === "ours"));
  const sat = fleet.find((s) => s.id === sel);
  return (
    <div>
      <div className="flex gap-1">
        <Btn active={filter === "ours"} onClick={() => setFilter("ours")}>
          Our spacecraft · {fleet.filter((s) => s.owner === "ours").length}
        </Btn>
        <Btn active={filter === "all"} onClick={() => setFilter("all")}>
          All tracked
        </Btn>
      </div>
      <ul className="mt-2 max-h-[30vh] space-y-0.5 overflow-y-auto pr-1">
        {list.length === 0 && <li className="py-3 text-center text-[11.5px] text-white/45">Nothing launched yet. Plan a mission!</li>}
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => useMC.getState().set({ selected: s.id === sel ? null : s.id })} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${s.id === sel ? "bg-white/10" : "hover:bg-white/[0.05]"}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 truncate text-[12px] text-white/85">{s.name}</span>
              <span className="text-[9.5px] uppercase" style={{ ...mono, color: s.status === "reentered" ? "rgba(255,255,255,.3)" : s.burns.length ? WARN : s.status === "safe" ? WARN : "rgba(255,255,255,.45)" }}>
                {s.burns.length ? "burn" : s.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {sat && <SatDetail sat={sat} jd={jd} />}
    </div>
  );
}

function SatDetail({ sat, jd }: { sat: Sat; jd: number }) {
  const [kind, setKind] = useState<Burn["kind"]>("apo");
  const [target, setTarget] = useState(1000);
  const now = satNow(sat, jd);
  const el = sat.el;
  const ours = sat.owner === "ours";
  const links = network(jd, [sat]);
  const orbital = el && el.e < 1 && now?.geo;
  const battery = now?.eclipse ? 78 + Math.sin(jd * 900) * 4 : 96 + Math.sin(jd * 700) * 2;
  const rover = sat.kind === "marsrover" && sat.status === "arrived";
  const lunarHandoff = sat.kind === "lunar" && sat.status === "lunar";
  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] p-3 ring-1 ring-white/10">
      <p className="text-[10px] uppercase tracking-[0.16em] text-white/45" style={mono}>
        {ours ? `${sat.missionId ?? ""}` : sat.agency}
      </p>
      <p className="text-[15px] font-semibold text-white">{sat.name}</p>
      <div className="mt-2">
        <Stat k="Status" v={sat.status} color={sat.status === "safe" ? WARN : ACCENT} />
        {sat.where && <Stat k="Where" v={sat.where} />}
        {orbital && now && el && (
          <>
            <Stat k="Altitude" v={`${fmt(now.geo!.alt, 1)} km`} sub={now.eclipse ? "eclipse" : "sunlit"} />
            <Stat k="Velocity" v={`${fmt(O.len(now.v!) * 1000)} m/s`} />
            <Stat k="Perigee × apogee" v={`${fmt(O.periapsis(el))} × ${fmt(O.apoapsis(el))} km`} />
            <Stat k="Inclination · ecc" v={`${((el.i * 180) / Math.PI).toFixed(2)}° · ${el.e.toFixed(4)}`} />
            <Stat k="Period" v={`${(O.period(el.a) / 60).toFixed(1)} min`} />
            <Stat k="Sub-satellite point" v={`${((now.geo!.lat * 180) / Math.PI).toFixed(2)}°, ${((now.geo!.lon * 180) / Math.PI).toFixed(2)}°`} />
          </>
        )}
        {!orbital && now && <Stat k="Distance" v={now.dist > 1.5e7 ? `${(now.dist / 149597870.7).toFixed(3)} AU` : `${fmt(now.dist)} km`} sub={`light ${now.dist / 299792 > 90 ? (now.dist / 299792 / 60).toFixed(1) + " min" : (now.dist / 299792).toFixed(1) + " s"}`} />}
        {sat.arriveJd && sat.arriveJd > jd && <Stat k="Arrival" v={dateStr(sat.arriveJd)} sub={`in ${fmt(sat.arriveJd - jd, 1)} d`} />}
        <Stat k="Ground contact" v={links.length ? links.map((l) => l.station.short).join(", ") : el && el.a < 9000 ? "TDRS relay" : "LOS"} color={links.length ? "#ff6fb1" : undefined} />
        {ours && (
          <>
            <Stat k="Δv remaining" v={`${fmt(dvBudget(sat) * 1000)} m/s`} sub={`${fmt(sat.mass - sat.dry)} kg prop`} />
            <Stat k="Power · battery" v={`${fmt(sat.power * (now?.eclipse ? 0 : 1))} W`} sub={`${battery.toFixed(0)} % SOC`} />
            {sat.crew && <Stat k="Crew" v={`${sat.crew} aboard`} />}
          </>
        )}
      </div>
      {rover && (
        <Link href="/rover?world=mars&drive" className="mt-3 flex items-center justify-center rounded-lg bg-[#ff7a45] py-2.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#0b0d12]" style={mono}>
          Take the wheel on Mars →
        </Link>
      )}
      {lunarHandoff && (
        <Link href="/rover?world=moon&land" className="mt-3 flex items-center justify-center rounded-lg bg-white/85 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#0b0d12]" style={mono}>
          Send a rover down to the Moon →
        </Link>
      )}
      {ours && orbital && el && sat.status !== "docked" && (
        <>
          <H>Manoeuvre planning</H>
          <div className="grid grid-cols-2 gap-1.5">
            {(sat.status === "transfer" && (sat.kind === "geo" || sat.kind === "weather")) && (
              <Btn className="col-span-2" tone="go" onClick={() => mc.planBurn(sat.id, "geo")}>
                Apogee burn → geostationary
              </Btn>
            )}
            <Btn onClick={() => mc.planBurn(sat.id, "circ")}>Circularise</Btn>
            <Btn onClick={() => mc.planBurn(sat.id, "avoid")}>Debris avoid</Btn>
            <Btn onClick={() => mc.planBurn(sat.id, "deorbit")} tone="warn">
              Deorbit
            </Btn>
            <Btn onClick={() => mc.toggleKeep(sat.id)} active={sat.keep}>
              Station-keep
            </Btn>
          </div>
          <div className="mt-2 flex gap-1.5">
            <select value={kind} onChange={(e) => setKind(e.target.value as Burn["kind"])} className="flex-1 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-white ring-1 ring-white/10" style={mono}>
              <option value="apo" className="bg-[#0b0d12]">Hohmann to altitude</option>
              <option value="peri" className="bg-[#0b0d12]">Set perigee</option>
              <option value="plane" className="bg-[#0b0d12]">Plane change (°)</option>
            </select>
            <input type="number" value={target} onChange={(e) => setTarget(+e.target.value)} className="w-24 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-white ring-1 ring-white/10" style={mono} />
            <Btn onClick={() => mc.planBurn(sat.id, kind, target)} tone="go">
              Add
            </Btn>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Btn onClick={() => mc.safeMode(sat.id)} active={sat.status === "safe"}>
              {sat.status === "safe" ? "Exit safe mode" : "Safe mode"}
            </Btn>
            <Btn onClick={() => mc.warpToNextBurn()} disabled={!sat.burns.length}>
              Warp to burn
            </Btn>
          </div>
        </>
      )}
      {sat.burns.length > 0 && (
        <>
          <H right={<Btn onClick={() => mc.cancelBurns(sat.id)}>Clear</Btn>}>Planned burns</H>
          {sat.burns.map((b) => (
            <Stat key={b.id} k={b.label} v={`in ${clock((b.at - jd) * 86400)}`} sub={b.dv[0] ? `Δv ${fmt(b.dv[0] * 1000)} m/s` : "Δv at burn"} color={WARN} />
          ))}
        </>
      )}
      {ours && (sat.status === "reentered" || sat.status === "arrived") && (
        <Btn className="mt-3 w-full" onClick={() => mc.remove(sat.id)}>
          Archive spacecraft
        </Btn>
      )}
    </div>
  );
}

function HistoryTab() {
  const history = useMC((s) => s.history);
  const flown = history.filter((m) => m.result !== "scrub");
  const ok = flown.filter((m) => m.result === "success").length;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Launches", String(flown.length)],
          ["Success", flown.length ? `${Math.round((ok / flown.length) * 100)}%` : "—"],
          ["Scrubs", String(history.length - flown.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.04] p-2 text-center">
            <p className="text-[18px] font-bold text-white" style={mono}>
              {v}
            </p>
            <p className="text-[9.5px] uppercase tracking-[0.14em] text-white/45">{k}</p>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {history.length === 0 && <li className="py-4 text-center text-[11.5px] text-white/45">The mission log is empty.</li>}
        {history.map((m) => {
          const c = m.result === "success" ? ACCENT : m.result === "partial" ? WARN : m.result === "scrub" ? "rgba(255,255,255,.4)" : BAD;
          return (
            <li key={m.id} className="rounded-lg bg-white/[0.03] p-2.5 ring-1 ring-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-white">{m.name}</span>
                <span className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider" style={{ ...mono, color: c, boxShadow: `inset 0 0 0 1px ${c}` }}>
                  {m.result}
                </span>
              </div>
              <p className="mt-0.5 text-[10.5px] text-white/45" style={mono}>
                {dateStr(m.jd)} · {vehicleById[m.vehicle].name} · {siteById[m.site].short}
              </p>
              <p className="mt-1 text-[11px] text-white/60">
                {m.summary}
                {m.recovery ? ` · ${m.recovery}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ———————————————————————————— loop, strip, chrome ————————————————————————————

function Loop() {
  const loop = useMC((s) => s.loop);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [loop.length]);
  return (
    <Panel className="flex max-h-[36vh] w-[min(360px,calc(100vw-32px))] flex-col p-3">
      <p className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
        Flight director loop
        <span className="flex items-center gap-1.5 text-[#ff4d5e]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4d5e]" />
          live
        </span>
      </p>
      <div ref={ref} className="space-y-1.5 overflow-y-auto pr-1">
        {loop.slice(-40).map((l) => (
          <p key={l.id} className="text-[11.5px] leading-snug">
            <span className="mr-1.5 text-[10px] font-bold" style={{ ...mono, color: l.tone === "bad" ? BAD : l.tone === "warn" ? WARN : l.tone === "good" ? ACCENT : l.who === "SIM" ? "#ff6fb1" : "#ffd166" }}>
              {l.met !== null ? fmtT(l.met) : gmtStamp(l.jd).slice(4, 12)} {l.who}
            </span>
            <span className="text-white/75">{l.text}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

function TeleStrip() {
  const tele = useMC((s) => s.tele);
  const tl = useMC((s) => s.timeline);
  const phase = useMC((s) => s.ops.phase);
  const ops = useMC((s) => s.ops);
  if (phase === "idle") return null;
  const f = mc.flight;
  const met = f ? f.t : -ops.tMinus;
  const span = Math.max(600, ...tl.map((e) => e.t)) * 1.02;
  const b = tele?.boosters[tele.boosters.length - 1];
  const s1 = b && b.phase !== "landed" && b.phase !== "lost" ? b : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3 max-md:hidden">
      <div className="pointer-events-auto flex w-[min(980px,calc(100vw-760px))] min-w-[560px] items-center gap-4 rounded-2xl border border-white/10 bg-[#07090c]/80 px-5 py-2.5 backdrop-blur-md">
        <div className="w-[120px]" style={mono}>
          <p className="text-[9px] uppercase tracking-[0.16em] text-white/45">{s1 ? s1.label : "Stage 1"}</p>
          <p className="text-[15px] font-bold text-white tabular-nums">{s1 ? `${fmt(s1.vel * 3.6)}` : f?.cOn && tele ? fmt(tele.vs * 3.6) : "—"} <span className="text-[9px] text-white/45">KM/H</span></p>
          <p className="text-[15px] font-bold text-white tabular-nums">{s1 ? fmt(s1.alt, 1) : f?.cOn && tele ? fmt(tele.alt, 1) : "—"} <span className="text-[9px] text-white/45">KM</span></p>
        </div>
        <div className="relative h-14 flex-1">
          <p className="absolute left-1/2 top-0 -translate-x-1/2 text-[16px] font-bold tabular-nums text-white" style={mono}>
            {met < 0 ? `T−${clock(-met)}` : `T+${clock(met)}`}
          </p>
          <div className="absolute inset-x-0 top-9 h-px bg-white/25" />
          <div className="absolute top-9 h-px" style={{ left: 0, width: `${Math.max(0, Math.min(1, met / span)) * 100}%`, background: ACCENT }} />
          {tl.map((e) => (
            <div key={e.id} className="absolute top-[30px] -translate-x-1/2 text-center" style={{ left: `${(e.t / span) * 100}%` }} title={`${e.label} · ${fmtT(e.t)}`}>
              <span className="mx-auto block h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: e.done ? ACCENT : "rgba(255,255,255,.45)", background: e.done ? ACCENT : "#07090c" }} />
            </div>
          ))}
          {(() => {
            const next = tl.find((e) => !e.done);
            return next ? (
              <p className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9.5px] uppercase tracking-[0.14em] text-white/55" style={mono}>
                next: {next.label} {met >= 0 ? `in ${clock(Math.max(0, next.t - met))}` : ""}
              </p>
            ) : null;
          })()}
        </div>
        <div className="w-[120px] text-right" style={mono}>
          <p className="text-[9px] uppercase tracking-[0.16em] text-white/45">{f && !f.cOn ? "Stage 2" : "Vehicle"}</p>
          <p className="text-[15px] font-bold text-white tabular-nums">{tele ? fmt(tele.vs * 3.6) : "0"} <span className="text-[9px] text-white/45">KM/H</span></p>
          <p className="text-[15px] font-bold text-white tabular-nums">{tele ? fmt(tele.alt, 1) : "0.0"} <span className="text-[9px] text-white/45">KM</span></p>
        </div>
      </div>
    </div>
  );
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "fd", label: "Flight" },
  { id: "front", label: "Trench" },
  { id: "overview", label: "Room" },
  { id: "gallery", label: "Gallery" },
];
const SCREEN_NAMES: Partial<Record<ViewId, string>> = {
  "s-feed": "Launch camera",
  "s-map": "World map · ground track",
  "s-traj": "Trajectory",
  "s-clock": "Countdown clock",
  "s-vehicle": "Vehicle systems",
  "s-orbit": "Orbit view",
  "s-weather": "Launch weather",
  "s-dsn": "Deep Space Network",
  "s-fleet": "Spacecraft status",
};

function TopBar() {
  const jd = useMC((s) => s.jd);
  const warp = useMC((s) => s.warp);
  const view = useMC((s) => s.view);
  const sound = useMC((s) => s.sound);
  const voice = useMC((s) => s.voice);
  const panels = useMC((s) => s.panels);
  const ops = useMC((s) => s.ops);
  const set = useMC.getState().set;
  const f = mc.flight;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
      <div className="pointer-events-auto flex items-center gap-3">
        <Link href="/rover" className="flex h-8 items-center rounded-lg bg-[#0b0d12]/70 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/80 ring-1 ring-white/12 backdrop-blur hover:text-white" style={mono}>
          ←<span className="ml-1.5 max-sm:hidden">Planets</span>
        </Link>
        <div>
          <p className="text-[13px] font-semibold leading-tight text-white">Mission Control</p>
          <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/45" style={mono}>
            Flight control room 1 · GMT {gmtStamp(jd)}
          </p>
        </div>
      </div>
      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
        <div className="flex items-center gap-1 rounded-lg bg-[#0b0d12]/70 p-1 ring-1 ring-white/10 backdrop-blur">
          <span className="px-1.5 text-[10px] uppercase tracking-[0.12em] text-white/45" style={mono}>
            {ops.phase === "count" ? `T−${clock(ops.tMinus)}` : f && ops.phase !== "idle" ? `T+${clock(f.t)}` : "Time"}
          </span>
          <Btn onClick={() => mc.setWarp(warp - 1)} title="Slower" className="h-6 px-2">
            −
          </Btn>
          <span className="w-[66px] text-center text-[11px] font-semibold" style={{ ...mono, color: warp ? WARN : "white" }}>
            ×{fmt(WARPS[warp])}
          </span>
          <Btn onClick={() => mc.setWarp(warp + 1)} title="Faster (limited during powered flight)" className="h-6 px-2">
            +
          </Btn>
          <Btn onClick={() => mc.setWarp(0)} title="Real time" className="h-6 px-2">
            1×
          </Btn>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#0b0d12]/70 p-1 ring-1 ring-white/10 backdrop-blur max-md:hidden">
          {VIEWS.map((v) => (
            <Btn key={v.id} onClick={() => set({ view: v.id })} active={view === v.id} className="h-6 px-2">
              {v.label}
            </Btn>
          ))}
        </div>
        <Btn onClick={() => set({ panels: !panels })} active={!panels} title="Hide the panels">
          {panels ? "◧" : "◨"}
        </Btn>
        <Btn
          onClick={() => {
            set({ voice: !voice });
            mc.audio.setVoice(!voice);
          }}
          active={!voice}
          title={voice ? "Voice loop on" : "Voice loop off"}
        >
          {voice ? "🎧" : "✕🎧"}
        </Btn>
        <Btn
          onClick={() => {
            set({ sound: !sound });
            mc.audio.setMuted(sound);
          }}
          active={!sound}
          title={sound ? "Mute" : "Unmute"}
        >
          {sound ? "♪" : "✕♪"}
        </Btn>
        <Btn onClick={() => set({ help: !useMC.getState().help })} title="How it works">
          ?
        </Btn>
      </div>
    </div>
  );
}

function Help() {
  return (
    <Panel className="absolute left-1/2 top-1/2 z-20 max-h-[80vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5">
      <h3 className="text-lg font-semibold text-white">Running the room</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-4 text-[12.5px] leading-relaxed text-white/70">
        <li>
          <b className="text-white">Plan.</b> Pick a payload, a rocket, a pad and a booster recovery mode. Flight dynamics flies the whole ascent in the background and tells you if the trajectory closes, with the margin left in the upper stage.
        </li>
        <li>
          <b className="text-white">Count.</b> Pick up the count at T−45:00. At T−38:00 the count holds until you poll the room — every console answers go or no-go (weather, range, recovery, flight dynamics…). Hold, recycle or scrub like a real launch director.
        </li>
        <li>
          <b className="text-white">Fly.</b> Watch the wall: live tracking and onboard cameras, the ground track, trajectory against prediction, engine status. Boosters fly back and land. Arm and fire an abort, or inject failures as SimSup.
        </li>
        <li>
          <b className="text-white">Operate.</b> Once deployed, spacecraft are yours: raise GTO satellites to geostationary orbit, plan Hohmann transfers and plane changes, keep station against drag, deorbit. Interplanetary probes cruise to Mars, the Moon, L2 or Jupiter — a Mars rover can be driven when it lands.
        </li>
      </ol>
      <ul className="mt-4 space-y-1 text-[12px] text-white/60">
        <li>
          <b className="text-white" style={mono}>Click a screen</b> to walk up to it · <b className="text-white" style={mono}>Esc</b> back to the Flight Director&apos;s console
        </li>
        <li>
          <b className="text-white" style={mono}>Drag</b> to look around · <b className="text-white" style={mono}>scroll</b> to zoom
        </li>
        <li>
          <b className="text-white" style={mono}>Time warp</b> speeds everything up — capped at ×10 while engines burn and ×100 in the count
        </li>
      </ul>
      <p className="mt-4 text-[11.5px] leading-relaxed text-white/45">
        Everything is computed: US Standard Atmosphere, thrust and Isp from each vehicle&apos;s published data, closed-loop guidance, Kepler orbits with J2 precession, thermospheric drag, the real Sun, Moon and planet positions, and launch windows to Mars.
      </p>
      <div className="mt-4 flex justify-end">
        <Btn onClick={() => useMC.getState().set({ help: false })}>Got it</Btn>
      </div>
    </Panel>
  );
}

export default function View() {
  const ready = useMC((s) => s.ready);
  const progress = useMC((s) => s.progress);
  const tab = useMC((s) => s.tab);
  const view = useMC((s) => s.view);
  const panels = useMC((s) => s.panels);
  const help = useMC((s) => s.help);
  const phase = useMC((s) => s.ops.phase);
  const set = useMC.getState().set;

  useEffect(() => {
    useMC.getState().set({ ready: false, progress: 0, view: "overview", help: false });
    // a slow pan from the gallery down to the Flight Director's seat
    const id = setTimeout(() => useMC.getState().set({ view: "fd" }), 2600);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const unlock = () => mc.unlock();
    addEventListener("pointerdown", unlock, { once: true });
    addEventListener("keydown", unlock, { once: true });
    return () => {
      removeEventListener("pointerdown", unlock);
      removeEventListener("keydown", unlock);
    };
  }, []);

  const tabs: { id: typeof tab; label: string; dot?: boolean }[] = [
    { id: "plan", label: "Plan" },
    { id: "launch", label: phase === "flight" ? "Flight" : "Launch", dot: phase !== "idle" },
    { id: "fleet", label: "Fleet ops" },
    { id: "history", label: "Log" },
  ];
  const screenView = view.startsWith("s-");

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" style={{ fontFamily: "var(--font-inter-tight), system-ui, sans-serif" }}>
      <style>{`
        .mc-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 4px; background: rgba(255,255,255,.12); outline: none; }
        .mc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #c8ff3d; cursor: pointer; box-shadow: 0 0 0 3px rgba(200,255,61,.18); }
        .mc-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: #c8ff3d; cursor: pointer; }
        .mc-scroll::-webkit-scrollbar { width: 6px } .mc-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 3px }
      `}</style>
      <div className="absolute inset-0">
        <Scene />
      </div>

      <div className="pointer-events-none absolute inset-0">
        <TopBar />
        {panels && !screenView && (
          <Panel className="mc-scroll absolute bottom-3 left-4 top-[64px] flex w-[min(370px,calc(100vw-32px))] flex-col max-md:top-auto max-md:max-h-[55vh]">
            <div className="flex gap-1 border-b border-white/10 p-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set({ tab: t.id })}
                  className={`relative flex-1 rounded-md py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors ${tab === t.id ? "bg-white text-[#0b0d12]" : "text-white/65 hover:text-white"}`}
                  style={mono}
                >
                  {t.label}
                  {t.dot && tab !== t.id && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4d5e]" />}
                </button>
              ))}
            </div>
            <div className="mc-scroll flex-1 overflow-y-auto p-3">
              {tab === "plan" && <PlanTab />}
              {tab === "launch" && <LaunchTab />}
              {tab === "fleet" && <FleetTab />}
              {tab === "history" && <HistoryTab />}
            </div>
          </Panel>
        )}
        {panels && !screenView && (
          <div className="absolute right-4 top-[64px] max-lg:hidden">
            <Loop />
          </div>
        )}
        {screenView && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
            <Panel className="flex items-center gap-3 px-3 py-2">
              <span className="text-[11px] uppercase tracking-[0.16em] text-white/70" style={mono}>
                {SCREEN_NAMES[view]}
              </span>
              <Btn onClick={() => set({ view: "fd" })}>Back to console · Esc</Btn>
            </Panel>
          </div>
        )}
        {!screenView && <TeleStrip />}
        {help && <Help />}
      </div>

      {/* loader */}
      <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black transition-opacity duration-1000 ${ready ? "opacity-0" : "opacity-100"}`}>
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/50" style={mono}>
          Odyssey · Mission operations
        </p>
        <p className="mt-2 text-2xl font-semibold text-white">Powering up the flight control room</p>
        <p className="mt-1 text-[12px] text-white/45">Loading the network, the fleet and the launch range…</p>
        <div className="mt-5 h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full transition-[width] duration-300" style={{ width: `${progress * 100}%`, background: ACCENT }} />
        </div>
      </div>
    </div>
  );
}

