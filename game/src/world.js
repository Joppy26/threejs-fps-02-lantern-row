// world.js — the Lantern Row night market: geometry, lights, rain, collision,
// waypoints and line-of-sight. One job: the map. It knows nothing about rounds.
import * as THREE from 'three';
import { PALETTE, mat, glowMat, wetMat } from './palette.js';
import { TMP } from './state.js';

export const MAP = { x: 32, z: 24 }; // half extents; playable area is 64 x 48 m
export const SITES = {
  A: { name: 'Spice Court', pos: new THREE.Vector3(-21, 0, -15), r: 4.5 },
  B: { name: 'Lantern Plaza', pos: new THREE.Vector3(-21, 0, 15), r: 4.5 },
};
export const SPAWNS = {
  vanguard: [
    new THREE.Vector3(-27, 0, -8), new THREE.Vector3(-27, 0, 0),
    new THREE.Vector3(-27, 0, 8), new THREE.Vector3(-25, 0, -2),
  ],
  jackal: [
    new THREE.Vector3(28, 0, -10), new THREE.Vector3(28, 0, -3),
    new THREE.Vector3(28, 0, 4), new THREE.Vector3(28, 0, 11),
  ],
};
export const PEDESTAL = new THREE.Vector3(0, 0, 0); // mid-plaza railgun pedestal

// Waypoint graph. Bots walk node to node; routes are lists of node ids.
export const NODES = [
  { id: 0, p: [-28, -8] }, { id: 1, p: [-28, 8] }, { id: 2, p: [-14, -18] },
  { id: 3, p: [-14, 0] }, { id: 4, p: [-14, 18] }, { id: 5, p: [0, -18] },
  { id: 6, p: [0, 0] }, { id: 7, p: [0, 18] }, { id: 8, p: [14, -18] },
  { id: 9, p: [14, 0] }, { id: 10, p: [14, 18] }, { id: 11, p: [26, -12] },
  { id: 12, p: [26, 0] }, { id: 13, p: [26, 12] }, { id: 14, p: [-21, -15] },
  { id: 15, p: [-21, 15] }, { id: 16, p: [-8, -8] }, { id: 17, p: [-8, 8] },
  { id: 18, p: [8, -8] }, { id: 19, p: [8, 8] },
];
export const ROUTES = {
  northToA: [11, 8, 5, 2, 14],
  midToA: [12, 9, 6, 3, 16, 14],
  southToB: [13, 10, 7, 4, 15],
  midToB: [12, 9, 6, 3, 17, 15],
  toMid: [12, 9, 6],
  defendA: [0, 2, 14, 16],
  defendB: [1, 4, 15, 17],
  defendMid: [3, 6, 9],
};

function nodePos(id, out) {
  const n = NODES[id];
  out.set(n.p[0], 0, n.p[1]);
  return out;
}
export function routePoints(route, out) {
  out.length = 0;
  for (const id of route) out.push(nodePos(id, new THREE.Vector3()));
  return out;
}

