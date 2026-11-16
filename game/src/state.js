// state.js — the single place match state lives.
// Every module reads and writes this one object; nothing else holds match truth.
// Fixed-step simulation: SIM_DT is the only tick size the sim ever uses.
import * as THREE from 'three';

export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100;   // seconds of live play per round
export const BUY_TIME = 15;      // seconds of buy phase before a round
export const PLANT_TIME = 3;     // seconds holding E to plant the Spark
export const DEFUSE_TIME = 4;    // seconds holding E to defuse the Spark
export const DETONATE_TIME = 35; // seconds from plant to detonation
export const WIN_ROUNDS = 5;     // first team to this many rounds wins the match
export const POWER_ROUND_EVERY = 3; // every 3rd round a prototype railgun spawns mid
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1400;

export const TEAM = { VANGUARD: 'vanguard', JACKAL: 'jackal' };

export function createState() {
  return {
    phase: 'menu', // menu | buy | live | planted | roundEnd | matchEnd
    phaseT: 0,     // seconds spent in the current phase
    round: 1,
    score: { vanguard: 0, jackal: 0 },
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    roundTimeLeft: ROUND_TIME,
    buyTimeLeft: BUY_TIME,
    powerRound: false,
    winner: null,      // 'vanguard' | 'jackal' | null (round winner)
    matchWinner: null,
    banner: '',        // centre-screen banner text (HUD reads this)
    bannerSub: '',
    // The Spark (bomb objective). carrier is a bot object or 'player' or null.
    spark: { state: 'carried', site: null, plantT: 0, defuseT: 0, detonateT: 0, pos: new THREE.Vector3() },
    // Prototype railgun on the mid-plaza pedestal during power rounds.
    railgun: { spawned: false, taken: false, pos: new THREE.Vector3(0, 1.1, 0) },
    player: null,      // filled by player.js
    bots: [],          // filled by bots.js
    noise: [],         // {pos, t, loud} recent sounds bots can investigate
    killfeed: [],      // {text, t} newest first, HUD trims to 5
    log: [],           // test log lines (self-test mode)
    time: 0,           // total sim time
    errors: [],        // window.onerror captures land here (smoke test reads this)
  };
}

// One shared scratch area so hot loops never allocate. Modules import these
// temps instead of `new THREE.Vector3()` inside per-frame code.
export const TMP = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  ray: new THREE.Raycaster(),
};
