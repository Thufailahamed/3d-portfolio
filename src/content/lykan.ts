/**
 * Part sheet for the Lykan HyperSport exploded view (/lykan). Ids match the `Part_<id>` groups in
 * public/models/lykan.glb. Specs come from W Motors' published figures (performance figures are
 * the maker's claims); lines starting "In this model" describe how the 3D model shows a part
 * where the real car's detail isn't public.
 */

export type PartGroup = "Exterior" | "Powertrain" | "Chassis" | "Cabin";

export type LykanPart = {
  id: string;
  name: string;
  group: PartGroup;
  summary: string;
  specs: [string, string][];
  note?: string;
};

export const lykan = {
  name: "Lykan HyperSport",
  maker: "W Motors",
  tagline: "Click any part to pull it out of the car.",
  facts: [
    ["Engine", "3.7 L twin-turbo flat-six"],
    ["Power", "740 hp (claimed)"],
    ["Top speed", "395 km/h (claimed)"],
    ["Built", "7 cars, 2013–2018"],
  ] as [string, string][],
};

const wheel = (id: string, front: boolean, left: boolean): LykanPart => ({
  id,
  name: `${front ? "Front" : "Rear"} ${left ? "left" : "right"} wheel`,
  group: "Chassis",
  summary: `Forged aluminium wheel on a Pirelli P Zero. The rears are an inch larger and far wider than the fronts to put the flat-six's torque down.`,
  specs: [
    ["Wheel", front ? "19 in, forged aluminium" : "20 in, forged aluminium"],
    ["Tyre", front ? "Pirelli P Zero 255/35 ZR19" : "Pirelli P Zero 335/30 ZR20"],
    ["Position", `${front ? "Front" : "Rear"} axle, ${left ? "left" : "right"} side`],
  ],
  note: "In this model: five Y-spoke wheels in gloss black with a centre-lock nut.",
});

const brake = (id: string, front: boolean, left: boolean): LykanPart => ({
  id,
  name: `${front ? "Front" : "Rear"} ${left ? "left" : "right"} brake`,
  group: "Chassis",
  summary: "Ventilated ceramic-composite disc gripped by a six-piston aluminium caliper. The same size disc is used at every corner.",
  specs: [
    ["Disc", "380 mm ventilated ceramic composite"],
    ["Caliper", "6-piston aluminium"],
    ["Position", `${front ? "Front" : "Rear"} axle, ${left ? "left" : "right"} side`],
  ],
});