export function createWorld(scene) {
  // Collision boxes: {minX, maxX, minZ, maxZ, h}. Movement resolves against them.
  const solids = [];
  const raycastMeshes = []; // meshes bullets can hit (walls, stalls, crates, ground)
  const group = new THREE.Group();
  scene.add(group);

  function box(x, z, w, d, h, material, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    m.castShadow = false; m.receiveShadow = false;
    group.add(m);
    raycastMeshes.push(m);
    solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
    return m;
  }

  // --- ground: rain-slick asphalt, with lighter wet strips along the lanes.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.x * 2, MAP.z * 2), wetMat(PALETTE.asphalt));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  raycastMeshes.push(ground);
  for (const [x, z, w, d] of [[-8, -18, 30, 3], [8, 0, 34, 3.4], [-8, 18, 30, 3], [0, 0, 8, 8]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), wetMat(PALETTE.asphaltWet));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.01, z);
    group.add(strip);
  }

  // --- perimeter walls with a lit parapet edge so the boundary reads at a glance.
  const wallMat = mat(PALETTE.wall);
  box(0, -MAP.z - 0.5, MAP.x * 2 + 2, 1, 4.2, wallMat);
  box(0, MAP.z + 0.5, MAP.x * 2 + 2, 1, 4.2, wallMat);
  box(-MAP.x - 0.5, 0, 1, MAP.z * 2 + 2, 4.2, wallMat);
  box(MAP.x + 0.5, 0, 1, MAP.z * 2 + 2, 4.2, wallMat);
  const trim = glowMat(PALETTE.neonPink, 1.2);
  for (const z of [-MAP.z, MAP.z]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(MAP.x * 2, 0.12, 0.12), trim);
    t.position.set(0, 4.25, z); group.add(t);
  }

  // --- market stalls: wooden counter + coloured awning + hanging lantern.
  // Each stall is one piece of cover with a sightline gap beside it.
  const stallDefs = [
    [-24, -6, PALETTE.stallClothA], [-24, 6, PALETTE.stallClothB], [-16, -12, PALETTE.stallClothC],
    [-16, 12, PALETTE.stallClothA], [-8, -14, PALETTE.stallClothB], [-8, 14, PALETTE.stallClothC],
    [4, -12, PALETTE.stallClothA], [4, 12, PALETTE.stallClothB], [12, -6, PALETTE.stallClothC],
    [12, 6, PALETTE.stallClothA], [20, -14, PALETTE.stallClothB], [20, 14, PALETTE.stallClothC],
    [20, 0, PALETTE.stallClothA], [-4, -4, PALETTE.stallClothB], [-4, 4, PALETTE.stallClothC],
  ];
  const lanternGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const lanterns = [];
  for (const [x, z, cloth] of stallDefs) {
    box(x, z, 3.4, 1.6, 1.1, mat(PALETTE.stallWood), 0);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 2.2), mat(cloth));
    awn.position.set(x, 2.1, z); awn.rotation.z = 0.06; group.add(awn);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), mat(PALETTE.stallWood));
    pole.position.set(x + 1.7, 1.05, z); group.add(pole);
    const lamp = new THREE.Mesh(lanternGeo, glowMat(PALETTE.lantern, 2.2));
    lamp.position.set(x, 1.9, z + 0.9); group.add(lamp);
    lanterns.push(lamp);
  }

  // --- tall crates and a noodle cart: hard cover on the lanes.
  box(-10, -18, 2.4, 2.4, 1.6, mat(0x3a2c1c));
  box(10, 18, 2.4, 2.4, 1.6, mat(0x3a2c1c));
  box(16, -18, 2.4, 2.4, 2.6, mat(0x2c3448));
  box(-16, 18, 2.4, 2.4, 2.6, mat(0x2c3448));
  box(24, -6, 2.0, 3.2, 1.3, mat(PALETTE.stallClothB)); // cart
  box(-26, 0, 1.8, 3.0, 1.3, mat(PALETTE.stallClothC)); // cart

  // --- site markers: glowing floor rings + a sign pole at each site.
  const siteRings = {};
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.25, s.r, 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? PALETTE.neonCyan : PALETTE.neonOrange, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(s.pos.x, 0.03, s.pos.z);
    group.add(ring);
    siteRings[key] = ring;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), mat(PALETTE.wallTop));
    pole.position.set(s.pos.x, 1.7, s.pos.z - s.r - 0.4); group.add(pole);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.1), glowMat(key === 'A' ? PALETTE.neonCyan : PALETTE.neonOrange, 1.4));
    sign.position.set(s.pos.x, 3.2, s.pos.z - s.r - 0.4); group.add(sign);
  }

  // --- mid-plaza pedestal: the power-round railgun spawns here, glowing.
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 12), mat(PALETTE.wallTop));
  ped.position.set(0, 0.5, 0); group.add(ped);
  solids.push({ minX: -1.1, maxX: 1.1, minZ: -1.1, maxZ: 1.1, h: 1.0 });
  const pedRing = new THREE.Mesh(
    new THREE.RingGeometry(1.3, 1.55, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.railgun, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  pedRing.rotation.x = -Math.PI / 2; pedRing.position.set(0, 0.03, 0);
  group.add(pedRing);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.35, 2.6, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.railgun, transparent: true, opacity: 0.35 }));
  beacon.position.set(0, 2.3, 0); group.add(beacon);

  // --- lighting: moonlight + warm lantern points + a cyan wash over mid.
  scene.fog = new THREE.Fog(PALETTE.night, 30, 85);
  scene.add(new THREE.HemisphereLight(0x33406e, 0x0c0a08, 1.5));
  const moon = new THREE.DirectionalLight(0x8fa8ff, 1.1);
  moon.position.set(-18, 30, 12); scene.add(moon);
  const warm = new THREE.PointLight(PALETTE.lantern, 30, 26, 1.6);
  warm.position.set(-12, 4.5, 0); scene.add(warm);
  const warm2 = new THREE.PointLight(PALETTE.lantern, 24, 22, 1.6);
  warm2.position.set(14, 4.5, 6); scene.add(warm2);
  const cyanWash = new THREE.PointLight(PALETTE.neonCyan, 18, 20, 1.6);
  cyanWash.position.set(0, 5, 0); scene.add(cyanWash);
  const orangeWash = new THREE.PointLight(PALETTE.neonOrange, 14, 18, 1.6);
  orangeWash.position.set(-21, 4, 0); scene.add(orangeWash);

  // --- rain: one Points cloud, recycled in place, no allocation per frame.
  const RAIN_N = 1400;
  const rainPos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * 70;
    rainPos[i * 3 + 1] = Math.random() * 18;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 54;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    color: 0x9db8ff, size: 0.09, transparent: true, opacity: 0.55, sizeAttenuation: true,
  }));
  scene.add(rain);

  // --- neon sign strips on the north wall for the skyline read.
  const signs = [
    [-20, -MAP.z + 0.1, PALETTE.neonPink, 7], [-6, -MAP.z + 0.1, PALETTE.neonCyan, 5],
    [10, -MAP.z + 0.1, PALETTE.lantern, 6], [22, -MAP.z + 0.1, PALETTE.neonOrange, 5],
  ];
  for (const [x, z, c, w] of signs) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 0.08), glowMat(c, 1.8));
    s.position.set(x, 3.6, z); group.add(s);
  }

  let rainT = 0;
  return {
    solids, siteRings, pedRing, beacon, lanterns, SPAWNS, SITES, raycastMeshes,
    update(dt, t) {
      // Rain falls and wraps; lanterns flicker gently; pedestal ring pulses.
      rainT += dt;
      const arr = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_N; i++) {
        arr[i * 3 + 1] -= dt * 14;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = 16 + Math.random() * 2;
      }
      rainGeo.attributes.position.needsUpdate = true;
      const flick = 0.92 + 0.08 * Math.sin(rainT * 7.3);
      warm.intensity = 30 * flick;
      pedRing.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.4);
      beacon.material.opacity = 0.25 + 0.15 * Math.sin(t * 2.4);
      for (let i = 0; i < lanterns.length; i++) {
        const s = 1 + 0.06 * Math.sin(rainT * 5 + i * 1.7);
        lanterns[i].scale.setScalar(s);
      }
    },
    // Circle-vs-AABB resolve in the XZ plane. Returns true when a push happened.
    // `pos` is the feet position; radius is the character's body radius.
    collide(pos, radius) {
      let hit = false;
      const px = Math.max(-MAP.x + 0.6, Math.min(MAP.x - 0.6, pos.x));
      const pz = Math.max(-MAP.z + 0.6, Math.min(MAP.z - 0.6, pos.z));
      if (px !== pos.x || pz !== pos.z) { pos.x = px; pos.z = pz; hit = true; }
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        const cx = Math.max(s.minX, Math.min(pos.x, s.maxX));
        const cz = Math.max(s.minZ, Math.min(pos.z, s.maxZ));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = cx + (dx / d) * radius;
            pos.z = cz + (dz / d) * radius;
          } else {
            pos.x = s.maxX + radius; // centre inside the box: push out east
          }
          hit = true;
        }
      }
      return hit;
    },
    // Segment-vs-AABB line of sight at eye height, ignoring the ground plane.
    // Smoke clouds are passed in as extra blocker spheres.
    hasLineOfSight(a, b, smokeClouds) {
      const ax = a.x, ay = a.y, az = a.z;
      const dx = b.x - ax, dy = b.y - ay, dz = b.z - az;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.h < 0.9) continue; // low stalls do not block sight at eye height
        let t0 = 0, t1 = 1;
        // Slab test on X, then Z (Y is always inside 0..h for eye-height rays).
        if (Math.abs(dx) < 1e-9) { if (ax < s.minX || ax > s.maxX) continue; }
        else {
          let ta = (s.minX - ax) / dx, tb = (s.maxX - ax) / dx;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) continue;
        }
        if (Math.abs(dz) < 1e-9) { if (az < s.minZ || az > s.maxZ) continue; }
        else {
          let ta = (s.minZ - az) / dz, tb = (s.maxZ - az) / dz;
          if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) continue;
        }
        // The segment crosses this solid's XZ footprint; check height at entry.
        const te = Math.max(0, t0);
        const yAt = ay + dy * te;
        if (yAt < s.h) return false;
      }
      if (smokeClouds) {
        for (let i = 0; i < smokeClouds.length; i++) {
          const c = smokeClouds[i];
          // Segment-sphere: closest approach of the segment to the cloud centre.
          TMP.a.subVectors(c.pos, a);
          const len2 = dx * dx + dy * dy + dz * dz;
          let t = len2 > 0 ? (TMP.a.x * dx + TMP.a.y * dy + TMP.a.z * dz) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          TMP.b.set(ax + dx * t, ay + dy * t, az + dz * t);
          if (TMP.b.distanceToSquared(c.pos) < c.r * c.r) return false;
        }
      }
      return true;
    },
  };
}
