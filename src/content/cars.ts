/**
 * The cars in the /cars showroom. Each model is an exploded-view GLB with one `Part_<id>` group per
 * clickable part (see art/build_lykan.py and art/cars/split_cars.py); `parts` describes those ids.
 * Specs are published figures (Wikipedia); lines starting "In this model" describe the 3D model.
 */

import { lykan as lykanMeta, parts as lykanParts, type LykanPart, type PartGroup } from "./lykan";

export type CarPart = LykanPart;
export type { PartGroup };

export type CarView = {
  /** orbit pivot when nothing is picked */
  target: [number, number, number];
  camera: [number, number, number];
  /** pulled back so the whole car fits a portrait phone */
  cameraNarrow: [number, number, number];
};

/** A colour for the paint picker; the first one in a car's list is the model's own paint. */
export type PaintColor = { name: string; hex: string; metalness?: number; roughness?: number };

export type Car = {
  slug: string;
  name: string;
  short: string;
  maker: string;
  year: string;
  model: string;
  tagline: string;
  facts: [string, string][];
  parts: CarPart[];
  view: CarView;
  /** the body paint: its material name in the GLB and the colours the picker offers */
  paint: { material: string; colors: PaintColor[] };
  /** lamp materials (by name) inside Part_headlights / Part_taillights, lit by the lights switch */
  lamps: { head: string[]; tail: string[] };
  credit?: { title: string; author: string; url: string; license?: string; licenseUrl?: string };
};

export const groups: PartGroup[] = ["Exterior", "Powertrain", "Chassis", "Cabin"];

// ---------------------------------------------------------------------- shared helpers
const wheel = (id: string, front: boolean, left: boolean, summary: string, specs: [string, string][], note?: string): CarPart => ({
  id,
  name: `${front ? "Front" : "Rear"} ${left ? "left" : "right"} wheel`,
  group: "Chassis",
  summary,
  specs: [...specs, ["Position", `${front ? "Front" : "Rear"} axle, ${left ? "left" : "right"}`]],
  note,
});
const corners = [
  ["fl", true, true],
  ["fr", true, false],
  ["rl", false, true],
  ["rr", false, false],
] as const;

// ---------------------------------------------------------------------- Jaguar XJ13
const jaguarParts: CarPart[] = [
  {
    id: "body",
    name: "Aluminium body",
    group: "Exterior",
    summary:
      "Malcolm Sayer, the aerodynamicist behind the C-type and D-type, shaped the skin and built it with aircraft techniques from his Bristol Aeroplane Company days.",
    specs: [
      ["Length", "4,810 mm"],
      ["Width", "1,800 mm"],
      ["Height", "1,000 mm"],
      ["Wheelbase", "2,410 mm"],
      ["Kerb weight", "998 kg"],
      ["Designer", "Malcolm Sayer"],
      ["Built", "1, in 1966"],
    ],
    note:
      "It crashed at MIRA in 1971 and was rebuilt by Abbey Panels; Jaguar says the car seen today is not an exact reproduction of the original.",
  },
  {
    id: "hood",
    name: "Front clamshell",
    group: "Exterior",
    summary: "The long aluminium nose, with faired-in headlamps and a louvred panel to let air out of the front.",
    specs: [["Material", "Aluminium"]],
  },
  {
    id: "lid",
    name: "Rear clamshell",
    group: "Exterior",
    summary: "The tail section over the V12, with a window onto the engine and the sweeping haunches over the rear wheels.",
    specs: [["Covers", "Mid-mounted V12"]],
  },
  {
    id: "door_left",
    name: "Left door",
    group: "Exterior",
    summary: "A small aluminium door cut into the flank of what was built as a pure racing car.",
    specs: [["Side", "Left"]],
  },
  {
    id: "door_right",
    name: "Right door",
    group: "Exterior",
    summary: "The right-hand door, mirroring the left.",
    specs: [["Side", "Right"]],
  },
  {
    id: "headlights",
    name: "Headlamps",
    group: "Exterior",
    summary: "Headlamps set deep in the nose behind faired glass covers, in the style of Jaguar's Le Mans cars.",
    specs: [["Covers", "Faired glass"]],
  },
  {
    id: "taillights",
    name: "Tail lamps",
    group: "Exterior",
    summary: "Small lamps set into the tail of the rear clamshell.",
    specs: [["Position", "Tail"]],
  },
  {
    id: "engine",
    name: "5.0 L V12",
    group: "Powertrain",
    summary:
      "Designed by William Heynes and Claude Bailey: in essence two XK six-cylinder engines on a common crankshaft in an aluminium block. It sits behind the driver as a stressed member of the chassis.",
    specs: [
      ["Layout", "60° V12, mid-mounted"],
      ["Valvetrain", "Double overhead cams"],
      ["Power", "502 hp at 7,600 rpm"],
      ["Gearbox", "5-speed ZF 5DS/25 manual transaxle"],
      ["Drive", "Rear-wheel drive"],
    ],
    note: "The first V12 ran in July 1964; Jaguar's first production V12 arrived in the E-type in 1971.",
  },
  {
    id: "chassis",
    name: "Chassis and suspension",
    group: "Chassis",
    summary:
      "A central body tub with the engine and gearbox bolted on as structure. Coil-spring wishbones at the front; at the rear, the driveshafts double as upper links with two long radius arms per side.",
    specs: [
      ["Front", "Wishbones, coil spring/damper units"],
      ["Rear", "Driveshaft upper links, radius arms, fabricated lower link"],
    ],
  },
  ...corners.map(([c, f, l]) =>
    wheel(`wheel_${c}`, f, l, "Spoked wheel and tyre, held on by a single central knock-off spinner for quick pit stops.", [], "In this model: wire-spoke wheels with centre-lock spinners."),
  ),
  {
    id: "seats",
    name: "Cockpit",
    group: "Cabin",
    summary: "A bare racing cockpit inside the tub, with thin bucket seats and exposed structure.",
    specs: [["Seats", "2"]],
  },
  {
    id: "dashboard",
    name: "Instruments",
    group: "Cabin",
    summary: "A simple panel of round analogue gauges facing the driver.",
    specs: [["Gauges", "Analogue"]],
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "A thin-rimmed wheel of the period, close to the driver in a low, reclined position.",
    specs: [["Type", "Thin-rim racing wheel"]],
  },
];

