"use client";

import { useProgress } from "@react-three/drei";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { groups, type Car, type CarPart, type PaintColor } from "@/content/cars";
import Dock, { Chip, Chips, ColorField, icons, lacquer, Slider, Swatch, Swatches, type DockItem } from "./Dock";
import { startEngine, type Engine } from "./engineSound";
import { decodeLook, encodeLook } from "./shareLook";
import type { CameraInfo } from "./ShowroomScene";
import {
  backdrops,
  brakeColors,
  cineShots,
  defaultTuning,
  liveries,
  liveryColors,
  moodById,
  moods,
  shots,
  type BackdropId,
  type LiveryId,
  type Look,
  type MoodId,
  type Pin,
  type Quality,
  type ShotId,
  type Tuning,
  type WeatherId,
  weathers,
} from "./studio";

const ShowroomScene = dynamic(() => import("./ShowroomScene"), { ssr: false });

const pad = (n: number) => String(n).padStart(2, "0");
const NONE: string[] = [];

/**
 * Exploded-view showroom for one car: click a part (or pick it from the index) to slide it out and
 * read about it. `switcher` is the car picker (/cars puts one at the bottom of the screen).
 */
export default function Showroom({
  car,
  switcher,
  onCycle,
  initialPart: given,
}: {
  car: Car;
  switcher?: ReactNode;
  /** step to the previous (-1) or next (1) car in the line-up */
  onCycle?: (d: number) => void;
  /** overrides ?part= (null after switching cars, so the new car starts assembled) */
  initialPart?: string | null;
}) {
  const partById = useMemo(() => Object.fromEntries(car.parts.map((p) => [p.id, p])) as Record<string, CarPart>, [car]);
  // the model's part groups → the part that owns them (all four wheels belong to "wheels")
  const ownerOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of car.parts) for (const id of p.members ?? [p.id]) m[id] = p.id;
    return m;
  }, [car]);
  const params = useSearchParams();
  const fromUrl = params.get("part");
  // a shared link's configuration, read once when the showroom opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shared = useMemo(() => decodeLook(params.get("look")), []);
  const initialPart = given === undefined ? fromUrl : given;
  // old links name a single wheel or door (?part=wheel_fl); they open its whole set
  const [selected, setSelected] = useState<string | null>(initialPart ? (ownerOf[initialPart] ?? null) : null);
  const [exploded, setExploded] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // the studio: lighting mood, paint, lamps, turntable, camera presets and the cinematic reel
  const [mood, setMood] = useState<MoodId>(shared.mood && moodById[shared.mood] ? shared.mood : "studio");
  const [paintIdx, setPaintIdx] = useState(shared.paintIdx !== undefined && car.paint.colors[shared.paintIdx] ? shared.paintIdx : 0);
  const [lights, setLights] = useState(!!shared.lights);
  const [turntable, setTurntable] = useState(true);
  const [shot, setShot] = useState<{ id: ShotId; n: number } | null>(null);
  const [activeShot, setActiveShot] = useState<ShotId | null>(null);
  const [cinematic, setCinematic] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [scene, setScene] = useState(0);
  // tools: dimension lines, the see-through body, photos, and the keys for all of it
  const [measure, setMeasure] = useState(false);
  const [xray, setXray] = useState(false);
  const [snap, setSnap] = useState({ n: 0, wallpaper: false });
  const flash = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  // the dock: doors, brakes, finish, livery, the cockpit, the stage, quality, sound and fine tuning
  const [panel, setPanel] = useState<string | null>(null);
  const [doors, setDoors] = useState(!!shared.doors);
  const [brake, setBrake] = useState(shared.brake ?? "");
  const [iridescent, setIridescent] = useState(!!shared.iridescent);
  const [livery, setLivery] = useState<LiveryId>(liveries.some((l) => l.id === shared.livery) ? shared.livery! : "none");
  const [liveryColor, setLiveryColor] = useState(shared.liveryColor ?? liveryColors[0].hex);
  const [interior, setInterior] = useState(false);
  const [grid, setGrid] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropId>(backdrops.some((b) => b.id === shared.backdrop) ? shared.backdrop! : "studio");
  const [quality, setQuality] = useState<Quality>(() => {
    try {
      return localStorage.getItem("showroom-quality") === "performance" ? "performance" : "quality";
    } catch {
      return "quality";
    }
  });
  const [tuning, setTuning] = useState<Tuning>(defaultTuning);
  const [custom, setCustom] = useState<PaintColor | null>(shared.custom?.hex ? shared.custom : null);
  const [sound, setSound] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const engine = useRef<Engine | null>(null);
  // the pose: drive, steering, stance and glass; the hotspots; the sky's hour; full screen
  const [drive, setDrive] = useState(false);
  const [steer, setSteer] = useState(shared.steer ?? 0);
  const [ride, setRide] = useState(shared.ride ?? 0);
  const [tint, setTint] = useState(shared.tint ?? 0);
  const [pinsOn, setPinsOn] = useState(false);
  const [sun, setSun] = useState(shared.sun ?? 0.6);
  const [fullscreen, setFullscreen] = useState(false);
  const [weather, setWeather] = useState<WeatherId>(weathers.some((w) => w.id === shared.weather) ? shared.weather! : "dry");
  const [aperture, setAperture] = useState(shared.aperture ?? 0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const toast = useCallback((msg: string) => {
    setSaved(msg);
    timers.current.push(window.setTimeout(() => setSaved(null), 2600));
  }, []);

  const view = useCallback((id: ShotId) => {
    setShot((s) => ({ id, n: (s?.n ?? 0) + 1 }));
    setActiveShot(id);
    setSelected(null);
    setTouched(true);
  }, []);

  // cut to black, switch, fade back up
  const film = useCallback((on: boolean) => {
    timers.current.forEach(clearTimeout);
    setBlackout(true);
    timers.current = [
      window.setTimeout(() => {
        setCinematic(on);
        setScene(0);
        if (on) {
          setSelected(null);
          setExploded(false);
          setListOpen(false);
          setPanel(null);
          setInterior(false);
          setActiveShot(null);
        }
      }, 550),
      window.setTimeout(() => setBlackout(false), 800),
    ];
  }, []);
  const onCinematicShot = useCallback((i: number) => setScene(i), []);

  // only parts the model actually has, in the content's order
  const order = useMemo(() => car.parts.filter((p) => !ids || (p.members ?? [p.id]).some((id) => ids.includes(id))), [car, ids]);
  const part = selected ? partById[selected] : null;
  const index = part ? order.findIndex((p) => p.id === part.id) : -1;

  const select = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
    setListOpen(false);
    setTouched(true);
  }, []);
  const pick = useCallback((id: string) => ownerOf[id] && select(ownerOf[id]), [ownerOf, select]);

  const step = useCallback(
    (d: number) => {
      const i = order.findIndex((p) => p.id === selected);
      const next = order[(i + d + order.length) % order.length];
      if (next) setSelected(next.id);
    },
    [order, selected],
  );

  // ?part=engine deep links, kept in sync with the selection
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("part", selected);
    else url.searchParams.delete("part");
    window.history.replaceState(null, "", url);
  }, [selected]);

  const exterior = useMemo(() => car.parts.filter((p) => p.group === "Exterior").flatMap((p) => p.members ?? [p.id]), [car]);

  const photo = useCallback((wallpaper = false) => {
    setSnap((s) => ({ n: s.n + 1, wallpaper }));
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      flash.current?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 500, easing: "ease-out" });
  }, []);
  const onSnap = useCallback(
    (png: string) => {
      const name = `${car.slug}-${interior ? "cockpit" : (activeShot ?? "studio")}${snap.wallpaper ? "-4k" : ""}.png`;
      const a = document.createElement("a");
      a.href = png;
      a.download = name;
      a.click();
      toast(`Saved ${name}`);
    },
    [car.slug, activeShot, interior, snap.wallpaper, toast],
  );

  // the engine: turned over when sound goes on, switched off with it (and when the car changes)
  useEffect(() => {
    if (!sound) return;
    const e = startEngine(car.cylinders, volume);
    engine.current = e;
    return () => {
      e?.stop();
      engine.current = null;
    };
    // the volume is set live below, not by restarting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound, car.cylinders]);
  useEffect(() => engine.current?.setVolume(volume), [volume]);
  useEffect(() => engine.current?.cruise(drive), [drive, sound]);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const share = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("part");
    url.searchParams.set(
      "look",
      encodeLook({
        paintIdx: custom ? undefined : paintIdx || undefined,
        custom: custom ?? undefined,
        mood: mood !== "studio" ? mood : undefined,
        backdrop: backdrop !== "studio" ? backdrop : undefined,
        livery: livery !== "none" ? livery : undefined,
        liveryColor: livery !== "none" ? liveryColor : undefined,
        brake: brake || undefined,
        iridescent: iridescent || undefined,
        lights: lights || undefined,
        doors: doors || undefined,
        steer: steer || undefined,
        ride: ride || undefined,
        tint: tint || undefined,
        sun: backdrop === "sky" ? sun : undefined,
        weather: weather !== "dry" ? weather : undefined,
        aperture: aperture || undefined,
      }),
    );
    const link = url.toString();
    navigator.clipboard?.writeText(link).then(
      () => toast("Link copied"),
      () => toast("Copy the link from the address bar"),
    );
    window.history.replaceState(null, "", url);
  }, [custom, paintIdx, mood, backdrop, livery, liveryColor, brake, iridescent, lights, doors, steer, ride, tint, sun, weather, aperture, toast]);
  const rev = useCallback(() => {
    if (!engine.current) setSound(true);
    else engine.current.rev();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("showroom-quality", quality);
    } catch {}
  }, [quality]);

  const look = useMemo<Look>(
    () => ({
      doors,
      doorStyle: car.doors,
      calipers: car.calipers,
      brake,
      iridescent,
      livery,
      liveryColor,
      interior: interior && !cinematic,
      grid,
      backdrop,
      quality,
      tuning,
      drive: drive && !interior,
      steer,
      ride,
      tint,
      pins: pinsOn,
      sun,
      weather,
      aperture: interior ? 0 : aperture,
    }),
    [doors, car.doors, car.calipers, brake, iridescent, livery, liveryColor, interior, cinematic, grid, backdrop, quality, tuning, drive, steer, ride, tint, pinsOn, sun, weather, aperture],
  );
  const pins = useMemo<Pin[]>(() => car.parts.map((p) => ({ id: p.id, name: p.name, members: p.members ?? [p.id] })), [car]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (cinematic) film(false);
        else if (keysOpen) setKeysOpen(false);
        else if (panel) setPanel(null);
        else if (interior) setInterior(false);
        else setSelected(null);
      } else if (k === "c") film(!cinematic);
      else if (cinematic) return;
      else if (k === "l") setLights((v) => !v);
      else if (k === "e") {
        setExploded((v) => !v);
        setSelected(null);
      } else if (k === "m") setMeasure((v) => !v);
      else if (k === "x") setXray((v) => !v);
      else if (k === "p") photo();
      else if (k === "d") setDoors((v) => !v);
      else if (k === "i") {
        setInterior((v) => !v);
        setSelected(null);
      } else if (k === "g") setGrid((v) => !v);
      else if (k === "r") rev();
      else if (k === "v") setDrive((v) => !v);
      else if (k === "h") setPinsOn((v) => !v);
      else if (k === "f") toggleFullscreen();
      else if (k === "w") setWeather((w) => weathers[(weathers.findIndex((x) => x.id === w) + 1) % weathers.length].id);
      else if (k === "s") setTurntable((v) => !v);
      else if (k === "?" || (k === "/" && e.shiftKey)) setKeysOpen((v) => !v);
      else if (/^[1-6]$/.test(k)) view(shots[+k - 1].id);
      else if (selected && e.key === "ArrowRight") step(1);
      else if (selected && e.key === "ArrowLeft") step(-1);
      else if (!selected && onCycle && e.key === "ArrowRight") onCycle(1);
      else if (!selected && onCycle && e.key === "ArrowLeft") onCycle(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selected, step, cinematic, film, photo, view, onCycle, keysOpen, panel, interior, rev, toggleFullscreen]);

  const onHover = useCallback((id: string | null, x = 0, y = 0) => setHover(id && ownerOf[id] ? { id: ownerOf[id], x, y } : null), [ownerOf]);
  // the scene works with the model's groups: a set selects (and lights up) every member
  const membersOf = useCallback((id: string | null) => (id ? (partById[id]?.members ?? [id]) : NONE), [partById]);
  const selectedIds = useMemo(() => membersOf(selected), [membersOf, selected]);
  const hoveredIds = useMemo(() => membersOf(cinematic ? null : (hover?.id ?? null)), [membersOf, cinematic, hover?.id]);
  const onReady = useCallback((found: string[]) => setIds(found), []);

  // ---------------------------------------------------------------- the dock
  const paintNow = custom ?? car.paint.colors[paintIdx] ?? car.paint.colors[0];
  const setTune = (t: Partial<Tuning>) => setTuning((cur) => ({ ...cur, ...t }));
  const dockRows: DockItem[][] = [
    [
      {
        id: "car",
        label: "Car model",
        icon: icons.car,
        hint: "← →",
        panel: switcher ?? <p className="px-1 text-sm text-fg/60">{car.name}</p>,
      },
      {
        id: "paint",
        label: `Paint · ${paintNow.name}`,
        icon: icons.paint,
        active: paintIdx > 0 || !!custom,
        panel: (
          <Swatches>
            {car.paint.colors.map((c, i) => (
              <Swatch key={c.name} label={c.name} on={!custom && i === paintIdx} background={lacquer(c.hex)} onClick={() => {
                setCustom(null);
                setPaintIdx(i);
              }} />
            ))}
            {/* any colour at all */}
            <label title="Custom colour" className={`relative grid h-8 w-8 cursor-pointer place-items-center overflow-hidden rounded-full border ${custom ? "border-fg ring-2 ring-fg/20 ring-offset-2 ring-offset-[#121214]" : "border-fg/20"}`}
              style={{ background: "conic-gradient(#ff3b3b,#ffd93b,#5bff3b,#3bd9ff,#5b3bff,#ff3bd9,#ff3b3b)" }}>
              <input type="color" aria-label="Custom paint colour" className="absolute inset-0 cursor-pointer opacity-0" value={custom?.hex ?? "#3a6ed8"}
                onChange={(e) => setCustom({ name: "Custom", hex: e.target.value, metalness: custom?.metalness ?? 0.55, roughness: custom?.roughness ?? 0.28 })} />
            </label>
          </Swatches>
        ),
      },
      {
        id: "brakes",
        label: "Brake calipers",
        icon: icons.brakes,
        active: !!brake,
        disabled: !car.calipers.length,
        panel: (
          <Swatches>
            {brakeColors.map((c) => (
              <Swatch key={c.name} label={c.name} on={brake === c.hex} onClick={() => setBrake(c.hex)}
                background={c.hex ? lacquer(c.hex) : "repeating-linear-gradient(45deg,#333 0 4px,#1b1b1d 4px 8px)"} />
            ))}
          </Swatches>
        ),
      },
      { id: "iridescence", label: "Pearl iridescence", icon: icons.iridescence, active: iridescent, onClick: () => setIridescent((v) => !v) },
      {
        id: "livery",
        label: "Livery",
        icon: icons.livery,
        active: livery !== "none",
        panel: (
          <div className="grid gap-3">
            <Chips>
              {liveries.map((l) => (
                <Chip key={l.id} on={livery === l.id} onClick={() => setLivery(l.id)}>
                  {l.name}
                </Chip>
              ))}
            </Chips>
            <Swatches>
              {liveryColors.map((c) => (
                <Swatch key={c.name} label={`${c.name} livery`} on={liveryColor === c.hex} background={lacquer(c.hex)} onClick={() => {
                  setLiveryColor(c.hex);
                  if (livery === "none") setLivery("stripes");
                }} />
              ))}
            </Swatches>
          </div>
        ),
      },
      {
        id: "pose",
        label: "Pose",
        icon: icons.pose,
        active: !!steer || !!ride || !!tint,
        panel: (
          <div className="w-[19rem]">
            <Slider label="Steering" value={steer} min={-32} max={32} step={1} onChange={setSteer} format={(v) => `${v > 0 ? "L " : v < 0 ? "R " : ""}${Math.abs(v)}°`} />
            <Slider label="Ride height" value={ride * 1000} min={-50} max={50} step={1} onChange={(v) => setRide(v / 1000)} format={(v) => `${v > 0 ? "+" : ""}${v} mm`} />
            <Slider label="Window tint" value={tint} min={0} max={1} step={0.05} onChange={setTint} format={(v) => `${Math.round(v * 100)}%`} />
            <div className="mt-2 flex justify-end px-1">
              <Chip on={false} onClick={() => {
                setSteer(0);
                setRide(0);
                setTint(0);
              }}>Reset</Chip>
            </div>
          </div>
        ),
      },
      { id: "doors", label: doors ? "Close doors" : "Open doors", hint: "D", icon: icons.doors, active: doors, onClick: () => setDoors((v) => !v) },
      { id: "lights", label: "Lights", hint: "L", icon: icons.lights, active: lights, onClick: () => setLights((v) => !v) },
      { id: "pins", label: "Hotspots", hint: "H", icon: icons.pins, active: pinsOn, onClick: () => setPinsOn((v) => !v) },
      { id: "xray", label: "X-ray", hint: "X", icon: icons.xray, active: xray, onClick: () => setXray((v) => !v) },
      { id: "measure", label: "Measure", hint: "M", icon: icons.measure, active: measure, onClick: () => setMeasure((v) => !v) },
      {
        id: "lens",
        label: aperture ? `Lens · f/${(16 / (1 + aperture * 2.5)).toFixed(1)}` : "Lens",
        icon: icons.lens,
        active: aperture > 0,
        panel: (
          <div className="w-[19rem]">
            <Slider label="Aperture" value={aperture} min={0} max={6} step={0.25} onChange={setAperture}
              format={(v) => (v ? `f/${(16 / (1 + v * 2.5)).toFixed(1)}` : "Off")} />
            <p className="px-1 pt-1 text-[11px] leading-relaxed text-fg/45">
              Opens the lens: the car stays sharp and the studio behind it melts away, as with a fast portrait lens.
            </p>
          </div>
        ),
      },
      { id: "keys", label: "Keyboard shortcuts", hint: "?", icon: icons.keys, onClick: () => setKeysOpen((v) => !v) },
    ],
    [
      {
        id: "interior",
        label: interior ? "Step outside" : "Driver's seat",
        hint: "I",
        icon: icons.interior,
        active: interior,
        onClick: () => {
          setInterior((v) => !v);
          setSelected(null);
          setExploded(false);
        },
      },
      {
        id: "drive",
        label: drive ? "Stop" : "Drive",
        hint: "V",
        icon: icons.drive,
        active: drive,
        onClick: () => {
          setDrive((v) => !v);
          setInterior(false);
          setSelected(null);
          setExploded(false);
        },
      },
      {
        id: "views",
        label: "Camera views",
        hint: "1–6",
        icon: icons.views,
        active: !!activeShot,
        panel: (
          <Chips>
            {shots.map((sh, i) => (
              <Chip key={sh.id} on={activeShot === sh.id} title={`${sh.name} (${i + 1})`} onClick={() => {
                setInterior(false);
                view(sh.id);
              }}>
                {sh.name}
              </Chip>
            ))}
          </Chips>
        ),
      },
      { id: "spin", label: "Turntable", hint: "S", icon: icons.spin, active: turntable, onClick: () => {
        setTurntable((v) => !v);
        setActiveShot(null);
      } },
      {
        id: "mood",
        label: `Lighting · ${moodById[mood].name}`,
        icon: icons.mood,
        active: mood !== "studio",
        panel: (
          <Swatches>
            {moods.map((m) => (
              <Swatch key={m.id} label={`${m.name} lighting`} on={m.id === mood} background={m.swatch} onClick={() => setMood(m.id)} />
            ))}
          </Swatches>
        ),
      },
      {
        id: "backdrop",
        label: `Background · ${backdrops.find((b) => b.id === backdrop)?.name}`,
        icon: icons.backdrop,
        active: backdrop !== "studio",
        panel: (
          <div className="grid gap-2">
            <Swatches>
              {backdrops.map((b) => (
                <Swatch key={b.id} label={b.name} on={b.id === backdrop} background={b.swatch} onClick={() => setBackdrop(b.id)} />
              ))}
            </Swatches>
            {backdrop === "sky" && (
              <Slider label="Time of day" value={sun} min={0} max={1} step={0.01} onChange={setSun}
                format={(v) => (v < 0.25 ? "Dawn" : v < 0.55 ? "Morning" : "Noon")} />
            )}
          </div>
        ),
      },
      {
        id: "weather",
        label: `Weather · ${weathers.find((w) => w.id === weather)?.name}`,
        hint: "W",
        icon: icons.weather,
        active: weather !== "dry",
        panel: (
          <div className="grid max-w-[21rem] gap-2">
            <Chips>
              {weathers.map((w) => (
                <Chip key={w.id} on={weather === w.id} onClick={() => setWeather(w.id)}>{w.name}</Chip>
              ))}
            </Chips>
            <p className="px-1 text-[11px] leading-relaxed text-fg/45">
              {weather === "rain"
                ? "Rain falls round the car, rings spread on the floor and water beads on the paint."
                : weather === "wet"
                  ? "The floor shines like a mirror and the last drops sit on the paint."
                  : weather === "haze"
                    ? "Dust turns in the light and the overhead lamp throws a visible shaft."
                    : "A clean, dry studio."}
            </p>
          </div>
        ),
      },
      { id: "grid", label: "Floor grid", hint: "G", icon: icons.grid, active: grid, onClick: () => setGrid((v) => !v) },
      {
        id: "quality",
        label: `Graphics · ${quality === "quality" ? "Quality" : "Performance"}`,
        icon: icons.quality,
        active: quality === "performance",
        panel: (
          <div className="grid max-w-[20rem] gap-2">
            <Chips>
              <Chip on={quality === "performance"} onClick={() => setQuality("performance")}>Performance</Chip>
              <Chip on={quality === "quality"} onClick={() => setQuality("quality")}>Quality</Chip>
            </Chips>
            <p className="px-1 text-xs leading-relaxed text-fg/50">
              {quality === "quality"
                ? "Full resolution, ambient occlusion, anti-aliasing and sharp reflections."
                : "Lighter rendering for a smoother frame rate: one pixel per pixel, no ambient occlusion."}
            </p>
          </div>
        ),
      },
      {
        id: "sound",
        label: sound ? "Engine sound · on" : "Engine sound",
        hint: "R revs",
        icon: icons.sound,
        active: sound,
        panel: (
          <div className="grid w-[17rem] gap-2">
            <Chips>
              <Chip on={sound} onClick={() => setSound((v) => !v)}>{sound ? "Engine off" : "Start engine"}</Chip>
              <Chip on={false} onClick={rev}>Rev</Chip>
            </Chips>
            <Slider label="Volume" value={volume} min={0} max={1} step={0.05} onChange={setVolume} format={(v) => `${Math.round(v * 100)}%`} />
            <p className="px-1 text-[11px] leading-relaxed text-fg/45">A synthesised {car.cylinders}-cylinder note, not a recording of this car.</p>
          </div>
        ),
      },
      {
        id: "settings",
        label: "Settings",
        icon: icons.settings,
        panel: (
          <div className="w-[19rem]">
            <ColorField label="Paint" value={custom?.hex ?? paintNow.hex} onChange={(hex) => setCustom({ name: "Custom", hex, metalness: custom?.metalness ?? paintNow.metalness ?? 0.5, roughness: custom?.roughness ?? paintNow.roughness ?? 0.3 })} />
            <Slider label="Metallic" value={custom?.metalness ?? paintNow.metalness ?? 0.5} min={0} max={1} step={0.01}
              onChange={(metalness) => setCustom({ ...paintNow, ...custom, name: "Custom", metalness })} />
            <Slider label="Roughness" value={custom?.roughness ?? paintNow.roughness ?? 0.3} min={0.02} max={1} step={0.01}
              onChange={(roughness) => setCustom({ ...paintNow, ...custom, name: "Custom", roughness })} />
            <ColorField label="Headlights" value={tuning.headColor} onChange={(headColor) => {
              setTune({ headColor });
              setLights(true);
            }} />
            <Slider label="Reflections" value={tuning.reflections} min={0} max={2} step={0.05} onChange={(reflections) => setTune({ reflections })} />
            <Slider label="Bloom" value={tuning.bloom} min={0} max={3} step={0.05} onChange={(bloom) => setTune({ bloom })} />
            <Slider label="Spin speed" value={tuning.spin} min={0} max={4} step={0.1} onChange={(spin) => setTune({ spin })} format={(v) => `${v.toFixed(1)}×`} />
            <div className="mt-2 flex justify-end px-1">
              <Chip on={false} onClick={() => {
                setTuning(defaultTuning);
                setCustom(null);
              }}>Reset</Chip>
            </div>
          </div>
        ),
      },
      { id: "share", label: "Copy share link", icon: icons.share, onClick: share },
      {
        id: "capture",
        label: "Capture",
        hint: "P",
        icon: icons.capture,
        panel: (
          <Chips>
            <Chip on={false} onClick={() => {
              photo();
              setPanel(null);
            }}>Photo</Chip>
            <Chip on={false} onClick={() => {
              photo(true);
              setPanel(null);
            }}>4K wallpaper</Chip>
          </Chips>
        ),
      },
    ],
  ];

  return (
    <div
      className="sr-root fixed inset-0 h-dvh overflow-hidden bg-bg"
      data-cine={cinematic || undefined}
      style={{ cursor: hover && !cinematic ? "pointer" : undefined }}
      onPointerDown={() => setTouched(true)}
    >
      <div className="absolute inset-0" onPointerDown={() => setActiveShot(null)}>
        <ShowroomScene
          url={car.model}
          view={car.view}
          selected={selectedIds}
          exploded={exploded}
          hovered={hoveredIds}
          paintMaterial={car.paint.material}
          paint={custom ?? (paintIdx ? car.paint.colors[paintIdx] : null)}
          lamps={car.lamps}
          lights={lights}
          mood={mood}
          turntable={turntable}
          shot={shot}
          cinematic={cinematic}
          measure={measure}
          xray={xray ? exterior : NONE}
          snap={snap}
          onSnap={onSnap}
          onCamera={setCamera}
          look={look}
          pins={pins}
          onCinematicShot={onCinematicShot}
          onHover={onHover}
          onPick={pick}
          onReady={onReady}
        />
      </div>

      {/* shade behind the text so it reads over the studio */}
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-bg/80 to-transparent" />
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg/90 to-transparent" />
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-y-0 left-0 hidden w-[44vw] bg-gradient-to-r from-bg/75 via-bg/30 to-transparent lg:block" />
      <div aria-hidden className="grain absolute" />

      {!ids && <Loading name={car.short} />}

      {/* left column: title, numbers, and the part index on wide screens */}
      <div
        className={`sr-hud pointer-events-none absolute bottom-24 left-gutter right-gutter top-20 flex flex-col lg:bottom-36 transition-opacity duration-500 md:top-24 lg:right-auto lg:w-[min(30rem,36vw)] ${
          interior ? "opacity-0 [&_*]:!pointer-events-none" : part ? "max-md:opacity-0 max-md:[&_*]:pointer-events-none" : ""
        }`}
      >
        <p key={`m${car.slug}`} className="sr-rise label flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {car.maker} <span className="text-fg/30">/</span> {car.year}
        </p>
        <h1 key={`t${car.slug}`} className="sr-rise display mt-3 text-[clamp(34px,4.6vw,76px)]" style={{ animationDelay: "60ms" }}>
          {car.name}
        </h1>
        <p key={`g${car.slug}`} className="sr-rise mt-4 max-w-xs text-[15px] leading-snug text-fg/65" style={{ animationDelay: "120ms" }}>
          {car.tagline}
        </p>
        {switcher && <div className="pointer-events-auto mt-5 max-w-full lg:hidden">{switcher}</div>}

        <nav
          aria-label="Parts"
          data-lenis-prevent
          className={`pointer-events-auto fixed bottom-[11.5rem] left-gutter right-gutter z-20 max-h-[50dvh] overflow-y-auto rounded-2xl border border-fg/10 bg-[#121214]/90 p-4 shadow-2xl backdrop-blur-xl
            ${listOpen ? "block" : "hidden"}
            lg:static lg:mt-10 lg:block lg:max-h-none lg:min-h-0 lg:w-64 lg:flex-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none lg:[mask-image:linear-gradient(to_bottom,black_85%,transparent)]`}
        >
          {groups.map((g) => {
            const list = order.filter((p) => p.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="mb-5">
                <p className="label mb-2 flex items-center gap-3 !text-[10px]">
                  {g}
                  <span className="h-px flex-1 bg-fg/10" />
                  <span className="text-fg/35">{pad(list.length)}</span>
                </p>
                <ul>
                  {list.map((p) => {
                    const on = selected === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => select(p.id)}
                          onMouseEnter={() => setHover({ id: p.id, x: -999, y: -999 })}
                          onMouseLeave={() => setHover(null)}
                          className={`group flex w-full items-center gap-3 py-[5px] text-left text-sm transition-colors ${
                            on ? "text-fg" : "text-fg/55 hover:text-fg"
                          }`}
                        >
                          <span
                            className={`h-px transition-all duration-300 ${on ? "w-5 bg-accent" : "w-2 bg-fg/25 group-hover:w-4 group-hover:bg-fg/60"}`}
                          />
                          {p.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>

      {/* right column: the headline numbers, until a part's details take its place */}
      <dl
        key={`f${car.slug}`}
        className={`sr-hud pointer-events-none absolute right-gutter top-28 hidden w-48 transition-all duration-500 md:block ${
          part || interior ? "translate-x-6 opacity-0" : "opacity-100"
        }`}
      >
        {car.facts.map(([k, v], i) => (
          <div key={k} className="sr-rise border-t border-fg/12 py-3 text-right" style={{ animationDelay: `${150 + i * 70}ms` }}>
            <dt className="label !text-[10px]">{k}</dt>
            <dd className="mt-1 text-xl font-light tracking-tight">{v}</dd>
          </div>
        ))}
      </dl>

      {/* the camera, read out like a viewfinder */}
      {camera && !cinematic && (
        <div aria-hidden className="sr-hud pointer-events-none absolute bottom-[5.25rem] left-gutter z-20 hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg/45 lg:flex">
          <span className="relative h-2 w-2 rounded-full border border-fg/40">
            <span className="absolute inset-[2px] rounded-full bg-accent" />
          </span>
          <span className="tabular-nums text-fg/75">{camera.mm} mm</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">{camera.azimuth.toString().padStart(3, "0")}°</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">h {camera.elevation.toFixed(2)} m</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">{camera.distance.toFixed(1)} m out</span>
          {(measure || xray) && (
            <>
              <span className="text-fg/20">/</span>
              <span className="text-accent">{[measure && "Measuring", xray && "X-ray"].filter(Boolean).join(" · ")}</span>
            </>
          )}
        </div>
      )}

      {/* the shutter: a white flash, then where the photo went */}
      <div ref={flash} aria-hidden className="pointer-events-none absolute inset-0 z-[55] bg-white opacity-0" />
      <div
        role="status"
        className={`sr-hud pointer-events-none absolute left-1/2 top-24 z-50 -translate-x-1/2 rounded-full border border-fg/15 bg-[#121214]/85 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg backdrop-blur-md transition-all duration-500 ${
          saved ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
        {saved ?? "\u00a0"}
      </div>

      {keysOpen && <Keys onClose={() => setKeysOpen(false)} cycle={!!onCycle} />}

      {/* bottom bar: parts, explode and the film on the left (above the dock below lg), the credit on the right */}
      <div className="sr-hud pointer-events-none absolute inset-x-gutter bottom-[8.25rem] z-30 flex items-end justify-between gap-4 md:bottom-[8.75rem] lg:bottom-5">
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            className="hud-btn border-fg/15 bg-[#121214]/70 backdrop-blur-md lg:hidden"
            aria-expanded={listOpen}
            onClick={() => {
              setListOpen((v) => !v);
              setPanel(null);
            }}
          >
            {listOpen ? "Close" : `Parts · ${order.length}`}
          </button>
          <button
            type="button"
            className={`hud-btn flex items-center gap-2 border-fg/15 backdrop-blur-md ${exploded ? "!bg-fg !text-bg" : "bg-[#121214]/70"}`}
            aria-pressed={exploded}
            title="Explode (E)"
            onClick={() => {
              setExploded((v) => !v);
              setSelected(null);
              setTouched(true);
            }}
          >
            <ExplodeIcon open={exploded} />
            {exploded ? "Reassemble" : "Explode"}
          </button>
          <button
            type="button"
            onClick={() => film(true)}
            title="Play the film (C)"
            className="hud-btn flex items-center gap-2 !border-accent !bg-accent font-semibold !text-bg"
          >
            {icons.film}
            Film
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? "Leave full screen" : "Full screen"}
            title={`${fullscreen ? "Leave full screen" : "Full screen"} (F)`}
            className="hud-btn hidden !px-3 border-fg/15 bg-[#121214]/70 backdrop-blur-md sm:grid sm:place-items-center"
          >
            {fullscreen ? icons.unfull : icons.full}
          </button>
        </div>

        <div className="pointer-events-auto hidden max-w-[16rem] flex-col items-end gap-2 text-right 2xl:flex">
          <p className={`label !text-[10px] transition-opacity duration-700 ${touched ? "opacity-0" : "opacity-100"}`}>
            Drag to orbit · click a part
          </p>
          {car.credit && (
            <p className="label !text-[9px] !text-fg/40">
              Model:{" "}
              <a href={car.credit.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-fg hover:underline">
                {car.credit.title}
              </a>{" "}
              by {car.credit.author}
              {car.credit.license && (
                <>
                  {" "}·{" "}
                  <a href={car.credit.licenseUrl} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                    {car.credit.license}
                  </a>
                </>
              )}
              , split into parts
            </p>
          )}
        </div>
      </div>
      {/* the credit stays visible where the bottom bar is too narrow for it */}
      {car.credit && (
        <p className="sr-hud label absolute right-gutter top-[4.5rem] z-10 hidden max-w-[14rem] text-right !text-[9px] !text-fg/40 md:block 2xl:hidden">
          Model: {car.credit.title} by {car.credit.author}
          {car.credit.license && ` · ${car.credit.license}`}
        </p>
      )}

      <Dock rows={dockRows} open={panel} onOpen={setPanel} hidden={cinematic} />

      <Film car={car} on={cinematic} scene={scene} onExit={() => film(false)} />
      <div aria-hidden className={`pointer-events-none absolute inset-0 z-[60] bg-black transition-opacity duration-500 ${blackout ? "opacity-100" : "opacity-0"}`} />

      {part && (
        <Details
          key={part.id}
          part={part}
          index={index}
          total={order.length}
          prev={order[(index - 1 + order.length) % order.length]?.name}
          next={order[(index + 1) % order.length]?.name}
          onClose={() => setSelected(null)}
          onStep={step}
        />
      )}

      {hover && hover.x > 0 && hover.id !== selected && partById[hover.id] && (
        <div
          className="sr-hud pointer-events-none fixed z-40 -translate-x-1/2 rounded-full border border-fg/15 bg-[#121214]/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg backdrop-blur-md"
          style={{ left: hover.x, top: hover.y - 40 }}
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          {partById[hover.id].name}
        </div>
      )}
    </div>
  );
}

function Loading({ name }: { name: string }) {
  const progress = useProgress((s) => s.progress);
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="w-56 text-center">
        <p className="label">Rolling in the {name}</p>
        <div className="mt-3 h-px w-full overflow-hidden bg-fg/10">
          {/* until the loader reports progress, a pulse instead of a stuck 0% */}
          <div
            className={`h-full bg-accent transition-[width] duration-300 ${progress ? "" : "animate-pulse"}`}
            style={{ width: `${progress ? progress : 35}%` }}
          />
        </div>
        <p className="label mt-2 !text-[10px] tabular-nums">{progress ? `${Math.round(progress)}%` : "\u00a0"}</p>
      </div>
    </div>
  );
}

function ExplodeIcon({ open }: { open: boolean }) {
  const d = open ? 1.5 : 3;
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x={d} y={d} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={14 - d - 3.4} y={d} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={d} y={14 - d - 3.4} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={14 - d - 3.4} y={14 - d - 3.4} width="3.4" height="3.4" className="transition-all duration-300" />
    </svg>
  );
}

function Details({
  part,
  index,
  total,
  prev,
  next,
  onClose,
  onStep,
}: {
  part: CarPart;
  index: number;
  total: number;
  prev?: string;
  next?: string;
  onClose: () => void;
  onStep: (d: number) => void;
}) {
  return (
    <aside
      aria-live="polite"
      aria-label={`${part.name} details`}
      data-lenis-prevent
      className="sr-hud sr-panel absolute inset-x-0 bottom-0 z-30 max-h-[52dvh] overflow-y-auto rounded-t-3xl border-t border-fg/10 bg-[#121214]/85 p-6 pb-24 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl
        md:inset-x-auto md:bottom-auto md:right-gutter md:top-24 md:max-h-[calc(100dvh-16rem)] md:w-[400px] md:rounded-3xl md:border md:pb-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label flex items-center gap-2 !text-[10px]">
            <span className="text-accent">{pad(index + 1)}</span>
            <span className="text-fg/30">/ {pad(total)}</span>
            <span className="text-fg/30">·</span>
            {part.group}
          </p>
          <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{part.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-fg/15 text-fg/70 transition-colors hover:border-fg hover:bg-fg hover:text-bg"
        >
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-fg/75">{part.summary}</p>
      {part.specs.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-fg/10 bg-fg/10">
          {part.specs.map(([k, v]) => (
            <div key={k} className="bg-[#141416] px-3.5 py-3">
              <dt className="label !text-[9px]">{k}</dt>
              <dd className="mt-1 text-sm leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {part.note && <p className="mt-4 border-l border-accent/50 pl-3 text-xs leading-relaxed text-fg/50">{part.note}</p>}
      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="group rounded-xl border border-fg/10 px-3.5 py-3 text-left transition-colors hover:border-fg/40"
          onClick={() => onStep(-1)}
        >
          <span className="label !text-[9px]">← Prev</span>
          <span className="mt-0.5 block truncate text-sm text-fg/70 group-hover:text-fg">{prev}</span>
        </button>
        <button
          type="button"
          className="group rounded-xl border border-fg/10 px-3.5 py-3 text-right transition-colors hover:border-fg/40"
          onClick={() => onStep(1)}
        >
          <span className="label !text-[9px]">Next →</span>
          <span className="mt-0.5 block truncate text-sm text-fg/70 group-hover:text-fg">{next}</span>
        </button>
      </div>
    </aside>
  );
}

const KEYS: [string, string][] = [
  ["E", "Explode or reassemble"],
  ["1–6", "Hero, front, side, rear, top, low"],
  ["I", "Driver's seat"],
  ["D", "Open or close the doors"],
  ["M", "Measure"],
  ["X", "X-ray the bodywork"],
  ["G", "Floor grid"],
  ["P", "Take a photo"],
  ["L", "Lights"],
  ["R", "Rev the engine"],
  ["V", "Drive"],
  ["H", "Hotspots"],
  ["F", "Full screen"],
  ["W", "Change the weather"],
  ["S", "Spin the turntable"],
  ["C", "Play the film"],
  ["← →", "Previous or next part (or car)"],
  ["Esc", "Close"],
];

/** The keyboard shortcuts, on a card in the middle of the screen. */
function Keys({ onClose, cycle }: { onClose: () => void; cycle: boolean }) {
  return (
    <div className="sr-hud absolute inset-0 z-[45] grid place-items-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="sr-panel w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-fg/10 bg-[#121214]/90 p-5 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="label mb-3 flex items-center justify-between !text-[10px]">
          Keyboard
          <button type="button" onClick={onClose} className="text-fg/50 hover:text-fg">
            Esc
          </button>
        </p>
        <dl className="divide-y divide-fg/8">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2 text-sm">
              <dt className="text-fg/70">{k === "← →" && !cycle ? "Previous or next part" : v}</dt>
              <dd>
                <kbd className="rounded border border-fg/20 bg-fg/5 px-1.5 py-0.5 font-mono text-[10px] text-fg/80">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** The cinematic reel's frame: letterbox bars, a caption per scene and a way out. */
function Film({ car, on, scene, onExit }: { car: Car; on: boolean; scene: number; onExit: () => void }) {
  const shot = cineShots[scene] ?? cineShots[0];
  const finale = !shot.title;
  return (
    <div aria-hidden={!on} className="pointer-events-none absolute inset-0 z-40">
      <div className={`absolute inset-x-0 top-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${on ? "translate-y-0" : "-translate-y-full"}`} />
      <div className={`absolute inset-x-0 bottom-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${on ? "translate-y-0" : "translate-y-full"}`}>
        {on && (
          <div className="absolute inset-x-gutter top-1/2 flex -translate-y-1/2 items-center gap-4">
            <span className="label !text-[10px] tabular-nums !text-fg/50">
              {pad(scene + 1)} / {pad(cineShots.length)}
            </span>
            <span className="relative h-px flex-1 overflow-hidden bg-fg/10">
              <span key={scene} className="sr-progress absolute inset-y-0 left-0 bg-accent" style={{ animationDuration: `${shot.dur}s` }} />
            </span>
            <span className="label hidden !text-[10px] !text-fg/50 sm:inline">Esc to exit</span>
          </div>
        )}
      </div>

      {on && (
        <>
          <div key={scene} className="absolute bottom-[calc(11vh+2rem)] left-gutter right-gutter max-w-xl">
            <p className="sr-rise label flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {car.maker} <span className="text-fg/30">/</span> {car.year}
            </p>
            <h2
              className={`sr-rise display mt-3 ${finale ? "text-[clamp(40px,6vw,96px)]" : "text-[clamp(28px,3.4vw,54px)]"}`}
              style={{ animationDelay: "120ms" }}
            >
              {finale ? car.name : shot.title}
            </h2>
            {finale && (
              <p className="sr-rise mt-3 max-w-sm text-[15px] text-fg/65" style={{ animationDelay: "240ms" }}>
                {car.tagline}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onExit}
            className="hud-btn pointer-events-auto absolute right-gutter top-[calc(11vh+1.25rem)] flex items-center gap-2 border-fg/20 bg-black/40 backdrop-blur-md"
          >
            <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
            Exit film
          </button>
        </>
      )}
    </div>
  );
}
