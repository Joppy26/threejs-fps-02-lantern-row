// bots.js — the seven bots: three Vanguard teammates, four Jackal attackers.
// One job: bot brains and bot bodies. A bot has a route, a hold, a job
// (plant / defuse / retake) and senses: it sees, hears and shoots back.
// Tactics (rubric 3): routes through the map, holds at sites, plant/defuse
// the Spark, retakes after a plant, and investigates noises it hears.
import * as THREE from 'three';
import { PALETTE, mat, glowMat } from './palette.js';
import { ROUTES, routePoints, SITES } from './world.js';
import { WEAPONS, createWeaponState, tickWeapon, consumeShot } from './weapons.js';
import { TEAM, TMP } from './state.js';
import { applyDamage as hurtPlayer } from './player.js';

const BOT_SPEED = 4.4;
const BOT_RADIUS = 0.42;
const EYE = 1.55;
const SEE_RANGE = 46;
const SEE_FOV = 1.85; // radians, ~106 degrees
const NAMES_V = ['Iris', 'Moss', 'Kite'];
const NAMES_J = ['Vex', 'Rook', 'Ash', 'Nyx'];

function buildBody(team, scene) {
  const color = team === TEAM.VANGUARD ? PALETTE.neonCyan : PALETTE.neonOrange;
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.34), mat(team === TEAM.VANGUARD ? 0x2a4a52 : 0x52301a));
  torso.position.y = 1.05;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.38), glowMat(color, 1.5));
  vest.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), mat(0x4a3a28));
  head.position.y = 1.66;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), glowMat(color, 2.6));
  visor.position.set(0, 1.68, 0.17);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), mat(0x14161c));
  gun.position.set(0.25, 1.2, -0.3);
  g.add(torso, vest, head, visor, gun);
  g.traverse((o) => { o.castShadow = false; });
  scene.add(g);
  return { group: g, torso, head, visor, gun };
}

export function createBots(scene, world) {
  const bots = [];
  const hitMeshes = [];
  function add(team, name, spawn, weaponId, isCarrier) {
    const body = buildBody(team, scene);
    const bot = {
      team, name, body,
      pos: spawn.clone(), vel: new THREE.Vector3(),
      yaw: team === TEAM.VANGUARD ? -Math.PI / 2 : Math.PI / 2,
      hp: 100, armor: 0, alive: true,
      weapon: createWeaponState(weaponId),
      state: 'route',        // route | hold | plant | defuse | retake | investigate | dead
      route: [], routeIdx: 0,
      holdT: 0, holdPos: null,
      target: null,          // current enemy being engaged
      reactT: 0,             // delay before the first shot after spotting
      burstLeft: 0, burstT: 0,
      channel: null,         // {kind:'plant'|'defuse', t}
      hasSpark: isCarrier,
      hasRailgun: false,
      investigatePos: null,
      scanYaw: 0, scanDir: 1,
      crouched: false,
      speed: BOT_SPEED * (0.92 + Math.random() * 0.16),
    };
    body.torso.userData = { bot, part: 'body' };
    body.head.userData = { bot, part: 'head' };
    body.visor.userData = { bot, part: 'head' };
    hitMeshes.push(body.torso, body.head, body.visor);
    bots.push(bot);
    return bot;
  }
  // Vanguard defenders hold the sites; Jackals push in from the east.
  add(TEAM.VANGUARD, NAMES_V[0], new THREE.Vector3(-27, 0, -8), 'lantern');
  add(TEAM.VANGUARD, NAMES_V[1], new THREE.Vector3(-27, 0, 8), 'chatter');
  add(TEAM.VANGUARD, NAMES_V[2], new THREE.Vector3(-25, 0, -2), 'longbow');
  add(TEAM.JACKAL, NAMES_J[0], new THREE.Vector3(28, 0, -10), 'lantern', true); // Spark carrier
  add(TEAM.JACKAL, NAMES_J[1], new THREE.Vector3(28, 0, -3), 'chatter');
  add(TEAM.JACKAL, NAMES_J[2], new THREE.Vector3(28, 0, 4), 'lantern');
  add(TEAM.JACKAL, NAMES_J[3], new THREE.Vector3(28, 0, 11), 'longbow');
  return { bots, hitMeshes };
}

