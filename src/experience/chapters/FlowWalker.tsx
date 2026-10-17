"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { footstep } from "@/lib/sound";
import { useApp } from "@/store/useApp";
import {
  CROUCH_EYE,
  CROUCH_SPEED,
  EYE,
  RUN_SPEED,
  SHOWCASE_CENTERS,
  STEP_UP,
  WALK_SPEED,
  floorAt,
  isIndoors,
  surfaceAt,
  moveBody,
  zoneAt,
} from "../flowWalk";

const { damp, clamp, lerp } = THREE.MathUtils;
/** Radians of look per mouse count at sensitivity 1. */
const LOOK_BASE = 0.0021;
const GRAVITY = 17;
const JUMP_V = 4.6;
/** Physics runs at a fixed 90 Hz and is interpolated for display, so frame hitches never judder. */
const TICK = 1 / 90;
const MAX_TICKS = 8;
const moved = { x: 0, z: 0 };

/**
 * First-person controller for the pavilion.
 *
 * - Runs before the camera rig (priority -1) so the camera never lags a frame behind the mouse.
 * - Movement, collision, gravity and stairs step at a fixed rate; the drawn position is
 *   interpolated between the last two ticks.
 * - Look is raw, with optional light smoothing; head bob, footfalls, landing dip, crouch,
 *   strafe / turn roll and a sprint FOV kick give the body weight.
 */
