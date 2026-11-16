// rounds.js — the round state machine: buy, live, planted, round end, match end.
// One job: decide when rounds start, end and who wins them. It owns the Spark
// timers and the economy; the HUD only reads what it writes into state.
import { BUY_TIME, ROUND_TIME, DETONATE_TIME, PLANT_TIME, DEFUSE_TIME, WIN_ROUNDS, POWER_ROUND_EVERY, WIN_REWARD, LOSS_REWARD, TEAM } from './state.js';
import { SITES } from './world.js';
import { assignRoundRoles } from './bots.js';
import { resetPlayer } from './player.js';
import { createWeaponState } from './weapons.js';

function aliveOf(state, team) {
  let n = 0;
  if (team === TEAM.VANGUARD && state.player.alive) n += 1;
  for (const b of state.bots) if (b.team === team && b.alive) n += 1;
  return n;
}

export function startBuyPhase(state, world) {
  state.phase = 'buy';
  state.phaseT = 0;
  state.buyTimeLeft = BUY_TIME;
  state.roundTimeLeft = ROUND_TIME;
  state.powerRound = state.round % POWER_ROUND_EVERY === 0;
  state.spark = { state: 'carried', site: null, plantT: 0, defuseT: 0, detonateT: 0, pos: state.spark.pos };
  state.railgun = { spawned: state.powerRound, taken: false, pos: state.railgun.pos };
  // Reset everyone to their spawn, alive, with a fresh basic loadout.
  resetPlayer(state.player, world.SPAWNS.vanguard[3]);
  state.player.pos.set(-27, 0, 0);
  state.bots.forEach((b, i) => {
    const spawns = b.team === TEAM.VANGUARD ? world.SPAWNS.vanguard : world.SPAWNS.jackal;
    b.pos.copy(spawns[i % spawns.length]);
    b.hp = 100; b.armor = 0; b.alive = true; b.state = 'route';
    b.hasRailgun = false; b.channel = null; b.target = null;
    b.weapon = createWeaponState(b.team === TEAM.VANGUARD ? 'lantern' : 'lantern');
    b.body.group.visible = true;
  });
  assignRoundRoles(state);
  state.banner = state.powerRound ? 'POWER ROUND — prototype railgun at mid plaza' : `ROUND ${state.round} — buy phase`;
  state.bannerSub = state.powerRound
    ? 'Race mid for the railgun. First to 5 rounds wins.'
    : 'Buy with B. First to 5 rounds wins.';
  if (state.powerRound) state.audio.railgunSpawn();
}

export function startLivePhase(state) {
  state.phase = 'live';
  state.phaseT = 0;
  state.banner = '';
  state.bannerSub = '';
}

function endRound(state, winner, reason) {
  state.phase = 'roundEnd';
  state.phaseT = 0;
  state.winner = winner;
  state.score[winner] += 1;
  const playerWon = winner === TEAM.VANGUARD;
  state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
  state.banner = playerWon ? 'VANGUARD WINS THE ROUND' : 'JACKALS WIN THE ROUND';
  state.bannerSub = `${reason}  ·  +$${playerWon ? WIN_REWARD : LOSS_REWARD}  ·  Score ${state.score.vanguard} – ${state.score.jackal}`;
  if (playerWon) state.audio.roundWin(); else state.audio.roundLose();
  if (state.score[winner] >= WIN_ROUNDS) {
    state.matchWinner = winner;
  }
}

function endMatch(state) {
  state.phase = 'matchEnd';
  state.phaseT = 0;
  const won = state.matchWinner === TEAM.VANGUARD;
  state.banner = won ? 'VANGUARD TAKES LANTERN ROW' : 'JACKALS TAKE LANTERN ROW';
  state.bannerSub = `Final score ${state.score.vanguard} – ${state.score.jackal}. Press R to play again.`;
}