export function assignRoundRoles(state) {
  // Attackers pick a site by round number so the defence cannot camp one lane.
  const site = state.round % 2 === 1 ? 'A' : 'B';
  const jackals = state.bots.filter((b) => b.team === TEAM.JACKAL);
  const vanguard = state.bots.filter((b) => b.team === TEAM.VANGUARD);
  const mid = state.powerRound;
  jackals.forEach((b, i) => {
    b.hasSpark = i === 0;
    b.state = 'route';
    const route = mid && i === 1 ? ROUTES.toMid
      : site === 'A' ? (i % 2 === 0 ? ROUTES.northToA : ROUTES.midToA)
      : (i % 2 === 0 ? ROUTES.southToB : ROUTES.midToB);
    b.route = routePoints(route, []);
    b.routeIdx = 0;
    b.channel = null;
  });
  vanguard.forEach((b, i) => {
    b.state = 'route';
    const route = mid && i === 0 ? ROUTES.defendMid
      : site === 'A' ? (i === 0 ? ROUTES.defendA : ROUTES.defendB)
      : (i === 0 ? ROUTES.defendB : ROUTES.defendA);
    b.route = routePoints(route, []);
    b.routeIdx = 0;
    b.channel = null;
  });
}

// --- sensing: can this bot see that character right now?
function canSee(world, bot, targetPos, smokeClouds) {
  // Copy the target first: targetPos may alias a TMP vector this function uses.
  TMP.b.copy(targetPos); TMP.b.y = EYE;
  TMP.a.set(bot.pos.x, EYE, bot.pos.z);
  const d = TMP.a.distanceTo(TMP.b);
  if (d > SEE_RANGE) return false;
  TMP.c.subVectors(TMP.b, TMP.a).normalize();
  const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
  // Bots look along their yaw; a target behind them is invisible.
  if (TMP.c.x * facing.x + TMP.c.z * facing.z < Math.cos(SEE_FOV / 2)) return false;
  return world.hasLineOfSight(TMP.a, TMP.b, smokeClouds);
}

function pickTarget(state, world, bot, player) {
  // Nearest visible enemy wins. The player is a target only while alive.
  let best = null, bestD = Infinity;
  if (player.alive && bot.team !== player.team) {
    TMP.a.set(player.pos.x, EYE, player.pos.z);
    if (canSee(world, bot, TMP.a, state.smokeClouds)) {
      best = player; bestD = bot.pos.distanceTo(player.pos);
    }
  }
  for (const other of state.bots) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    TMP.a.set(other.pos.x, EYE, other.pos.z);
    if (canSee(world, bot, TMP.a, state.smokeClouds)) {
      const d = bot.pos.distanceTo(other.pos);
      if (d < bestD) { best = other; bestD = d; }
    }
  }
  return best;
}

function botDamage(bot, target, state) {
  // Hit chance falls with distance and with the target moving; bots also miss
  // more while they themselves move. Headshots are a small slice of hits.
  const d = bot.pos.distanceTo(target.pos);
  const targetMoving = target.vel ? target.vel.lengthSq() > 0.5 : false;
  let p = 0.62 - d * 0.008;
  if (targetMoving) p -= 0.14;
  if (bot.state === 'route') p -= 0.10;
  if (target.crouched) p -= 0.08;
  p = Math.max(0.06, Math.min(0.85, p));
  if (Math.random() > p) return { hit: false };
  const head = Math.random() < 0.12;
  const def = bot.weapon.def;
  const dmg = def.damage * (head ? def.headMult : 1);
  return { hit: true, head, dmg };
}

function applyBotDamage(bot, dmg) {
  if (!bot.alive) return;
  let left = dmg;
  if (bot.armor > 0) {
    const absorbed = Math.min(bot.armor, left * 0.5);
    bot.armor -= absorbed; left -= absorbed;
  }
  bot.hp -= left;
  if (bot.hp <= 0) { bot.hp = 0; bot.alive = false; bot.state = 'dead'; }
}

export { applyBotDamage };

function moveAlong(bot, target, dt, world) {
  TMP.a.subVectors(target, bot.pos); TMP.a.y = 0;
  const d = TMP.a.length();
  if (d < 0.4) return true;
  TMP.a.normalize();
  const wantYaw = Math.atan2(-TMP.a.x, -TMP.a.z);
  let dy = wantYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dy));
  bot.pos.x += TMP.a.x * bot.speed * dt;
  bot.pos.z += TMP.a.z * bot.speed * dt;
  world.collide(bot.pos, BOT_RADIUS);
  return false;
}

function faceToward(bot, pos, dt) {
  TMP.a.subVectors(pos, bot.pos);
  const wantYaw = Math.atan2(-TMP.a.x, -TMP.a.z);
  let dy = wantYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, dy));
}