export const parts: LykanPart[] = [
  // ------------------------------------------------------------------ exterior
  {
    id: "body",
    name: "Carbon-fibre body",
    group: "Exterior",
    summary:
      "The whole skin is carbon fibre, drawn as a low wedge with fender tips that thrust past the hood, a deep scoop through each door and an open mesh tail.",
    specs: [
      ["Length", "4,480 mm"],
      ["Width", "1,944 mm"],
      ["Height", "1,170 mm"],
      ["Wheelbase", "2,625 mm"],
      ["Kerb weight", "1,380 kg"],
      ["Designers", "Ralph Debbas, Anthony Jannarelly, Benoit Fraylon"],
      ["Price", "US$3.4 million"],
    ],
    note: "Ten stunt cars built for Furious 7 used the same moulds but fibreglass instead of carbon fibre.",
  },
  {
    id: "door_left",
    name: "Left door",
    group: "Exterior",
    summary:
      "W Motors' patented reverse-dihedral door: hinged at the rear and opening upward. It carries the side glass, the scoop face and the mirror.",
    specs: [
      ["Type", "Reverse dihedral"],
      ["Hinge", "Rear"],
      ["Side", "Driver (left-hand drive)"],
    ],
    note: "In this model: quilted leather door card with a speaker, carbon cap and ambient light strip.",
  },
  {
    id: "door_right",
    name: "Right door",
    group: "Exterior",
    summary:
      "The passenger's reverse-dihedral door, hinged at the rear and opening upward. It mirrors the driver's side, scoop and all.",
    specs: [
      ["Type", "Reverse dihedral"],
      ["Hinge", "Rear"],
      ["Side", "Passenger"],
    ],
  },
  {
    id: "hood",
    name: "Front lid",
    group: "Exterior",
    summary:
      "The hood with its sharp centre spine and sunken valleys either side. The engine sits behind the cabin, so this lid opens onto storage.",
    specs: [
      ["Material", "Carbon fibre"],
      ["Opens onto", "Front compartment"],
    ],
  },
  {
    id: "engine_cover",
    name: "Engine cover",
    group: "Exterior",
    summary: "The rear deck over the flat-six, with a dark arrow of louvres along a body-colour spine to let heat out of the bay.",
    specs: [["Covers", "Mid-rear engine bay"]],
    note: "In this model: tinted glass under chevron louvres, so the engine shows through.",
  },
  {
    id: "headlights",
    name: "Jewelled headlights",
    group: "Exterior",
    summary:
      "The first production car with gems in its headlights. Thin titanium LED blades sweep along each fender, set with diamonds.",
    specs: [
      ["Light source", "Titanium LED blades"],
      ["Gems", "440 platinum-set diamonds (15 ct)"],
      ["Options", "Rubies, sapphires or yellow diamonds"],
    ],
  },
  {
    id: "taillights",
    name: "Tail lights",
    group: "Exterior",
    summary: "LED blades in angular chrome frames that wrap the corners of the open mesh tail, with a third brake light above.",
    specs: [["Light source", "LED"]],
  },
  {
    id: "aero",
    name: "Aero and grilles",
    group: "Exterior",
    summary:
      "Everything that manages the air: the front splitter and canards, side blades, honeycomb grilles in every opening, and the finned rear diffuser.",
    specs: [
      ["Top speed", "395 km/h (claimed)"],
      ["Rear", "Diffuser with six strakes"],
    ],
    note: "In this model: the strake count and canard shapes are approximations.",
  },
  // ------------------------------------------------------------------ powertrain
  {
    id: "engine",
    name: "3.7 L flat-six",
    group: "Powertrain",
    summary:
      "A horizontally opposed six developed by RUF Automobile and mounted behind the cabin. The low, flat block keeps the centre of gravity down.",
    specs: [
      ["Code", "CTR38"],
      ["Displacement", "3,746 cc"],
      ["Layout", "Flat-6, mid-rear"],
      ["Power", "552 kW (740 hp) at 7,100 rpm"],
      ["Torque", "960 Nm at 4,000 rpm"],
      ["Developed by", "RUF Automobile"],
    ],
    note: "Output figures are W Motors' claims; they have not been independently tested.",
  },
  {
    id: "turbo",
    name: "Twin turbochargers",
    group: "Powertrain",
    summary:
      "One turbo per cylinder bank, spun by exhaust gas, forcing compressed air through intercoolers and into the plenum. This is where most of the 960 Nm comes from.",
    specs: [
      ["Count", "2, one per bank"],
      ["Peak torque", "960 Nm at 4,000 rpm"],
    ],
    note: "In this model: air-to-air intercoolers at the rear corners, fed by the side scoops.",
  },
  {
    id: "exhaust",
    name: "Exhaust",
    group: "Powertrain",
    summary: "Downpipes from both turbos run through catalysts into a transverse silencer that exits through the open tail.",
    specs: [["Exits", "Through the rear mesh"]],
    note: "In this model: heat-tinted titanium with four tips.",
  },
  {
    id: "transmission",
    name: "Transmission",
    group: "Powertrain",
    summary:
      "Mounted lengthways at the very back of the car and driving the rear wheels through a limited-slip differential.",
    specs: [
      ["Options", "7-speed dual-clutch or 6-speed sequential"],
      ["Mounting", "Longitudinal, rear"],
      ["Differential", "Limited-slip"],
      ["Drive", "Rear-wheel drive"],
    ],
  },
  {
    id: "cooling",
    name: "Cooling",
    group: "Powertrain",
    summary: "Radiators behind the big front corner intakes, with coolant lines running back under the floor to the engine.",
    specs: [["Radiators", "Front, behind the corner intakes"]],
    note: "In this model: two angled radiators with electric fans.",
  },
  // ------------------------------------------------------------------ chassis
  {
    id: "chassis",
    name: "Chassis",
    group: "Chassis",
    summary: "The structure everything bolts to: a central tub for the cabin with subframes front and rear carrying the suspension and engine.",
    specs: [["Made in", "Germany"]],
    note: "In this model: a carbon tub with aluminium tube subframes and a fuel cell behind the seats.",
  },
  {
    id: "suspension",
    name: "Suspension",
    group: "Chassis",
    summary:
      "Struts up front, a multi-link rear with horizontally mounted coil-over dampers, and anti-roll bars at both ends.",
    specs: [
      ["Front", "MacPherson struts"],
      ["Rear", "Multi-link, horizontal coil-overs"],
      ["Anti-roll bars", "Front and rear"],
    ],
    note: "In this model: shown as wishbones with gold coil-overs for clarity.",
  },
  {
    id: "frunk",
    name: "Front compartment",
    group: "Chassis",
    summary: "The space under the front lid. With the engine behind the cabin, the nose holds storage and electronics.",
    specs: [["Location", "Under the front lid"]],
    note: "In this model: carpeted tub with the battery, ECU and brake-fluid reservoir.",
  },
  wheel("wheel_fl", true, true),
  wheel("wheel_fr", true, false),
  wheel("wheel_rl", false, true),
  wheel("wheel_rr", false, false),
  brake("brake_fl", true, true),
  brake("brake_fr", true, false),
  brake("brake_rl", false, true),
  brake("brake_rr", false, false),
  // ------------------------------------------------------------------ cabin
  {
    id: "seats",
    name: "Seats",
    group: "Cabin",
    summary: "Two sculpted bucket seats trimmed in leather with gold stitching, with deep bolsters to hold you in under cornering.",
    specs: [
      ["Trim", "Leather, gold stitching"],
      ["Seats", "2"],
    ],
    note: "In this model: red diamond quilting, carbon shells, an embroidered W and three-point belts.",
  },
  {
    id: "dashboard",
    name: "Dashboard",
    group: "Cabin",
    summary: "A sweep of stitched leather and carbon across the cabin, with a hooded binnacle over the driver's digital instruments.",
    specs: [["Instruments", "Digital cluster"]],
    note: "In this model: turbine vents, red ambient lighting and drilled aluminium pedals.",
  },
  {
    id: "steering",
    name: "Steering wheel",
    group: "Cabin",
    summary: "A flat-bottomed wheel with suede grips, a carbon rim top and a red centre marker. Paddles behind it change gear.",
    specs: [["Shifting", "Paddles (dual-clutch)"]],
    note: "In this model: shift lights across the top and a W on the boss.",
  },
  {
    id: "console",
    name: "Holographic console",
    group: "Cabin",
    summary:
      "The centre console carries the Lykan's holographic display, an interactive system that responds to hand motion, above the gear and start buttons.",
    specs: [
      ["Display", "Holographic, motion-interactive"],
      ["Controls", "Gear selector, start button, toggles"],
    ],
  },
];

export const partById = Object.fromEntries(parts.map((p) => [p.id, p])) as Record<string, LykanPart>;

export const groups: PartGroup[] = ["Exterior", "Powertrain", "Chassis", "Cabin"];
