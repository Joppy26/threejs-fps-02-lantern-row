// combat.js — hitscan shooting, tracers, and grenades.
// One job: resolve shots and throws. It owns the raycaster and the effect
// meshes (tracer lines, smoke clouds, explosions); the sim owns the numbers.
import * as THREE from 'three';
import { TMP } from './state.js';
import { GRENADES } from './weapons.js';
import { damageBot } from './bots.js';
import { applyDamage } from './player.js';

export function createCombat(scene, world) {
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 });
  const railMat = new THREE.LineBasicMaterial({ color: 0x7df9ff, transparent: true, opacity: 1 });
  const tracers = [];
  const grenades = [];   // live thrown grenades {mesh, kind, t, vel, fromPlayer}
  const smokes = [];     // active smoke clouds {pos, r, t, mesh}
  const flashes = [];    // active flash pops {pos, t}
  const explosionLight = new THREE.PointLight(0xff7722, 0, 18, 1.8);
  scene.add(explosionLight);

  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.42, roughness: 1 });

  function spawnTracer(from, to, rail) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, rail ? railMat : tracerMat);
    line.userData.t = 0.09;
    scene.add(line);
    tracers.push(line);
  }

  function fireHitscan(shooterPos, dir, spread, range, worldMeshes, hitMeshes, isRail) {
    // Scatter the ray inside the spread cone, then take the nearest hit.
    TMP.dir.copy(dir);
    if (spread > 0) {
      TMP.dir.x += (Math.random() - 0.5) * 2 * spread;
      TMP.dir.y += (Math.random() - 0.5) * 2 * spread;
      TMP.dir.z += (Math.random() - 0.5) * 2 * spread;
      TMP.dir.normalize();
    }
    TMP.ray.set(shooterPos, TMP.dir);
    TMP.ray.far = range;
    const hits = TMP.ray.intersectObjects(hitMeshes, false);
    const wallHits = worldMeshes ? TMP.ray.intersectObjects(worldMeshes, false) : [];
    const botHit = hits.length ? hits[0] : null;
    const wallHit = wallHits.length ? wallHits[0] : null;
    if (botHit && (!wallHit || botHit.distance < wallHit.distance)) {
      const end = botHit.point.clone();
      return { kind: 'bot', bot: botHit.object.userData.bot, part: botHit.object.userData.part, point: end, distance: botHit.distance };
    }
    const end = wallHit ? wallHit.point.clone()
      : shooterPos.clone().addScaledVector(TMP.dir, range);
    return { kind: wallHit ? 'wall' : 'none', point: end, distance: wallHit ? wallHit.distance : range };
  }

  return {
    smokes, grenades, flashes,
    // The player fires. Returns {hit, head, killed, bot} for the HUD + feed.
    playerFire(player, camera, hitMeshes, worldMeshes, state) {
      const def = player.weapon.def;
      const from = camera.position.clone();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const spread = player.lastSpread ?? def.spread;
      const res = fireHitscan(from, dir, spread, def.range, worldMeshes, hitMeshes, def.kind === 'railgun');
      spawnTracer(from.clone().addScaledVector(dir, 0.6), res.point, def.kind === 'railgun');
      if (res.kind === 'bot') {
        const dmg = def.damage * (res.part === 'head' ? def.headMult : 1);
        const out = damageBot(res.bot, dmg, res.part === 'head');
        if (out.killed) {
          state.money += 300;
          player.kills += 1;
          state.killfeed.unshift({ text: `You ▸ ${res.bot.name}${res.part === 'head' ? ' (headshot)' : ''}  +$300`, t: state.time });
        }
        return { hit: true, head: res.part === 'head', killed: out.killed, bot: res.bot };
      }
      return { hit: false };
    },
    // A bot fires at its target. The bot's own hit roll already happened in
    // bots.js; this only draws the tracer and applies the damage.
    botFire(bot, target, res, state) {
      TMP.a.set(bot.pos.x, 1.35, bot.pos.z);
      TMP.b.copy(target.pos); TMP.b.y = 1.3;
      spawnTracer(TMP.a.clone(), TMP.b.clone(), false);
      if (!res.hit) return;
      if (target === state.player) {
        applyDamage(target, res.dmg, res.head);
        state.playerHurt = true;
      } else {
        damageBot(target, res.dmg, res.head);
        if (!target.alive) {
          state.killfeed.unshift({ text: `${bot.name} ▸ ${target.name}${res.head ? ' (headshot)' : ''}`, t: state.time });
        }
      }
    },
    throwGrenade(player, kind, state) {
      if (player.grenades[kind] <= 0) return false;
      player.grenades[kind] -= 1;
      const g = GRENADES[kind];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: kind === 'frag' ? 0x3a4a2a : 0x888888, roughness: 0.5, metalness: 0.5 }));
      const eye = new THREE.Vector3(player.pos.x, player.eyeHeight, player.pos.z);
      mesh.position.copy(eye);
      scene.add(mesh);
      const dir = new THREE.Vector3();
      state.camera.getWorldDirection(dir);
      grenades.push({
        mesh, kind, t: kind === 'frag' ? 1.6 : 0.9,
        vel: dir.multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
        fromPlayer: true,
      });
      return true;
    },
    update(dt, state, player) {
      // Tracer fade.
      for (let i = tracers.length - 1; i >= 0; i--) {
        tracers[i].userData.t -= dt;
        if (tracers[i].userData.t <= 0) {
          scene.remove(tracers[i]);
          tracers[i].geometry.dispose();
          tracers.splice(i, 1);
        }
      }
      // Grenade flight: simple gravity + floor bounce, then the effect.
      for (let i = grenades.length - 1; i >= 0; i--) {
        const g = grenades[i];
        g.vel.y -= 18 * dt;
        g.mesh.position.addScaledVector(g.vel, dt);
        if (g.mesh.position.y < 0.1) { g.mesh.position.y = 0.1; g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
        world.collide(g.mesh.position, 0.1);
        g.t -= dt;
        if (g.t <= 0) {
          const pos = g.mesh.position.clone();
          if (g.kind === 'frag') {
            explosionLight.position.copy(pos).y = 1.5;
            explosionLight.intensity = 90;
            state.audio.explosion();
            state.noise.push({ pos: pos.clone(), t: state.time, loud: true });
            // Radius damage with falloff, both teams, including the thrower.
            const all = [player, ...state.bots];
            for (const c of all) {
              if (!c.alive) continue;
              const d = c.pos.distanceTo(pos);
              if (d < GRENADES.frag.radius) {
                const dmg = GRENADES.frag.damage * (1 - d / (GRENADES.frag.radius * 1.4));
                if (c === player) applyDamage(c, dmg, false);
                else {
                  const out = damageBot(c, dmg, false);
                  if (out.killed && g.fromPlayer) {
                    state.money += 300; player.kills += 1;
                    state.killfeed.unshift({ text: `You ▸ ${c.name} (frag)  +$300`, t: state.time });
                  }
                }
              }
            }
          } else if (g.kind === 'smoke') {
            const mesh = new THREE.Mesh(smokeGeo, smokeMat);
            mesh.position.copy(pos); mesh.position.y = 1.2;
            mesh.scale.setScalar(GRENADES.smoke.radius);
            scene.add(mesh);
            smokes.push({ pos: pos.clone(), r: GRENADES.smoke.radius, t: GRENADES.smoke.life, mesh });
            state.audio.grenadePin();
          } else if (g.kind === 'flash') {
            flashes.push({ pos: pos.clone(), t: GRENADES.flash.life });
            state.audio.flash();
            // Anyone facing the pop within range is blinded; bots lose their target.
            const all = [player, ...state.bots];
            for (const c of all) {
              if (!c.alive) continue;
              const d = c.pos.distanceTo(pos);
              if (d > GRENADES.flash.radius) continue;
              if (c === player) {
                const dir = new THREE.Vector3();
                state.camera.getWorldDirection(dir);
                TMP.a.subVectors(pos, new THREE.Vector3(player.pos.x, player.eyeHeight, player.pos.z)).normalize();
                if (dir.dot(TMP.a) > -0.1) player.flashT = 2.0;
              } else {
                c.target = null; c.reactT = 1.5; // blinded bot stops shooting
              }
            }
          }
          scene.remove(g.mesh);
          grenades.splice(i, 1);
        }
      }
      // Smoke expiry.
      for (let i = smokes.length - 1; i >= 0; i--) {
        smokes[i].t -= dt;
        smokes[i].mesh.material.opacity = Math.min(0.42, smokes[i].t * 0.2);
        if (smokes[i].t <= 0) { scene.remove(smokes[i].mesh); smokes.splice(i, 1); }
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].t -= dt;
        if (flashes[i].t <= 0) flashes.splice(i, 1);
      }
      if (explosionLight.intensity > 0) explosionLight.intensity = Math.max(0, explosionLight.intensity - dt * 260);
    },
  };
}