// ---------------------------------------------------------------------- Toyota Land Cruiser 300
const toyotaWheel = "A large alloy wheel and tyre, part of what gives the 300 its 230 mm of ground clearance.";
const toyotaParts: CarPart[] = [
  {
    id: "body",
    name: "Body",
    group: "Exterior",
    summary:
      "A body-on-frame SUV on Toyota's TNGA GA-F platform. The frame was redesigned for lower weight and more stiffness; the whole vehicle is about 200 kg lighter than the 200 series.",
    specs: [
      ["Length", "4,950–5,015 mm"],
      ["Width", "1,980–1,990 mm"],
      ["Height", "1,945 mm"],
      ["Wheelbase", "2,850 mm"],
      ["Kerb weight", "2,310–2,645 kg"],
      ["Ground clearance", "230 mm"],
      ["Approach / departure", "32° / up to 26.5°"],
    ],
  },
  {
    id: "hood",
    name: "Hood and engine",
    group: "Powertrain",
    summary: "Under the hood sits a twin-turbo V6. The 300 series dropped the V8 that earlier Land Cruisers offered.",
    specs: [
      ["Petrol", "3.4 L V35A-FTS twin-turbo V6, 305 kW (409 hp), 650 Nm"],
      ["Diesel", "3.3 L F33A-FTV twin-turbo V6, 227 kW (304 hp), 700 Nm"],
      ["Gearbox", "10-speed automatic"],
      ["Drive", "Four-wheel drive"],
    ],
    note: "The model's source file calls it a V8; the 300 series has none.",
  },
  ...(["fl", "fr", "rl", "rr"] as const).map((c): CarPart => ({
    id: `door_${c}`,
    name: `${c[0] === "f" ? "Front" : "Rear"} ${c[1] === "l" ? "left" : "right"} door`,
    group: "Exterior",
    summary:
      c[0] === "f"
        ? "A front door carrying its window, handle and mirror."
        : "A rear door into the second row, with its own window and handle.",
    specs: [["Position", `${c[0] === "f" ? "Front" : "Rear"}, ${c[1] === "l" ? "left" : "right"}`]],
  })),
  {
    id: "lid",
    name: "Tailgate",
    group: "Exterior",
    summary: "The rear door into the load space, with the rear window and the roof spoiler above it.",
    specs: [["Seating", "5 or 7 seats, by grade"]],
  },
  {
    id: "headlights",
    name: "Headlamps",
    group: "Exterior",
    summary: "Slim headlamp clusters either side of the big grille, with the fog lamps set low in the bumper.",
    specs: [["Position", "Front corners"]],
  },
  {
    id: "taillights",
    name: "Tail lamps",
    group: "Exterior",
    summary: "Horizontal tail lamp clusters that wrap round the rear corners.",
    specs: [["Position", "Rear corners"]],
  },
  {
    id: "chassis",
    name: "Underbody and suspension",
    group: "Chassis",
    summary:
      "The off-road kit: adaptive variable suspension, an electronically disconnecting anti-roll system and terrain modes, watched by an underbody camera.",
    specs: [
      ["Suspension", "Adaptive Variable Suspension (AVS)"],
      ["Articulation", "E-KDSS"],
      ["Terrain", "Multi-Terrain Select, incl. Deep Snow and Auto"],
      ["Camera", "Multi-Terrain Monitor with underbody view"],
    ],
  },
  ...corners.map(([c, f, l]) => wheel(`wheel_${c}`, f, l, toyotaWheel, [["Type", "Alloy wheel"]])),
  ...corners.map(([c, f, l]): CarPart => ({
    id: `brake_${c}`,
    name: `${f ? "Front" : "Rear"} ${l ? "left" : "right"} brake`,
    group: "Chassis",
    summary: "A ventilated disc and caliper behind the wheel, sized to stop a vehicle of up to 2.6 tonnes.",
    specs: [["Position", `${f ? "Front" : "Rear"} axle, ${l ? "left" : "right"}`]],
  })),
  {
    id: "seats",
    name: "Cabin",
    group: "Cabin",
    summary: "Rows of seats, trim and headliner. Grades seat five or seven.",
    specs: [["Seats", "5 or 7, by grade"]],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    group: "Cabin",
    summary: "The dash with the centre screen, where the Multi-Terrain Monitor shows the ground around and under the car.",
    specs: [["Screen", "Centre display"]],
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "The driver's wheel, on the left in this model.",
    specs: [["Side", "Left-hand drive (in this model)"]],
  },
];

