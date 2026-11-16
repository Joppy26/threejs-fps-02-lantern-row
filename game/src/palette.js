// palette.js — Lantern Row's chosen palette and shared materials.
// One job: every colour and material the map, characters and HUD agree on.
// Palette: wet asphalt blues, warm lantern amber, Vanguard cyan, Jackal orange.
import * as THREE from 'three';

export const PALETTE = {
  night: 0x0a0d18,        // sky / fog
  asphalt: 0x171a24,      // wet street
  asphaltWet: 0x1e2333,   // lighter wet patches
  stallWood: 0x4a3220,    // stall frames
  stallClothA: 0xb3271e,  // red awning
  stallClothB: 0xd98a1f,  // amber awning
  stallClothC: 0x1f6f6b,  // teal awning
  lantern: 0xffb347,      // lantern glow
  lanternRed: 0xff4d3d,   // red paper lantern
  neonCyan: 0x2ee6ff,     // Vanguard
  neonOrange: 0xff8a2a,   // Jackals
  neonPink: 0xff4d9d,      // accent signage
  wall: 0x232838,         // brick walls
  wallTop: 0x2e3550,
  railgun: 0x7df9ff,      // prototype railgun glow
  smoke: 0x9aa3b2,
};

const cache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts }));
  }
  return cache.get(key);
}
export function glowMat(color, intensity = 1.6) {
  const key = 'glow' + color + intensity;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0,
    }));
  }
  return cache.get(key);
}
export function wetMat(color) {
  // Rain-slick ground: low roughness so lantern light streaks across it.
  const key = 'wet' + color;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.35 }));
  }
  return cache.get(key);
}
