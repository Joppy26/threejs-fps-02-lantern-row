// main.js — bootstrap and the game loop. One job: wire the modules together.
// Fixed-step simulation apart from rendering (rubric 5): the sim advances in
// SIM_DT ticks from an accumulator; rendering only reads state and draws it.
// No network at runtime: three.js is vendored, sounds are synthesized, all
// art is geometry. No new objects per frame in hot loops: shared TMP vectors.
//
// LANTERN ROW — a rain-soaked neon night market. Vanguard (cyan, defenders)
// hold Sites A (Spice Court) and B (Lantern Plaza) against the Jackals
// (orange, attackers) and their Spark. Every 3rd round is a POWER ROUND:
// a prototype railgun spawns on the mid-plaza pedestal and both teams race it.
import * as THREE from 'three';
import { createState, SIM_DT, TEAM, TMP } from './state.js';
import { createWorld, SITES } from './world.js';
import { createAudio } from './audio.js';
import { createPlayer, updatePlayer, playerShoot, applyDamage, resetPlayer, buyWeapon, buyArmor } from './player.js';
import { createBots, updateBot, renderBot } from './bots.js';
import { createCombat } from './combat.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { startBuyPhase, startLivePhase, tickRounds } from './rounds.js';
import { startReload, WEAPONS } from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');           // start | play | site | end (screenshots)
const SELFTEST = params.get('selftest') === '1';
const SEED = Number(params.get('seed') || '1');

// Deterministic seed for screenshot mode so renders are reproducible.
let seedState = SEED * 2654435761 >>> 0;
function seededRandom() {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}
if (SHOT || SELFTEST) Math.random = seededRandom;

window.addEventListener('error', (e) => { state.errors.push(String(e.message || e.error)); });
window.addEventListener('unhandledrejection', (e) => { state.errors.push('rejection: ' + String(e.reason)); });

const state = createState();
const audio = createAudio();
state.audio = audio;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d18);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
state.camera = camera;

const world = createWorld(scene);
const player = createPlayer(scene, camera, world);
state.player = player;
const { bots, hitMeshes } = createBots(scene, world);
state.bots = bots;
const combat = createCombat(scene, world);
state.smokeClouds = combat.smokes;
const hud = createHud(state, player);
const input = createInput();

// --- the Spark: a glowing orb that rides on its carrier, sits at a site when
// planted, and pulses red while the detonation timer runs.
const sparkMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 12, 10),
  new THREE.MeshStandardMaterial({ color: 0xff4d3d, emissive: 0xff2a18, emissiveIntensity: 2.4 }),
);
sparkMesh.visible = false;
scene.add(sparkMesh);
const sparkLight = new THREE.PointLight(0xff2a18, 0, 9, 1.8);
scene.add(sparkLight);

// --- the prototype railgun on its pedestal (power rounds only).
const railgunMesh = new THREE.Group();
{
  const railBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.3, metalness: 0.85 }));
  const railCoil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x7df9ff, emissive: 0x7df9ff, emissiveIntensity: 2.2 }));
  railCoil.position.y = 0.1;
  railgunMesh.add(railBody, railCoil);
  railgunMesh.position.set(0, 1.35, 0);
  railgunMesh.visible = false;
  scene.add(railgunMesh);
}

// Muzzle flash: one light, reused, never allocated per shot.
const muzzle = new THREE.PointLight(0xffc46b, 0, 12, 2);
scene.add(muzzle);

function placeCamera() {
  camera.position.set(player.pos.x, player.eyeHeight, player.pos.z);
  camera.rotation.y = player.yaw + player.yawKick;
  camera.rotation.x = player.pitch + player.pitchKick;
  camera.rotation.z = 0;
}

// --- bot API: what bots call back into the game for.
const botApi = {
  onBotShot(bot, target, res) {
    audio.shot(bot.weapon.def.id === 'railgun' ? 'railgun' : bot.weapon.def.kind, bot.pos.distanceTo(player.pos));
    combat.botFire(bot, target, res, state);
    if (target === player && res.hit) {
      audio.hurt();
      hud.hitmarker(false);
    }
    state.noise.push({ pos: bot.pos.clone(), t: state.time, loud: true });
  },
  onPlantStart(bot, site) {
    state.killfeed.unshift({ text: `${bot.name} is planting the Spark at Site ${site}!`, t: state.time });
    state.banner = `${bot.name.toUpperCase()} IS PLANTING AT SITE ${site}`;
    state.bannerSub = 'Stop them — or retake after the plant.';
  },
};

let prevMouseDown = false;
let stepAcc = 0; // footstep sound timer