// ---------------------------------------------------------------------- Ferrari F40
const f40Wheel =
  `A 17-inch Speedline three-piece wheel on a Pirelli P Zero, held by a single centre-lock nut. The rears are far wider to carry the turbo V8's torque.`;
const f40Parts = (lb: boolean): CarPart[] => [
  {
    id: "body",
    name: lb ? "Widebody shell" : "Composite body",
    group: "Exterior",
    summary: lb
      ? "The F40's composite skin with a Liberty Walk-style widebody kit: bolt-on arches riveted over the original wings, a deeper splitter and side skirts."
      : "Panels of Kevlar, carbon fibre and aluminium bonded to a tubular steel frame. Pininfarina shaped it in wind-tunnel sessions; there is almost no trim inside.",
    specs: lb
      ? [
          ["Base car", "Ferrari F40"],
          ["Kit", "Over-fender widebody (in this model)"],
          ["Fixing", "Exposed rivets"],
        ]
      : [
          ["Length", "4,358 mm"],
          ["Width", "1,970 mm"],
          ["Height", "1,124 mm"],
          ["Wheelbase", "2,450 mm"],
          ["Dry weight", "1,100 kg"],
          ["Designer", "Pininfarina"],
        ],
    note: lb ? "Liberty Walk is a Nagoya tuning shop known for riveted over-fenders on supercars." : undefined,
  },
  {
    id: "hood",
    name: "Front clamshell",
    group: "Exterior",
    summary: "One piece from the nose to the windscreen, with the pop-up headlamps, the NACA ducts that feed the cabin and the radiator exits.",
    specs: [["Opens", "Hinged at the front"]],
  },
  {
    id: "lid",
    name: "Rear clamshell and wing",
    group: "Exterior",
    summary: "The whole tail lifts as one piece, with the slatted Lexan engine cover and the fixed rear wing moulded in.",
    specs: [
      ["Window", "Louvred Lexan"],
      ["Wing", "Fixed, integral"],
    ],
  },
  {
    id: "door_left",
    name: "Left door",
    group: "Exterior",
    summary: "A light composite door with a sliding plastic window. Inside there is no handle, only a pull cord.",
    specs: [["Side", "Left"]],
  },
  {
    id: "door_right",
    name: "Right door",
    group: "Exterior",
    summary: "The right-hand door, mirroring the left: composite shell, sliding window, pull-cord release.",
    specs: [["Side", "Right"]],
  },
  {
    id: "headlights",
    name: "Headlamps",
    group: "Exterior",
    summary: "Pop-up headlamps behind the clamshell, with fixed lamps under clear covers in the nose for parking and indicators.",
    specs: [["Main beams", "Pop-up"]],
  },
  {
    id: "taillights",
    name: "Tail lamps",
    group: "Exterior",
    summary: "Twin round lamps each side, set into the mesh-covered tail between the exhaust outlets.",
    specs: [["Layout", "Two round lamps per side"]],
  },
  {
    id: "engine",
    name: "2.9 L twin-turbo V8",
    group: "Powertrain",
    summary:
      "The Tipo F120A: a 90° V8 with four valves per cylinder and two IHI turbochargers, mounted longitudinally behind the cabin. Ferrari's last car approved by Enzo Ferrari himself.",
    specs: [
      ["Displacement", "2,936 cc"],
      ["Power", "478 PS at 7,000 rpm"],
      ["Torque", "577 Nm at 4,000 rpm"],
      ["Gearbox", "5-speed manual"],
      ["Top speed", "324 km/h"],
    ],
  },
  {
    id: "chassis",
    name: "Floor and suspension",
    group: "Chassis",
    summary: "A tubular steel frame with composite panels, and double wishbones at every corner. No power steering, no brake servo and no ABS.",
    specs: [
      ["Suspension", "Double wishbones, all round"],
      ["Assists", "None"],
    ],
  },
  ...corners.map(([c, f, l]) => wheel(`wheel_${c}`, f, l, f40Wheel, [["Wheel", "17 in, centre-lock"]])),
  ...corners.map(([c, f, l]): CarPart => ({
    id: `brake_${c}`,
    name: `${f ? "Front" : "Rear"} ${l ? "left" : "right"} brake`,
    group: "Chassis",
    summary: "A Brembo cross-drilled, ventilated steel disc with a four-piston caliper, worked without a servo.",
    specs: [["Position", `${f ? "Front" : "Rear"} axle, ${l ? "left" : "right"}`]],
  })),
  {
    id: "seats",
    name: "Cockpit",
    group: "Cabin",
    summary: "Two fixed shell seats in red cloth, bare carbon-weave floors and no carpets, door cards or radio.",
    specs: [["Seats", "2"]],
  },
  {
    id: "dashboard",
    name: "Instruments",
    group: "Cabin",
    summary: "A felt-covered dash with orange-on-black gauges, including the turbo boost gauge.",
    specs: [["Boost gauge", "Yes"]],
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "A three-spoke Momo wheel with the prancing horse in the boss, on the left in this model.",
    specs: [["Side", "Left-hand drive (in this model)"]],
  },
];

