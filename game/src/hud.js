// hud.js — the DOM HUD and the buy menu. One job: show state, take buy clicks.
// It never decides game logic; it reads state and calls the buy functions.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { buyWeapon, buyGrenade, buyArmor } from './player.js';

export function createHud(state, player) {
  const $ = (id) => document.getElementById(id);
  const el = {
    health: $('health-num'), healthBar: $('health-bar'), armor: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    weaponName: $('weapon-name'),
    timer: $('timer'), roundLabel: $('round-label'),
    scoreV: $('score-v'), scoreJ: $('score-j'),
    money: $('money'), kills: $('kills'),
    banner: $('banner'), bannerSub: $('banner-sub'),
    killfeed: $('killfeed'), channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    buy: $('buy-menu'), buyItems: $('buy-items'), buyMoney: $('buy-money'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    flash: $('flash-overlay'), help: $('help-line'),
    teamV: $('team-v'), teamJ: $('team-j'),
  };
  let buyOpen = false;
  let lastFeed = -1;
  let hitT = 0;

  function teamList(team) {
    const rows = [];
    if (team === 'vanguard') {
      rows.push(`<span class="${player.alive ? 'alive' : 'dead'}">You — ${player.hp} HP</span>`);
    }
    for (const b of state.bots) {
      if (b.team !== team) continue;
      rows.push(`<span class="${b.alive ? 'alive' : 'dead'}">${b.name} — ${b.alive ? b.hp + ' HP' : 'DOWN'}</span>`);
    }
    return rows.join('');
  }

  function buildBuyMenu() {
    const rows = [];
    for (const id of ['petal', 'chatter', 'lantern', 'longbow']) {
      const w = WEAPONS[id];
      const owned = player.owned[id];
      rows.push(`<button data-buy="weapon:${id}" ${owned ? 'class="owned"' : ''}>
        <b>${w.name}</b><span>${w.desc}</span><em>${owned ? 'OWNED — press to equip' : '$' + w.price}</em></button>`);
    }
    for (const id of ['frag', 'smoke', 'flash']) {
      const g = GRENADES[id];
      rows.push(`<button data-buy="grenade:${id}">
        <b>${g.name} ×${player.grenades[id]}</b><span>${g.desc}</span><em>$${g.price}</em></button>`);
    }
    rows.push(`<button data-buy="armor">
      <b>Kevlar Vest ${player.armor > 0 ? '(' + Math.round(player.armor) + ')' : ''}</b><span>Absorbs half of incoming damage.</span><em>$${ARMOR_PRICE}</em></button>`);
    rows.push(`<button data-buy="railgun-info" disabled>
      <b>Prototype Railgun</b><span>Power rounds only — spawns on the mid-plaza pedestal.</span><em>NOT FOR SALE</em></button>`);
    el.buyItems.innerHTML = rows.join('');
  }

  el.buyItems.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    const [kind, id] = btn.dataset.buy.split(':');
    let ok = false;
    if (kind === 'weapon') ok = buyWeapon(player, id, state);
    else if (kind === 'grenade') ok = buyGrenade(player, id, state);
    else if (kind === 'armor') ok = buyArmor(player, state);
    if (ok) state.audio.buy();
    buildBuyMenu();
    update();
  });

  function update() {
    // Health / armor / ammo.
    el.health.textContent = Math.ceil(player.hp);
    el.healthBar.style.width = Math.max(0, player.hp) + '%';
    el.healthBar.style.background = player.hp > 50 ? '#2ee6ff' : player.hp > 25 ? '#ffb347' : '#ff4d3d';
    el.armor.textContent = Math.ceil(player.armor);
    const w = player.weapon;
    el.ammoMag.textContent = w.reloading ? '--' : w.mag;
    el.ammoReserve.textContent = '/ ' + w.reserve;
    el.ammo.classList.toggle('empty', w.mag === 0);
    el.weaponName.textContent = w.def.name + (w.reloading ? ' — reloading' : '');
    // Timer: buy countdown in buy phase, round timer live, detonation when planted.
    if (state.phase === 'buy') {
      el.timer.textContent = Math.ceil(state.buyTimeLeft) + 's';
      el.roundLabel.textContent = `BUY — ROUND ${state.round}`;
    } else if (state.spark.state === 'planted') {
      el.timer.textContent = Math.ceil(state.spark.detonateT) + 's';
      el.roundLabel.textContent = `SPARK AT SITE ${state.spark.site} — DEFUSE!`;
      el.timer.classList.add('danger');
    } else {
      el.timer.textContent = Math.ceil(state.roundTimeLeft) + 's';
      el.roundLabel.textContent = `ROUND ${state.round}${state.powerRound ? ' — POWER ROUND' : ''}`;
      el.timer.classList.remove('danger');
    }
    el.scoreV.textContent = state.score.vanguard;
    el.scoreJ.textContent = state.score.jackal;
    el.money.textContent = '$' + state.money;
    el.kills.textContent = player.kills;
    // Banner.
    el.banner.textContent = state.banner;
    el.bannerSub.textContent = state.bannerSub;
    el.banner.parentElement.classList.toggle('show', state.banner !== '');
    // Killfeed (newest first, five max).
    if (state.killfeed.length !== lastFeed) {
      lastFeed = state.killfeed.length;
      el.killfeed.innerHTML = state.killfeed.slice(0, 5)
        .map((k) => `<div>${k.text}</div>`).join('');
    }
    // Plant / defuse progress.
    const ch = player.channel;
    if (ch) {
      const total = ch.kind === 'plant' ? 3 : 4;
      el.channelFill.style.width = Math.min(100, (ch.t / total) * 100) + '%';
      el.channelLabel.textContent = ch.kind === 'plant' ? 'PLANTING SPARK…' : 'DEFUSING SPARK…';
      el.channel.classList.add('show');
    } else el.channel.classList.remove('show');
    // Crosshair gap follows spread: wide while moving/firing, tight when still.
    const spread = player.lastSpread ?? 0.01;
    const gap = 4 + Math.min(26, spread * 420);
    el.crosshair.style.setProperty('--gap', gap + 'px');
    // Flash blindness.
    el.flash.style.opacity = player.flashT > 0 ? Math.min(0.95, player.flashT) : 0;
    // Teams.
    el.teamV.innerHTML = teamList('vanguard');
    el.teamJ.innerHTML = teamList('jackal');
    // Buy menu visibility: buy phase only, or B toggles it during buy.
    const show = state.phase === 'buy' && buyOpen;
    el.buy.classList.toggle('open', show);
    if (show) el.buyMoney.textContent = 'Balance $' + state.money;
    // Context help line.
    let help = 'WASD move · Mouse aim · Click fire · R reload · B buy · E plant/defuse · G grenade · 1-4 weapons';
    if (state.spark.state === 'planted' && player.alive) help = 'SPARK PLANTED — get to Site ' + state.spark.site + ' and hold E to defuse!';
    if (state.powerRound && state.railgun.spawned && !state.railgun.taken) help = 'POWER ROUND — prototype railgun on the mid-plaza pedestal!';
    el.help.textContent = help;
  }

  return {
    update,
    toggleBuy() {
      if (state.phase !== 'buy') return;
      buyOpen = !buyOpen;
      if (buyOpen) buildBuyMenu();
      update();
    },
    openBuy() { if (state.phase === 'buy') { buyOpen = true; buildBuyMenu(); update(); } },
    closeBuy() { buyOpen = false; update(); },
    isBuyOpen() { return buyOpen; },
    hitmarker(kill) {
      el.hitmarker.classList.add('on');
      if (kill) el.hitmarker.classList.add('kill');
      hitT = 0.18;
      setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), 180);
    },
  };
}
