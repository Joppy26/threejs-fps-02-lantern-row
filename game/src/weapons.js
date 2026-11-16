// weapons.js — weapon and grenade definitions plus the firing model.
// One job: what each weapon is and how a shot behaves. No rendering, no input.
// Gunplay model (rubric 2): headshots deal 2x, spread grows while moving and
// firing, recoil kicks the view, and stopping to aim (still + crouched) pays.
export const WEAPONS = {
  petal: {
    id: 'petal', name: 'Petal-9', kind: 'pistol', price: 0,
    damage: 22, headMult: 2.0, mag: 12, reserve: 48, rpm: 360, auto: false,
    spread: 0.012, moveSpread: 0.030, recoil: 0.011, reloadTime: 1.1, range: 45,
    desc: 'Sidearm. Free, reliable, weak.',
  },
  chatter: {
    id: 'chatter', name: 'Chatter SMG', kind: 'smg', price: 1200,
    damage: 18, headMult: 2.0, mag: 28, reserve: 112, rpm: 760, auto: true,
    spread: 0.016, moveSpread: 0.042, recoil: 0.009, reloadTime: 1.5, range: 38,
    desc: 'Fast, close-range spray. Punishes long bursts.',
  },
  lantern: {
    id: 'lantern', name: 'Lantern Rifle', kind: 'rifle', price: 2700,
    damage: 30, headMult: 2.0, mag: 25, reserve: 75, rpm: 600, auto: true,
    spread: 0.008, moveSpread: 0.034, recoil: 0.014, reloadTime: 1.9, range: 60,
    desc: 'The workhorse. Accurate when you stop and aim.',
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', kind: 'dmr', price: 3200,
    damage: 62, headMult: 2.2, mag: 8, reserve: 24, rpm: 95, auto: false,
    spread: 0.004, moveSpread: 0.040, recoil: 0.045, reloadTime: 2.4, range: 80,
    desc: 'One tap at range. Useless on the move.',
  },
  railgun: {
    id: 'railgun', name: 'Prototype Railgun', kind: 'railgun', price: 0,
    damage: 150, headMult: 1.5, mag: 1, reserve: 4, rpm: 45, auto: false,
    spread: 0.001, moveSpread: 0.010, recoil: 0.09, reloadTime: 2.2, range: 120,
    desc: 'Power-round prototype. One shot, one deletion. Spawns mid.',
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag', price: 300, radius: 7, damage: 110, desc: 'Explodes after 1.6s. Big radius damage.' },
  smoke: { id: 'smoke', name: 'Smoke', price: 250, radius: 5, life: 12, desc: 'Blocks sight for 12s. Take the site under cover.' },
  flash: { id: 'flash', name: 'Flash', price: 200, radius: 12, life: 2.2, desc: 'Blinds anyone looking at it.' },
};
export const ARMOR_PRICE = 650;

// Per-weapon live state. The player and each bot own one of these.
export function createWeaponState(id) {
  const def = WEAPONS[id];
  return {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadT: 0, reloading: false,
    bloom: 0,        // spread growth from firing; decays when not firing
    chargeT: 0,      // railgun charge-up before the shot releases
    charging: false,
  };
}

export function canFire(ws) {
  return !ws.reloading && ws.cooldown <= 0 && ws.mag > 0 && !ws.charging;
}

// Current spread in radians, from stance and fire history. Called by shooter.
export function currentSpread(ws, moving, crouched, aiming) {
  let s = ws.def.spread + ws.bloom;
  if (moving) s += ws.def.moveSpread;
  if (crouched) s *= 0.6;
  if (aiming) s *= 0.55;
  return s;
}

export function startReload(ws) {
  if (ws.reloading || ws.mag === ws.def.mag || ws.reserve <= 0) return false;
  ws.reloading = true;
  ws.reloadT = ws.def.reloadTime;
  return true;
}

export function tickWeapon(ws, dt) {
  if (ws.cooldown > 0) ws.cooldown -= dt;
  if (ws.bloom > 0) ws.bloom = Math.max(0, ws.bloom - dt * 0.045);
  if (ws.reloading) {
    ws.reloadT -= dt;
    if (ws.reloadT <= 0) {
      ws.reloading = false;
      const need = ws.def.mag - ws.mag;
      const take = Math.min(need, ws.reserve);
      ws.mag += take; ws.reserve -= take;
    }
  }
}

// Consume one shot: ammo, cooldown, bloom and recoil all come from here so
// the player and the bots fire by exactly the same rules.
export function consumeShot(ws) {
  ws.mag -= 1;
  ws.cooldown = 60 / ws.def.rpm;
  ws.bloom = Math.min(0.06, ws.bloom + ws.def.recoil * 0.55);
  return ws.def.recoil;
}