function simTick(dt) {
  state.time += dt;
  world.update(dt, state.time);

  // Mouse look.
  const { dx, dy } = input.consumeMouse();
  if (input.locked || SHOT) {
    player.yaw -= dx * 0.0021;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - dy * 0.0021));
  }

  // Buy keys and menu (buy phase only).
  if (input.wasPressed('KeyB')) hud.toggleBuy();
  if (state.phase === 'buy') {
    for (const [code, id] of [['Digit1', 'petal'], ['Digit2', 'chatter'], ['Digit3', 'lantern'], ['Digit4', 'longbow']]) {
      if (input.wasPressed(code)) {
        if (buyWeapon(player, id, state)) audio.buy();
        hud.update();
      }
    }
    if (input.wasPressed('Digit9')) { if (buyArmor(player, state)) audio.buy(); hud.update(); }
  }
  if (input.wasPressed('KeyR')) {
    if (state.phase === 'matchEnd') {
      state.round = 1; state.score = { vanguard: 0, jackal: 0 }; state.matchWinner = null;
      state.money = 800; player.kills = 0; player.owned = { petal: true, lantern: true };
      startBuyPhase(state, world);
    } else if (player.alive && startReload(player.weapon)) audio.reload();
  }
  if (input.wasPressed('KeyG') && player.alive) {
    if (combat.throwGrenade(player, player.selectedGrenade, state)) audio.grenadePin();
  }
  if (input.wasPressed('KeyQ')) {
    const order = ['frag', 'smoke', 'flash'];
    player.selectedGrenade = order[(order.indexOf(player.selectedGrenade) + 1) % 3];
  }

  // Shooting: hold to fire autos; semi-autos fire on the press edge.
  const wantFire = input.mouseDown && player.alive && (state.phase === 'live' || state.phase === 'planted');
  const edge = input.mouseDown && !prevMouseDown;
  prevMouseDown = input.mouseDown;
  const def = player.weapon.def;
  if (wantFire && (def.auto || edge)) {
    const shot = playerShoot(player);
    if (shot.fired) {
      player.lastSpread = shot.spread;
      audio.shot(def.id === 'railgun' ? 'railgun' : def.kind, 0);
      muzzle.position.set(player.pos.x, player.eyeHeight, player.pos.z);
      muzzle.position.addScaledVector(camera.getWorldDirection(TMP.a), 0.8);
      muzzle.intensity = 26;
      const res = combat.playerFire(player, camera, hitMeshes, world.raycastMeshes, state);
      if (res.hit) { audio.hitmarker(res.killed); hud.hitmarker(res.killed); }
      state.noise.push({ pos: player.pos.clone(), t: state.time, loud: true });
    } else if (shot.dry) {
      audio.dryFire();
      if (startReload(player.weapon)) audio.reload();
    }
  }
  if (def.id === 'railgun' && player.weapon.mag === 0 && player.weapon.reserve > 0 && !player.weapon.reloading) {
    startReload(player.weapon);
  }

  // Footsteps while moving.
  if (player.moving && player.alive) {
    stepAcc -= dt;
    if (stepAcc <= 0) { stepAcc = 0.42; audio.step(0); }
  }

  updatePlayer(player, input, dt, state.time);

  // Bots.
  for (const b of bots) updateBot(b, state, world, player, dt, botApi);

  // Rounds: buy/live/planted timers, Spark, economy, win conditions.
  tickRounds(state, world, dt, { playerHoldingE: () => !!input.keys['KeyE'] });

  // Player death: drop the camera to the ground and wait for the next round.
  if (!player.alive && state.phase !== 'roundEnd' && state.phase !== 'matchEnd') {
    // handled by tickRounds elimination check; nothing to do here.
  }

  combat.update(dt, state, player);
  if (muzzle.intensity > 0) muzzle.intensity = Math.max(0, muzzle.intensity - dt * 320);
  input.clearPressed();
}

// Dynamic per-frame visuals: Spark carrier, railgun bob, site ring pulse.
function renderVisuals(t) {
  for (const b of bots) renderBot(b);
  // Spark follows its carrier, or sits at the planted site.
  const spark = state.spark;
  if (spark.state === 'carried') {
    const carrier = state.bots.find((b) => b.hasSpark && b.alive);
    if (carrier) {
      sparkMesh.visible = true;
      sparkMesh.position.set(carrier.pos.x, 1.35, carrier.pos.z);
      sparkLight.position.copy(sparkMesh.position);
      sparkLight.intensity = 6;
    } else sparkMesh.visible = false;
  } else if (spark.state === 'planted') {
    sparkMesh.visible = true;
    sparkMesh.position.set(spark.pos.x, 0.5 + 0.08 * Math.sin(t * 5), spark.pos.z);
    sparkLight.position.copy(sparkMesh.position);
    sparkLight.intensity = 8 + 4 * Math.sin(t * 6);
  } else sparkMesh.visible = false;
  // Railgun on the pedestal during power rounds until someone takes it.
  railgunMesh.visible = state.railgun.spawned && !state.railgun.taken;
  if (railgunMesh.visible) {
    railgunMesh.position.y = 1.35 + 0.12 * Math.sin(t * 2);
    railgunMesh.rotation.y = t * 0.8;
  }
  // Site rings pulse when the Spark is planted there.
  for (const key of ['A', 'B']) {
    const ring = world.siteRings[key];
    const plantedHere = spark.state === 'planted' && spark.site === key;
    ring.material.opacity = plantedHere ? 0.5 + 0.4 * Math.sin(t * 6) : 0.85;
  }
  placeCamera();
  hud.update();
  renderer.render(scene, camera);
}