// ---------------------------------------------------------------------- Aston Martin Vulcan
const vulcanParts: CarPart[] = [
  {
    id: "body",
    name: "Carbon body",
    group: "Exterior",
    summary:
      "A carbon-fibre monocoque and body built for the track only, never homologated for the road. Aston Martin built 24 cars.",
    specs: [
      ["Structure", "Carbon-fibre monocoque"],
      ["Built", "24 cars, from 2015"],
      ["Use", "Track only"],
    ],
  },
  {
    id: "hood",
    name: "Bonnet",
    group: "Exterior",
    summary: "The long carbon bonnet over the V12, with big vents to pull hot air out of the engine bay and the front wheel arches.",
    specs: [["Material", "Carbon fibre"]],
  },
  {
    id: "lid",
    name: "Rear deck and wing",
    group: "Exterior",
    summary: "The tail section with the swan-neck rear wing and the diffuser beneath, which together make most of the car's downforce.",
    specs: [["Wing", "Swan-neck mounts"]],
  },
  {
    id: "door_left",
    name: "Left door",
    group: "Exterior",
    summary: "A carbon door that swings up and forward, with the mirror on its leading edge.",
    specs: [["Side", "Left"]],
  },
  {
    id: "door_right",
    name: "Right door",
    group: "Exterior",
    summary: "The right-hand door, mirroring the left.",
    specs: [["Side", "Right"]],
  },
  {
    id: "headlights",
    name: "Headlamps",
    group: "Exterior",
    summary: "Slim LED headlamps set into the nose beside the wide Aston Martin grille.",
    specs: [["Type", "LED"]],
  },
  {
    id: "taillights",
    name: "Tail lamps",
    group: "Exterior",
    summary: "Thin LED blades that run across the tail under the wing, like those on the One-77.",
    specs: [["Type", "LED blades"]],
  },
  {
    id: "engine",
    name: "7.0 L V12",
    group: "Powertrain",
    summary:
      "A naturally aspirated V12 developed from Aston Martin's racing engines, mounted behind the front axle. It drives the rear wheels through a sequential gearbox.",
    specs: [
      ["Layout", "V12, front-mid-mounted"],
      ["Displacement", "7.0 L"],
      ["Power", "820 PS"],
      ["Gearbox", "6-speed sequential"],
      ["Drive", "Rear-wheel drive"],
    ],
  },
  {
    id: "chassis",
    name: "Floor and suspension",
    group: "Chassis",
    summary: "The flat carbon floor and the racing suspension underneath it. The car was built with Multimatic, which also builds the Ford GT.",
    specs: [["Partner", "Multimatic"]],
  },
  ...corners.map(([c, f, l]) =>
    wheel(`wheel_${c}`, f, l, "A centre-lock forged wheel on a Michelin racing tyre.", [["Fixing", "Centre-lock"]]),
  ),
  ...corners.map(([c, f, l]): CarPart => ({
    id: `brake_${c}`,
    name: `${f ? "Front" : "Rear"} ${l ? "left" : "right"} brake`,
    group: "Chassis",
    summary: "A carbon-ceramic disc with a racing caliper, sized to stop the car again and again from top speed on track.",
    specs: [
      ["Disc", "Carbon-ceramic"],
      ["Position", `${f ? "Front" : "Rear"} axle, ${l ? "left" : "right"}`],
    ],
  })),
  {
    id: "seats",
    name: "Cockpit",
    group: "Cabin",
    summary: "Carbon racing seats inside the tub, with harnesses and a roll structure, plus room for a passenger.",
    specs: [["Seats", "2"]],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    group: "Cabin",
    summary: "A bare carbon dash with the switch panel and display a driver needs on track, and nothing else.",
    specs: [["Trim", "Exposed carbon"]],
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "A flat-topped racing wheel with its own screen and the controls for pit limiter, radio and traction settings.",
    specs: [["Type", "Racing wheel with display"]],
  },
];