export default function FlowWalker() {
  const lastStep = useRef(0);
  const fovBase = useRef<number | null>(null);
  const sim = useRef({ acc: 0, px: 0, pz: 0, pFeet: 0, prevYaw: 0 });

  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const app = useApp.getState();
    const flow = sceneState.flow;
    const fp = flow.fp;
    const s = fp.settings;
    const frame = Math.min(dt, 0.1);

    // Field of view: wide and human in first person, back to the cinematic lens elsewhere
    fovBase.current ??= cam.fov;
    const walking = app.mode === "flow" && app.flowView === "walk";
    const targetFov = walking
      ? (app.isMobile ? 74 : 70) + (fp.sprinting ? 6 : 0) - fp.crouch * 3
      : fovBase.current;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = damp(cam.fov, targetFov, walking ? 6 : 3, frame);
      cam.updateProjectionMatrix();
    }

    if (!walking) {
      flow.rigRate = 3.2;
      flow.roll = 0;
      fp.t = 0;
      fp.speed = 0;
      fp.sprinting = false;
      return;
    }

    const S = sim.current;
    fp.t += frame;
    // ease in from wherever the camera was; the follow rate ramps smoothly until it locks on
    flow.rigRate = fp.t < 1.4 ? 3 + (fp.t / 1.4) ** 2 * 120 : 1000;

    if (fp.needsGround) {
      fp.feet = floorAt(fp.x, fp.z, 25) ?? -0.42;
      fp.eye = fp.feet + EYE;
      fp.vx = fp.vz = fp.vy = 0;
      fp.grounded = true;
      fp.needsGround = false;
      fp.viewYaw = fp.yaw;
      fp.viewPitch = fp.pitch;
      S.acc = 0;
      S.px = fp.x;
      S.pz = fp.z;
      S.pFeet = fp.feet;
      S.prevYaw = fp.yaw;
    }

    // ---- look (per frame, never tied to the physics tick)
    const sens = LOOK_BASE * s.sens;
    fp.yaw -= fp.lookDX * sens;
    fp.pitch = clamp(fp.pitch - fp.lookDY * sens * (s.invertY ? -1 : 1), -1.4, 1.4);
    fp.lookDX = 0;
    fp.lookDY = 0;
    if (s.smooth) {
      // ~30ms of smoothing: irons out uneven mouse reports without feeling floaty
      fp.viewYaw = damp(fp.viewYaw, fp.yaw, 32, frame);
      fp.viewPitch = damp(fp.viewPitch, fp.pitch, 32, frame);
    } else {
      fp.viewYaw = fp.yaw;
      fp.viewPitch = fp.pitch;
    }

    // ---- fixed-step physics
    S.acc += frame;
    let ticks = 0;
    while (S.acc >= TICK && ticks < MAX_TICKS) {
      S.px = fp.x;
      S.pz = fp.z;
      S.pFeet = fp.feet;
      step(TICK);
      S.acc -= TICK;
      ticks++;
    }
    if (ticks === MAX_TICKS) S.acc = 0;
    const alpha = S.acc / TICK;
    const rx = lerp(S.px, fp.x, alpha);
    const rz = lerp(S.pz, fp.z, alpha);
    const rFeet = lerp(S.pFeet, fp.feet, alpha);

    // ---- body: crouch, eye height over stairs, landing dip
    fp.crouch = damp(fp.crouch, fp.keys.crouch && fp.grounded ? 1 : 0, 9, frame);
    const eyeH = lerp(EYE, CROUCH_EYE, fp.crouch);
    // the head follows the feet smoothly, so steps read as steps rather than teleports
    fp.eye = fp.grounded ? damp(fp.eye, rFeet + eyeH, 14, frame) : rFeet + eyeH;
    fp.dip = damp(fp.dip, 0, 6, frame);

    // ---- gait: head bob, sway and footfalls
    fp.bob = damp(fp.bob, fp.grounded ? clamp(fp.speed / WALK_SPEED, 0, 1.4) : 0, 5, frame);
    if (fp.speed > 0.2) fp.phase += frame * (4.2 + fp.speed * 0.8);
    const stepIndex = Math.floor(fp.phase / Math.PI);
    if (stepIndex !== lastStep.current) {
      lastStep.current = stepIndex;
      if (fp.speed > 0.6 && fp.grounded) {
        footstep(isIndoors(fp.x, fp.z) ? "marble" : surfaceAt(fp.x, fp.z), (0.5 + fp.speed * 0.1) * (1 - fp.crouch * 0.5));
      }
    }
    const bobScale = s.bob ? 1 : 0.15;
    const bobY = (Math.abs(Math.sin(fp.phase)) - 0.5) * 0.05 * fp.bob * bobScale;
    const sway = Math.cos(fp.phase) * 0.022 * fp.bob * bobScale;
    const breathe = Math.sin(state.clock.elapsedTime * 1.3) * 0.006 * (1 - Math.min(1, fp.bob));

    // ---- roll: lean a touch into strafes and fast turns
    const yawRate = (fp.viewYaw - S.prevYaw) / Math.max(frame, 1e-3);
    S.prevYaw = fp.viewYaw;
    const rightX = Math.cos(fp.viewYaw);
    const rightZ = -Math.sin(fp.viewYaw);
    const lateral = fp.vx * rightX + fp.vz * rightZ;
    const rollTarget = s.bob ? clamp(-lateral * 0.007 + yawRate * 0.004, -0.04, 0.04) : 0;
    fp.roll = damp(fp.roll, rollTarget, 7, frame);
    flow.roll = fp.roll;

    // ---- camera target
    const [ox, oy, oz] = FLOW_ORIGIN;
    const ex = rx + rightX * sway;
    const ez = rz + rightZ * sway;
    const ey = fp.eye + bobY + breathe - fp.dip;
    const lp = fp.viewPitch + Math.sin(fp.phase * 2) * 0.004 * fp.bob * bobScale;
    const cp = Math.cos(lp);
    flow.pos = [ox + ex, oy + ey, oz + ez];
    flow.look = [
      ox + ex - Math.sin(fp.viewYaw) * cp * 10,
      oy + ey + Math.sin(lp) * 10,
      oz + ez - Math.cos(fp.viewYaw) * cp * 10,
    ];

    // ---- what are we looking at? nearest showcase in front within reach
    let best = -1;
    let bestD = 5.2;
    const lx = -Math.sin(fp.viewYaw);
    const lz = -Math.cos(fp.viewYaw);
    SHOWCASE_CENTERS.forEach((c, i) => {
      const tx = c.x - rx;
      const tz = c.z - rz;
      const dist = Math.hypot(tx, tz);
      if (dist < bestD && (tx * lx + tz * lz) / (dist || 1) > 0.8) {
        best = i;
        bestD = dist;
      }
    });
    fp.target = best;
    fp.zone = zoneAt(rx, rz);
    fp.indoors = isIndoors(rx, rz);
  }, -1);

  return null;
}

