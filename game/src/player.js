// player.js — the first-person controller and the player's combat state.
// One job: turn keyboard + mouse into a moving, shooting, crouching agent.
// Movement model (rubric 2): acceleration, not instant speed; crouching halves
// speed and spread; collision with the map via world.collide; stopping to aim pays.
import * as THREE from 'three';
import { WEAPONS, createWeaponState, currentSpread, consumeShot, startReload, tickWeapon, GRENADES } from './weapons.js';
import { TMP } from './state.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;       // m/s^2 while a move key is held
const FRICTION = 34;    // m/s^2 damping when no key is held

export function createPlayer(scene, camera, world) {
  const mesh = new THREE.Group();
  // The player's own viewmodel: a simple gun that bobs and kicks in first person.
  // It hangs off the camera so it follows the view, not the world.
  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.55), new THREE.MeshStandardMaterial({ color: 0x22242c, roughness: 0.4, metalness: 0.7 }));
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: 0x111216, roughness: 0.35, metalness: 0.8 }));
  barrel.position.set(0, 0.02, -0.42);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: 0x2ee6ff, emissive: 0x2ee6ff, emissiveIntensity: 1.5 }));
  glow.position.set(0, 0.075, -0.2);
  gun.add(body, barrel, glow);
  gun.position.set(0.28, -0.24, -0.5);
  camera.add(gun);
  scene.add(camera);

  const p = {
    team: 'vanguard',
    name: 'You',
    pos: new THREE.Vector3(-27, 0, 0),
    vel: new THREE.Vector3(),
    yaw: -Math.PI / 2, // facing east, down mid lane
    pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouched: false, aiming: false, moving: false,
    weapon: createWeaponState('lantern'),
    owned: { petal: true, lantern: true },
    grenades: { frag: 0, smoke: 0, flash: 0 },
    selectedGrenade: 'frag',
    kills: 0,
    pitchKick: 0, yawKick: 0,   // recoil offsets, decayed per tick
    bobT: 0, flashT: 0,         // flashbang blindness timer
    channel: null,              // {kind:'plant'|'defuse', t} while holding E
    gun, world,
    eyeHeight: EYE_STAND,
  };
  return p;
}

export function resetPlayer(p, spawn) {
  p.pos.copy(spawn);
  p.vel.set(0, 0, 0);
  p.yaw = -Math.PI / 2; p.pitch = 0;
  p.hp = 100; p.alive = true;
  p.crouched = false; p.flashT = 0; p.channel = null;
  p.pitchKick = 0; p.yawKick = 0;
  p.weapon = createWeaponState(p.owned.lantern ? 'lantern' : 'petal');
  p.grenades = { frag: 0, smoke: 0, flash: 0 };
}

export function eyePos(p, out) {
  return out.set(p.pos.x, p.eyeHeight, p.pos.z);
}

// Keys are read from this shared object; input.js owns the listeners.
export function updatePlayer(p, input, dt, time) {
  if (!p.alive) return;
  // Crouch: Ctrl toggles; eye height lerps so the view drops smoothly.
  p.crouched = input.keys['ControlLeft'] || input.keys['KeyC'] || false;
  const targetEye = p.crouched ? EYE_CROUCH : EYE_STAND;
  p.eyeHeight += (targetEye - p.eyeHeight) * Math.min(1, dt * 12);
  p.aiming = input.mouseRight;

  // Wish direction from keys, rotated by yaw. Forward is -Z in camera space.
  const fwd = (input.keys['KeyW'] ? 1 : 0) - (input.keys['KeyS'] ? 1 : 0);
  const strafe = (input.keys['KeyD'] ? 1 : 0) - (input.keys['KeyA'] ? 1 : 0);
  p.moving = fwd !== 0 || strafe !== 0;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  TMP.a.set(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe);
  if (TMP.a.lengthSq() > 0) TMP.a.normalize();
  const speed = p.crouched ? CROUCH_SPEED : WALK_SPEED;
  TMP.a.multiplyScalar(speed);
  // Accelerate toward the wish velocity; friction when no key is held.
  if (p.moving) {
    p.vel.x += (TMP.a.x - p.vel.x) * Math.min(1, (ACCEL / speed) * dt);
    p.vel.z += (TMP.a.z - p.vel.z) * Math.min(1, (ACCEL / speed) * dt);
  } else {
    const damp = Math.max(0, 1 - (FRICTION / speed) * dt);
    p.vel.x *= damp; p.vel.z *= damp;
    if (Math.abs(p.vel.x) < 0.02) p.vel.x = 0;
    if (Math.abs(p.vel.z) < 0.02) p.vel.z = 0;
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.world.collide(p.pos, RADIUS);

  // Recoil recovery: the kick decays back toward zero.
  p.pitchKick *= Math.max(0, 1 - dt * 9);
  p.yawKick *= Math.max(0, 1 - dt * 9);
  if (p.flashT > 0) p.flashT -= dt;

  // Head bob on the viewmodel only; the camera stays steady so aim is honest.
  p.bobT += dt * (p.moving ? p.vel.length() * 1.6 : 0);
  const bob = p.moving ? Math.sin(p.bobT) * 0.012 : 0;
  p.gun.position.y = -0.24 + bob;
  p.gun.position.x = 0.28 - (p.aiming ? 0.13 : 0);
  p.gun.position.z = -0.5 - (p.aiming ? 0.12 : 0);

  tickWeapon(p.weapon, dt);
}

// Apply a shot the player fired. Returns the spread used, so combat.js can
// scatter the ray by exactly the same amount the crosshair shows.
export function playerShoot(p) {
  const ws = p.weapon;
  if (ws.mag <= 0) return { fired: false, dry: true };
  if (ws.reloading || ws.cooldown > 0) return { fired: false };
  const spread = currentSpread(ws, p.moving, p.crouched, p.aiming);
  const recoil = consumeShot(ws);
  p.pitchKick += recoil;
  p.yawKick += (Math.random() - 0.5) * recoil * 0.6;
  return { fired: true, spread };
}

export function applyDamage(p, amount, isHead) {
  if (!p.alive) return 0;
  let dmg = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, dmg * 0.5);
    p.armor -= absorbed;
    dmg -= absorbed;
  }
  p.hp -= dmg;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; }
  return dmg;
}

export function buyWeapon(p, id, state) {
  const def = WEAPONS[id];
  if (!def || def.price === 0 && id === 'railgun') return false;
  if (p.owned[id]) { p.weapon = createWeaponState(id); return true; }
  if (state.money < def.price) return false;
  state.money -= def.price;
  p.owned[id] = true;
  p.weapon = createWeaponState(id);
  return true;
}

export function buyGrenade(p, id, state) {
  const g = GRENADES[id];
  if (!g || state.money < g.price) return false;
  state.money -= g.price;
  p.grenades[id] += 1;
  return true;
}

export function buyArmor(p, state) {
  if (state.money < 650 || p.armor >= 100) return false;
  state.money -= 650;
  p.armor = 100;
  return true;
}