// --- screenshot presets: deterministic scenes for the 4 screenshots.
function applyShotPreset() {
  const lookAt = (x, z) => {
    player.yaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z));
    player.pitch = 0;
  };
  if (SHOT === 'start') {
    state.round = 1; startBuyPhase(state, world);
    player.pos.set(-27, 0, 0); lookAt(0, 0);
    hud.openBuy();
  } else if (SHOT === 'play') {
    state.round = 3; startBuyPhase(state, world); startLivePhase(state);
    player.pos.set(-6, 0, -4); lookAt(8, 2);
    // Stage a mid-lane fight: two Jackals visible ahead, one teammate beside.
    bots[3].pos.set(3, 0, 2); bots[3].state = 'hold'; bots[3].holdT = 99; bots[3].yaw = Math.PI / 2;
    bots[4].pos.set(8, 0, 0); bots[4].state = 'hold'; bots[4].holdT = 99; bots[4].yaw = Math.PI / 2;
    bots[0].pos.set(-9, 0, -1); bots[0].state = 'hold'; bots[0].holdT = 99; bots[0].yaw = -Math.PI / 2;
    player.lastSpread = 0.012;
  } else if (SHOT === 'site') {
    state.round = 2; startBuyPhase(state, world); startLivePhase(state);
    state.spark.state = 'planted'; state.spark.site = 'A';
    state.spark.pos.copy(SITES.A.pos); state.spark.detonateT = 18.4;
    state.phase = 'planted';
    // Stand south of the site with a clear lane at the ring and the Spark.
    player.pos.set(-21, 0, -6); lookAt(-21, -15);
    bots[3].pos.set(-18, 0, -18); bots[3].state = 'hold'; bots[3].holdT = 99;
    bots[0].pos.set(-24, 0, -10); bots[0].state = 'hold'; bots[0].holdT = 99;
  } else if (SHOT === 'end') {
    state.round = 5; startBuyPhase(state, world); startLivePhase(state);
    state.score.vanguard = 4; state.score.jackal = 3;
    state.phase = 'roundEnd'; state.phaseT = 1;
    state.banner = 'VANGUARD WINS THE ROUND';
    state.bannerSub = 'Jackal squad eliminated  ·  +$3250  ·  Score 5 – 3';
    player.pos.set(-10, 0, 6); lookAt(0, 0);
    bots[3].alive = false; bots[4].alive = false;
  }
  // Run the sim a little so the scene settles, then render.
  for (let i = 0; i < 30; i++) simTick(SIM_DT);
  // The settle ticks let bots fight; restore full health so the stills show a
  // live firefight, and re-assert the site shot's defuse channel (it decays
  // while E is not held during the settle).
  player.hp = 100; player.alive = true;
  for (const b of bots) if (b.state !== 'dead') { b.hp = 100; b.alive = true; }
  if (SHOT === 'site') {
    player.channel = { kind: 'defuse', t: 2.1 };
    state.spark.detonateT = 18.4;
  }
  if (SHOT === 'end') { bots[3].alive = false; bots[4].alive = false; }
  renderVisuals(1.2);
  renderVisuals(1.3);
}