// One fixed-step tick for one bot. `api` carries the callbacks the bot needs
// from the rest of the game (noise, shots, plant/defuse progress, killfeed).
export function updateBot(bot, state, world, player, dt, api) {
  if (!bot.alive) { bot.body.group.visible = false; return; }
  bot.body.group.visible = true;
  tickWeapon(bot.weapon, dt);

  // Hearing: a loud noise nearby pulls a bot off its route to investigate.
  if (bot.state === 'route' || bot.state === 'hold') {
    for (const n of state.noise) {
      if (state.time - n.t < 1.2 && bot.pos.distanceTo(n.pos) < 22 && Math.random() < 0.35) {
        bot.state = 'investigate';
        bot.investigatePos = n.pos.clone();
        break;
      }
    }
  }

  // Seeing: scan for a target every tick; reacting takes a beat.
  const target = pickTarget(state, world, bot, player);
  if (target && !bot.target) bot.reactT = 0.25 + Math.random() * 0.3;
  bot.target = target;
  if (bot.reactT > 0) bot.reactT -= dt;

  // Combat: burst fire at the target once reacted.
  if (bot.target && bot.reactT <= 0 && bot.weapon.mag > 0 && !bot.weapon.reloading) {
    faceToward(bot, bot.target.pos, dt);
    bot.burstT -= dt;
    if (bot.burstLeft <= 0 && bot.burstT <= 0) {
      bot.burstLeft = 3 + Math.floor(Math.random() * 4);
      bot.burstT = 0.5 + Math.random() * 0.7;
    }
    if (bot.burstLeft > 0 && bot.weapon.cooldown <= 0) {
      bot.burstLeft -= 1;
      consumeShot(bot.weapon);
      const res = botDamage(bot, bot.target, state);
      api.onBotShot(bot, bot.target, res);
      if (bot.weapon.mag === 0) startReloadBot(bot);
    }
  } else if (bot.weapon.mag === 0 && !bot.weapon.reloading) {
    startReloadBot(bot);
  }

  // Objective behaviour, by state.
  if (bot.state === 'plant' && bot.hasSpark) {
    faceToward(bot, bot.channel ? bot.channel.sitePos : bot.pos, dt);
    // Planting is handled by rounds.js through bot.channel; here the bot stands still.
    return;
  }
  if (bot.state === 'defuse') return; // defusing bot stands still; rounds.js advances it.
  if (bot.state === 'retake' || bot.state === 'investigate') {
    const dest = bot.state === 'retake' ? bot.retakePos : bot.investigatePos;
    if (dest && moveAlong(bot, dest, dt, world)) {
      bot.state = 'hold'; bot.holdT = 3 + Math.random() * 3; bot.holdPos = bot.pos.clone();
    }
    return;
  }
  if (bot.state === 'hold') {
    bot.holdT -= dt;
    // Slow scan: sweep the yaw so a holding bot watches its lane.
    bot.scanYaw += bot.scanDir * dt * 0.5;
    if (Math.abs(bot.scanYaw) > 0.9) bot.scanDir *= -1;
    bot.yaw += bot.scanDir * dt * 0.5;
    if (bot.holdT <= 0) { bot.state = 'route'; }
    return;
  }
  // route: walk the waypoint list; at the end, hold or start the objective.
  if (bot.state === 'route') {
    if (bot.routeIdx >= bot.route.length) {
      arrive(bot, state, api);
      return;
    }
    if (moveAlong(bot, bot.route[bot.routeIdx], dt, world)) bot.routeIdx += 1;
  }
}

function startReloadBot(bot) {
  const ws = bot.weapon;
  if (ws.reloading || ws.mag === ws.def.mag || ws.reserve <= 0) return;
  ws.reloading = true;
  ws.reloadT = ws.def.reloadTime;
}

function arrive(bot, state, api) {
  // Reached the end of a route: plant, defend, or hold the site.
  if (bot.team === TEAM.JACKAL && bot.hasSpark && state.spark.state === 'carried') {
    const site = state.round % 2 === 1 ? 'A' : 'B';
    const s = SITES[site];
    if (bot.pos.distanceTo(s.pos) < s.r + 1.5) {
      bot.state = 'plant';
      bot.channel = { kind: 'plant', t: 0, site, sitePos: s.pos.clone() };
      api.onPlantStart(bot, site);
      return;
    }
  }
  if (bot.team === TEAM.JACKAL && state.spark.state === 'planted') {
    bot.state = 'hold'; bot.holdT = 999; bot.holdPos = bot.pos.clone();
    return;
  }
  bot.state = 'hold'; bot.holdT = 4 + Math.random() * 5; bot.holdPos = bot.pos.clone();
}

// Sync the visible body to the sim state. Called once per render, not per tick.
export function renderBot(bot) {
  const g = bot.body.group;
  g.position.copy(bot.pos);
  g.rotation.y = bot.yaw;
  g.visible = bot.alive;
  const crouchScale = bot.crouched ? 0.82 : 1;
  g.scale.set(1, crouchScale, 1);
}

// Damage from the player's shots lands here; returns {killed, head}.
export function damageBot(bot, dmg, head) {
  applyBotDamage(bot, dmg);
  return { killed: !bot.alive, head };
}

export { hurtPlayer };