/** One fixed physics tick: intent → velocity → collide → stairs / gravity / jump. */
function step(h: number) {
  const fp = sceneState.flow.fp;
  const k = fp.keys;

  let ix = (k.r ? 1 : 0) - (k.l ? 1 : 0) + fp.joy.x;
  let iz = (k.f ? 1 : 0) - (k.b ? 1 : 0) + fp.joy.y;
  const il = Math.hypot(ix, iz);
  if (il > 1) {
    ix /= il;
    iz /= il;
  }
  if (fp.frozen) ix = iz = 0;

  const crouching = k.crouch && fp.grounded;
  fp.sprinting = !crouching && (k.sprint || Math.hypot(fp.joy.x, fp.joy.y) > 0.95) && iz > 0.3 && fp.grounded;
  // backpedalling and pure strafing are a little slower than walking forward
  const dirScale = iz < -0.1 ? 0.75 : Math.abs(ix) > Math.abs(iz) ? 0.9 : 1;
  const maxSpeed = (crouching ? CROUCH_SPEED : fp.sprinting ? RUN_SPEED : WALK_SPEED) * dirScale;

  const fx = -Math.sin(fp.yaw);
  const fz = -Math.cos(fp.yaw);
  const rx = Math.cos(fp.yaw);
  const rz = -Math.sin(fp.yaw);
  const wishX = (fx * iz + rx * ix) * maxSpeed;
  const wishZ = (fz * iz + rz * ix) * maxSpeed;
  const wishing = Math.hypot(wishX, wishZ) > 0.01;
  // quick, weighty starts and a short glide to a stop; little control in the air
  const rate = fp.grounded ? (wishing ? 10 : 12) : 1.5;
  fp.vx = damp(fp.vx, wishX, rate, h);
  fp.vz = damp(fp.vz, wishZ, rate, h);
  if (!wishing && Math.hypot(fp.vx, fp.vz) < 0.03) fp.vx = fp.vz = 0;

  // horizontal move with collision; measure what actually happened (walls eat velocity)
  const x0 = fp.x;
  const z0 = fp.z;
  if (fp.vx !== 0 || fp.vz !== 0) {
    moveBody(fp.x, fp.z, fp.feet, fp.vx * h, fp.vz * h, moved);
    fp.x = moved.x;
    fp.z = moved.z;
    const ax = (fp.x - x0) / h;
    const az = (fp.z - z0) / h;
    // bleed velocity into walls so you slide off them instead of pressing in
    if (Math.hypot(ax, az) < Math.hypot(fp.vx, fp.vz) - 0.05) {
      fp.vx = lerp(fp.vx, ax, 0.5);
      fp.vz = lerp(fp.vz, az, 0.5);
    }
  }
  const real = Math.hypot(fp.x - x0, fp.z - z0) / h;
  fp.speed = damp(fp.speed, fp.grounded ? real : 0, 10, h);

  // vertical: floor under us, stairs, gravity, jump
  const ground = floorAt(fp.x, fp.z, fp.feet + STEP_UP) ?? -0.42;
  if (k.jump && fp.grounded && !fp.frozen && !crouching) {
    fp.vy = JUMP_V;
    fp.grounded = false;
  }
  k.jump = false;
  if (fp.grounded) {
    if (ground < fp.feet - 0.6) fp.grounded = false; // stepped off a ledge
    else fp.feet = ground;
  }
  if (!fp.grounded) {
    fp.vy -= GRAVITY * h;
    fp.feet += fp.vy * h;
    if (fp.feet <= ground && fp.vy <= 0) {
      const impact = -fp.vy;
      fp.feet = ground;
      fp.vy = 0;
      fp.grounded = true;
      fp.dip = Math.min(0.2, impact * 0.032);
      if (impact > 2) footstep(isIndoors(fp.x, fp.z) ? "marble" : surfaceAt(fp.x, fp.z), 0.6 + impact * 0.12);
    }
  }
}