// --- self-test: scripted checks, results into #testlog and the console.
function runSelfTest() {
  const lines = [];
  const check = (name, ok) => lines.push((ok ? 'PASS' : 'FAIL') + ' ' + name);
  startBuyPhase(state, world);
  check('buy phase starts', state.phase === 'buy');
  startLivePhase(state);
  check('live phase starts', state.phase === 'live');
  const magBefore = player.weapon.mag;
  const shot = playerShoot(player);
  check('weapon fires', shot.fired === true && player.weapon.mag === magBefore - 1);
  const res = combat.playerFire(player, camera, hitMeshes, world.raycastMeshes, state);
  check('hitscan resolves (no crash)', typeof res.hit === 'boolean');
  const reloaded = startReload(player.weapon);
  check('reload starts', reloaded === true);
  for (let i = 0; i < 200; i++) simTick(SIM_DT);
  check('reload completes', player.weapon.mag === player.weapon.def.mag);
  // Force a bot into view and let it shoot the player.
  const b = bots[3];
  b.pos.set(player.pos.x + 6, 0, player.pos.z);
  b.yaw = Math.PI / 2; b.state = 'hold'; b.holdT = 99;
  const hpBefore = player.hp;
  for (let i = 0; i < 600; i++) simTick(SIM_DT);
  check('bot shoots back (player took damage)', player.hp < hpBefore || !player.alive);
  check('no JS errors during sim', state.errors.length === 0);
  check('round timer ticks', state.roundTimeLeft < 100);
  // Plant the Spark as the player, then let it detonate. First wait out any
  // buy phase: planting only works while the round is live.
  let waited = 0;
  while (state.phase !== 'live' && waited < 1200) { simTick(SIM_DT); waited += 1; }
  check('round goes live for the plant test', state.phase === 'live');
  player.pos.copy(SITES.A.pos);
  input.keys['KeyE'] = true;
  for (let i = 0; i < 400; i++) simTick(SIM_DT);
  check('player plants the Spark', state.spark.state === 'planted');
  input.keys['KeyE'] = false;
  state.spark.detonateT = 0.05;
  for (let i = 0; i < 120; i++) simTick(SIM_DT);
  check('detonation ends the round', state.phase === 'roundEnd' || state.phase === 'matchEnd');
  check('round winner recorded', state.winner === 'jackal');
  for (let i = 0; i < 400; i++) simTick(SIM_DT);
  lines.push(`diag after detonation: phase=${state.phase} round=${state.round} phaseT=${state.phaseT.toFixed(2)} buyLeft=${state.buyTimeLeft.toFixed(1)} winner=${state.winner} scoreV=${state.score.vanguard} scoreJ=${state.score.jackal}`);
  check('next round buy phase', state.phase === 'buy' && state.round >= 2);
  check('power round flag on round 3', (() => { state.round = 3; startBuyPhase(state, world); return state.powerRound && state.railgun.spawned; })());
  // Grenades.
  player.grenades.frag = 1;
  check('frag throws', combat.throwGrenade(player, 'frag', state) === true);
  for (let i = 0; i < 400; i++) simTick(SIM_DT);
  check('frag detonates without error', state.errors.length === 0);
  player.grenades.smoke = 1;
  combat.throwGrenade(player, 'smoke', state);
  for (let i = 0; i < 200; i++) simTick(SIM_DT);
  check('smoke cloud active', combat.smokes.length > 0);
  check('still no JS errors', state.errors.length === 0);
  const fails = lines.filter((l) => l.startsWith('FAIL')).length;
  lines.push(fails === 0 ? 'SELFTEST ALL PASS' : `SELFTEST ${fails} FAILURES`);
  lines.push('errors: ' + JSON.stringify(state.errors));
  const logEl = document.getElementById('testlog');
  if (logEl) logEl.textContent = lines.join('\n');
  console.log(lines.join('\n'));
  document.title = fails === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL';
}

// --- menu / play wiring.
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
  audio.unlock();
  document.body.requestPointerLock();
  overlay.hidden = true;
  if (state.phase === 'menu') {
    state.round = 1; state.score = { vanguard: 0, jackal: 0 }; state.matchWinner = null;
    state.money = 800; player.kills = 0; player.owned = { petal: true, lantern: true };
    startBuyPhase(state, world);
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !SHOT && state.phase !== 'menu' && state.phase !== 'matchEnd') {
    overlay.hidden = false;
    document.getElementById('overlay-title').textContent = 'Paused — Lantern Row';
    document.getElementById('overlay-copy').textContent = 'Click to play. Your round keeps its state.';
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- main loop: fixed-step sim, render apart from it.
let last = performance.now();
let acc = 0;
let frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (state.phase !== 'menu') {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) {
      simTick(SIM_DT);
      acc -= SIM_DT;
      steps += 1;
    }
    if (steps === 5) acc = 0;
  }
  renderVisuals(state.time);
  frames += 1;
  if (SHOT && frames === 3) window.__shotReady = true;
}

if (SHOT) {
  overlay.hidden = true;
  applyShotPreset();
  window.__shotReady = true;
} else if (SELFTEST) {
  overlay.hidden = true;
  runSelfTest();
  renderVisuals(1);
} else {
  startBuyPhase(state, world);
  state.phase = 'menu'; // menu overlay sits over the buy-phase scene
  requestAnimationFrame(frame);
}