// ---------------------------------------------------------------------- Toyota GR Supra GT300
const supraParts: CarPart[] = [
  {
    id: "body",
    name: "Race body",
    group: "Exterior",
    summary:
      "The GR Supra rebuilt to Japan's Super GT rules for the GT300 class: wide arches, a roll cage inside and aero allowed by the regulations.",
    specs: [
      ["Series", "Super GT, GT300 class"],
      ["Base car", "GR Supra (A90)"],
    ],
    note: "In this model: a team livery printed into the body texture, so the paint picker leaves it as it is.",
  },
  {
    id: "hood",
    name: "Bonnet",
    group: "Exterior",
    summary: "A lightweight bonnet with large vents to let hot air out of the engine bay.",
    specs: [["Vents", "Louvred outlets"]],
  },
  {
    id: "lid",
    name: "Rear wing",
    group: "Exterior",
    summary: "A big swan-neck rear wing on tall pillars, with the deck lid beneath it.",
    specs: [["Mount", "Swan-neck"]],
  },
  {
    id: "door_left",
    name: "Left door",
    group: "Exterior",
    summary: "A light composite door with the side mirror on a race mount.",
    specs: [["Side", "Left"]],
  },
  {
    id: "door_right",
    name: "Right door",
    group: "Exterior",
    summary: "The driver's door, on the right of this right-hand-drive car.",
    specs: [["Side", "Right (driver)"]],
  },
  {
    id: "headlights",
    name: "Headlamps",
    group: "Exterior",
    summary: "The road Supra's headlamp shape, kept so the race car still looks like the one in showrooms, set into the aero nose.",
    specs: [["Position", "Front corners"]],
  },
  {
    id: "taillights",
    name: "Tail lamps",
    group: "Exterior",
    summary: "Tail lamps and the rain light at the back, under the wing.",
    specs: [["Position", "Rear"]],
  },
  {
    id: "engine",
    name: "Engine bay",
    group: "Powertrain",
    summary: "GT300 lets teams run a range of engines. A balance-of-performance table sets power and weight so different cars can race each other.",
    specs: [
      ["Rules", "Balance of performance"],
      ["Drive", "Rear-wheel drive"],
    ],
  },
  {
    id: "chassis",
    name: "Splitter, floor and suspension",
    group: "Chassis",
    summary: "The front splitter, flat floor and rear diffuser, with the racing suspension mounted underneath.",
    specs: [["Aero", "Splitter, flat floor, diffuser"]],
  },
  ...corners.map(([c, f, l]) => wheel(`wheel_${c}`, f, l, "A forged racing wheel on a slick tyre, with a single centre-lock nut for pit stops.", [["Fixing", "Centre-lock"]])),
  ...corners.map(([c, f, l]): CarPart => ({
    id: `brake_${c}`,
    name: `${f ? "Front" : "Rear"} ${l ? "left" : "right"} brake`,
    group: "Chassis",
    summary: "A ventilated racing disc and caliper, with its upright and suspension arms.",
    specs: [["Position", `${f ? "Front" : "Rear"} axle, ${l ? "left" : "right"}`]],
  })),
  {
    id: "seats",
    name: "Cockpit",
    group: "Cabin",
    summary: "A single race seat with harness inside a welded roll cage.",
    specs: [["Seats", "1"]],
  },
  {
    id: "dashboard",
    name: "Dashboard",
    group: "Cabin",
    summary: "The original dash shape kept, with a racing switch panel and data display.",
    specs: [["Display", "Data logger"]],
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "A racing wheel with a built-in display and buttons, on the right.",
    specs: [["Side", "Right-hand drive"]],
  },
];

