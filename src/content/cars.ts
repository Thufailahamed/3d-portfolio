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
    credit: {
      title: "Toyota Landcruiser V8 2022",
      author: "Jean-llace cars",
      url: "https://sketchfab.com/3d-models/toyota-landcruiser-v8-2022-1cf2904171374f63ab977e93b56506d3",
      license: "CC BY 4.0",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  },
];

export const carBySlug = Object.fromEntries(cars.map((c) => [c.slug, c])) as Record<string, Car>;