// Called once per fixed tick from main.js while the match is running.
export function tickRounds(state, world, dt, api) {
  state.phaseT += dt;
  if (state.phase === 'buy') {
    state.buyTimeLeft -= dt;
    if (state.buyTimeLeft <= 0) startLivePhase(state);
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.phaseT > 4) {
      if (state.matchWinner) endMatch(state);
      else { state.round += 1; startBuyPhase(state, world); }
    }
    return;
  }
  if (state.phase === 'matchEnd') return;
  if (state.phase !== 'live' && state.phase !== 'planted') return;

  // --- Spark plant / defuse channelling (player holds E, bots channel too).
  const spark = state.spark;
  if (spark.state === 'carried') {
    // Player planting: standing in a site, holding E.
    const p = state.player;
    if (p.alive && api.playerHoldingE()) {
      for (const key of ['A', 'B']) {
        const s = SITES[key];
        if (p.pos.distanceTo(s.pos) < s.r) {
          spark.plantT += dt;
          p.channel = { kind: 'plant', t: spark.plantT };
          if (spark.plantT >= PLANT_TIME) {
            spark.state = 'planted'; spark.site = key;
            spark.pos.copy(s.pos); spark.detonateT = DETONATE_TIME;
            p.channel = null;
            state.phase = 'planted';
            state.banner = 'SPARK PLANTED AT SITE ' + key;
            state.bannerSub = 'Defend it for 35 seconds — or the Jackals lose it.';
            state.audio.plantBeep(true);
            // Defenders retake, attackers hold the site.
            for (const b of state.bots) {
              if (b.team === TEAM.VANGUARD) { b.state = 'retake'; b.retakePos = s.pos.clone(); }
              else if (b.alive) { b.state = 'hold'; b.holdT = 999; }
            }
          }
          break;
        }
      }
    } else {
      spark.plantT = Math.max(0, spark.plantT - dt * 2);
      if (p.channel?.kind === 'plant') p.channel = null;
    }
    // A Jackal bot planting (its channel is advanced by bots.js arrive()).
    for (const b of state.bots) {
      if (b.alive && b.channel?.kind === 'plant') {
        b.channel.t += dt;
        if (b.channel.t >= PLANT_TIME) {
          const site = b.channel.site;
          spark.state = 'planted'; spark.site = site;
          spark.pos.copy(SITES[site].pos); spark.detonateT = DETONATE_TIME;
          b.channel = null; b.state = 'hold'; b.holdT = 999;
          state.phase = 'planted';
          state.banner = `SPARK PLANTED AT SITE ${site}`;
          state.bannerSub = 'Defuse it before it blows — hold E at the Spark.';
          state.audio.plantBeep(true);
          for (const v of state.bots) {
            if (v.team === TEAM.VANGUARD && v.alive) { v.state = 'retake'; v.retakePos = SITES[site].pos.clone(); }
          }
        }
      }
    }
  } else if (spark.state === 'planted') {
    spark.detonateT -= dt;
    if (Math.ceil(spark.detonateT) !== Math.ceil(spark.detonateT + dt)) state.audio.plantBeep(false);
    // Player defusing: standing at the planted Spark, holding E.
    const p = state.player;
    if (p.alive && api.playerHoldingE() && p.pos.distanceTo(spark.pos) < 2.5) {
      spark.defuseT += dt;
      p.channel = { kind: 'defuse', t: spark.defuseT };
      if (spark.defuseT >= DEFUSE_TIME) {
        p.channel = null;
        spark.state = 'defused';
        endRound(state, TEAM.VANGUARD, 'Spark defused');
        return;
      }
    } else {
      spark.defuseT = Math.max(0, spark.defuseT - dt * 2);
      if (p.channel?.kind === 'defuse') p.channel = null;
    }
    if (spark.detonateT <= 0) {
      state.audio.explosion();
      endRound(state, TEAM.JACKAL, 'Spark detonated');
      return;
    }
  }

  // --- round timer.
  state.roundTimeLeft -= dt;
  if (state.roundTimeLeft <= 0) {
    // Time out: if the Spark is planted it still blows (handled above);
    // otherwise the defenders win the round for holding the sites.
    if (spark.state === 'planted') return; // detonation timer decides
    endRound(state, TEAM.VANGUARD, 'Time expired — sites held');
    return;
  }

  // --- elimination wins.
  const vAlive = aliveOf(state, TEAM.VANGUARD);
  const jAlive = aliveOf(state, TEAM.JACKAL);
  if (jAlive === 0) {
    if (spark.state === 'planted') {
      // Attackers are dead but the Spark still ticks: defenders must defuse.
      return;
    }
    endRound(state, TEAM.VANGUARD, 'Jackal squad eliminated');
    return;
  }
  if (vAlive === 0) {
    if (spark.state === 'planted') return; // detonation decides, not the wipe
    endRound(state, TEAM.JACKAL, 'Vanguard squad eliminated');
    return;
  }

  // --- power-round railgun pickup: walk onto the pedestal.
  if (state.railgun.spawned && !state.railgun.taken) {
    const p = state.player;
    if (p.alive && p.pos.distanceTo(state.railgun.pos) < 1.6) {
      state.railgun.taken = true;
      p.weapon = createWeaponState('railgun');
      p.owned.railgun = true;
      state.audio.pickup();
      state.banner = 'PROTOTYPE RAILGUN ACQUIRED';
      state.bannerSub = 'One shot, one deletion. Make it count.';
      state.bannerT = 2.5;
    } else {
      for (const b of state.bots) {
        if (b.alive && b.pos.distanceTo(state.railgun.pos) < 1.6) {
          state.railgun.taken = true;
          b.weapon = createWeaponState('railgun');
          b.hasRailgun = true;
          state.banner = `${b.name} took the railgun`;
          state.bannerSub = 'Take them down before they use it.';
          state.bannerT = 2.5;
          break;
        }
      }
    }
  }
  if (state.bannerT) {
    state.bannerT -= dt;
    if (state.bannerT <= 0 && state.phase === 'live') { state.banner = ''; state.bannerSub = ''; }
  }
}