// ---------------------------------------------------------------------- the line-up
export const cars: Car[] = [
  {
    slug: "lykan-hypersport",
    name: lykanMeta.name,
    short: "Lykan",
    maker: lykanMeta.maker,
    year: "2013",
    model: "/models/lykan.glb",
    tagline: "A seven-car hypercar with diamond-set headlights.",
    facts: lykanMeta.facts,
    parts: lykanParts,
    view: { target: [0, 0.5, 0], camera: [5.4, 2.0, 5.6], cameraNarrow: [8.2, 3.4, 8.6] },
    paint: {
      material: "Paint",
      colors: [
        { name: "Rosso Lykan", hex: "#7a0a12" },
        { name: "Obsidian", hex: "#0c0d10", metalness: 0.5, roughness: 0.22 },
        { name: "Pearl White", hex: "#e9e7e2", metalness: 0.3, roughness: 0.25 },
        { name: "Acid Lime", hex: "#a9d81c", metalness: 0.55, roughness: 0.26 },
        { name: "Midnight Blue", hex: "#13254f", metalness: 0.7, roughness: 0.28 },
        { name: "Liquid Silver", hex: "#a4a8ad", metalness: 0.95, roughness: 0.18 },
      ],
    },
    lamps: { head: ["LED", "LEDAmber"], tail: ["TailLED"] },
  },
  {
    slug: "jaguar-xj13",
    name: "Jaguar XJ13",
    short: "XJ13",
    maker: "Jaguar",
    year: "1966",
    model: "/models/cars/jaguar-xj13.glb",
    tagline: "Built for Le Mans, never raced. The only one ever made.",
    facts: [
      ["Engine", "5.0 L DOHC V12"],
      ["Power", "502 hp"],
      ["Weight", "998 kg"],
      ["Built", "1 car, 1966"],
    ],
    parts: jaguarParts,
    view: { target: [0, 0.42, 0], camera: [5.0, 1.8, 5.2], cameraNarrow: [7.8, 3.0, 8.2] },
    paint: {
      material: "Mesh15Mtl",
      colors: [
        { name: "Racing Green", hex: "#3a6e62" },
        { name: "Opalescent Silver", hex: "#b4b8bc", metalness: 0.9, roughness: 0.22 },
        { name: "Old English White", hex: "#e6dfcc", metalness: 0.2, roughness: 0.3 },
        { name: "Carmen Red", hex: "#8c1010", metalness: 0.45, roughness: 0.3 },
        { name: "Dark Blue", hex: "#1a2640", metalness: 0.6, roughness: 0.32 },
      ],
    },
    lamps: { head: ["Mesh13Mtl", "Mesh61Mtl"], tail: ["Mesh71Mtl"] },
    credit: { title: "1959 Jaguar XJ13", author: "vecarz.com", url: "https://www.vecarz.com" },
  },
  {
    slug: "toyota-land-cruiser",
    name: "Toyota Land Cruiser 300",
    short: "Land Cruiser",
    maker: "Toyota",
    year: "2021",
    model: "/models/cars/toyota-land-cruiser.glb",
    tagline: "The body-on-frame flagship, built to outlast the roads it is driven on.",
    facts: [
      ["Engine", "Twin-turbo V6"],
      ["Gearbox", "10-speed auto"],
      ["Clearance", "230 mm"],
      ["Platform", "TNGA GA-F"],
    ],
    parts: toyotaParts,
    view: { target: [0, 0.85, 0], camera: [6.0, 2.4, 6.2], cameraNarrow: [9.0, 3.8, 9.4] },
    paint: {
      material: "Metallic",
      colors: [
        { name: "Precious White Pearl", hex: "#f4ecec" },
        { name: "Attitude Black", hex: "#0e0f12", metalness: 0.55, roughness: 0.18 },
        { name: "Avant-Garde Bronze", hex: "#6e5a44", metalness: 0.8, roughness: 0.25 },
        { name: "Dark Red Mica", hex: "#5c1118", metalness: 0.65, roughness: 0.22 },
        { name: "Silver Metallic", hex: "#a8abaf", metalness: 0.9, roughness: 0.2 },
      ],
    },
    lamps: { head: ["Metallic_2", "Translucent"], tail: ["Metallic_1"] },
    credit: {
      title: "Toyota Landcruiser V8 2022",
      author: "Jean-llace cars",
      url: "https://sketchfab.com/3d-models/toyota-landcruiser-v8-2022-1cf2904171374f63ab977e93b56506d3",
      license: "CC BY 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
  {
    slug: "ferrari-f40",
    name: "Ferrari F40",
    short: "F40",
    maker: "Ferrari",
    year: "1987",
    model: "/models/cars/ferrari-f40.glb",
    tagline: "Built for Ferrari's 40th birthday: a turbo V8, a composite body and no assists at all.",
    facts: [
      ["Engine", "2.9 L twin-turbo V8"],
      ["Power", "478 PS"],
      ["Top speed", "324 km/h"],
      ["Built", "1987–1992"],
    ],
    parts: f40Parts(false),
    view: { target: [0, 0.42, 0], camera: [5.2, 1.9, 5.4], cameraNarrow: [8.0, 3.2, 8.4] },
    paint: {
      material: "material",
      colors: [
        { name: "Rosso Corsa", hex: "#a8100c" },
        { name: "Giallo Modena", hex: "#f0b800", metalness: 0.2, roughness: 0.25 },
        { name: "Nero", hex: "#0c0d10", metalness: 0.4, roughness: 0.2 },
        { name: "Bianco", hex: "#e9e7e2", metalness: 0.2, roughness: 0.25 },
        { name: "Argento", hex: "#a4a8ad", metalness: 0.9, roughness: 0.2 },
      ],
    },
    lamps: { head: ["super_headlight"], tail: ["super_brakelight"] },
    credit: {
      title: "Ferrari f40",
      author: "Black Snow",
      url: "https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70",
      license: "CC BY 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
  {
    slug: "ferrari-f40-liberty-walk",
    name: "Ferrari F40 Liberty Walk",
    short: "F40 LB",
    maker: "Ferrari · Liberty Walk",
    year: "1987",
    model: "/models/cars/ferrari-f40-lb.glb",
    tagline: "The F40 with riveted-on widebody arches, in the Liberty Walk style.",
    facts: [
      ["Engine", "2.9 L twin-turbo V8"],
      ["Power", "478 PS (stock)"],
      ["Body", "Widebody kit"],
      ["Base car", "1987 F40"],
    ],
    parts: f40Parts(true),
    view: { target: [0, 0.42, 0], camera: [5.2, 1.9, 5.4], cameraNarrow: [8.0, 3.2, 8.4] },
    paint: {
      material: "Material.040_16",
      colors: [
        { name: "Gloss Black", hex: "#111114" },
        { name: "Rosso Corsa", hex: "#a8100c", metalness: 0.3, roughness: 0.22 },
        { name: "Bianco", hex: "#e9e7e2", metalness: 0.2, roughness: 0.25 },
        { name: "Giallo Modena", hex: "#f0b800", metalness: 0.2, roughness: 0.25 },
        { name: "Grigio", hex: "#5d6166", metalness: 0.8, roughness: 0.25 },
      ],
    },
    lamps: { head: ["Material.040_45"], tail: ["lg2_tailight_f40.001", "lg2_tailight_f40.001_2", "lg2_tailight_f40.001_3"] },
    credit: {
      title: "Ferrari F40 Liberty Walk",
      author: "VTX",
      url: "https://sketchfab.com/3d-models/ferrari-f40-liberty-walk-cd6d8c85cfd44662af030247b19eb27c",
      license: "CC BY-NC-SA 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
  },
  {
    slug: "aston-martin-vulcan",
    name: "Aston Martin Vulcan",
    short: "Vulcan",
    maker: "Aston Martin",
    year: "2015",
    model: "/models/cars/aston-martin-vulcan.glb",
    tagline: "A track-only V12 hypercar. 24 were built, and none is road legal.",
    facts: [
      ["Engine", "7.0 L V12"],
      ["Power", "820 PS"],
      ["Gearbox", "6-speed sequential"],
      ["Built", "24 cars"],
    ],
    parts: vulcanParts,
    view: { target: [0, 0.45, 0], camera: [5.8, 2.0, 6.0], cameraNarrow: [8.8, 3.4, 9.2] },
    paint: {
      material: "CAR_PAINT",
      colors: [
        { name: "Deep Blue", hex: "#0a3a5c" },
        { name: "Racing Green", hex: "#1f4a3a", metalness: 0.6, roughness: 0.25 },
        { name: "Silver", hex: "#a8acb0", metalness: 0.9, roughness: 0.2 },
        { name: "Black", hex: "#0c0d10", metalness: 0.5, roughness: 0.22 },
        { name: "Orange", hex: "#d4570f", metalness: 0.4, roughness: 0.25 },
      ],
    },
    lamps: { head: ["HEADLIGHT", "REFLECTOR"], tail: ["TAILLIGHTS_INNER"] },
    credit: {
      title: "Aston Martin Vulcan",
      author: "Outlaw Games",
      url: "https://sketchfab.com/3d-models/aston-martin-vulcan-707342c93db7411bb29c077d3ef2b147",
      license: "CC BY-NC 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by-nc/4.0/",
    },
  },
  {
    slug: "toyota-supra-gt300",
    name: "Toyota GR Supra GT300",
    short: "Supra GT300",
    maker: "Toyota",
    year: "2020",
    model: "/models/cars/toyota-supra-gt300.glb",
    tagline: "The GR Supra built for the GT300 class of Japan's Super GT.",
    facts: [
      ["Series", "Super GT"],
      ["Class", "GT300"],
      ["Base car", "GR Supra (A90)"],
      ["Drive", "Right-hand"],
    ],
    parts: supraParts,
    view: { target: [0, 0.5, 0], camera: [5.6, 2.0, 5.8], cameraNarrow: [8.6, 3.4, 9.0] },
    // the livery is printed into the body texture, so it is the only finish offered
    paint: { material: "01_-_Default", colors: [{ name: "Team livery", hex: "#e6e6e6" }] },
    lamps: { head: ["06_-_Default"], tail: ["06_-_Default"] },
    credit: {
      title: "ToyotaGR Supra GT300",
      author: "vecarz",
      url: "https://sketchfab.com/3d-models/toyotagr-supra-gt300-wwwvecarzcom-1666c35171b649a8a927da53bdadf228",
      license: "CC BY 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
];

export const carBySlug = Object.fromEntries(cars.map((c) => [c.slug, c])) as Record<string, Car>;
