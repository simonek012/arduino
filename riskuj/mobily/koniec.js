/* ================= RISKUJ LEN NA MOBILOCH: obrazovky a napojenie na hru ================= */
(function () {
  'use strict';
  const RM = window.RM; if (!RM) return;
  const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const root = document.documentElement;
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
  root.classList.add('rm');

  // displej nech nezhasne – inak sa mobil uspí a spojenie vypadne
  let wake = null;
  const keepAwake = () => { try { if ('wakeLock' in navigator && (!wake || wake.released)) navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => {}); } catch (e) {} };
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

  /* ---------- úvod: kto som? ---------- */
  if (!RM.mode) {
    let last = {};
    try { last = JSON.parse(ls('rm-last')) || {}; } catch (e) {}
    const box = document.createElement('div');
    box.id = 'rmStart';
    box.innerHTML = `<div class="rm-in">
      <h1 class="logo" aria-label="Riskuj a nepiskuj!">Riskuj<span class="logo-sub">a nepiskuj!</span></h1>
      <p class="rm-lead">Len na mobiloch – bez počítača a TV. Jeden mobil má moderátor, ostatní hráči.</p>
      <button class="rm-big" type="button" id="rmMod"><b>🎤 Som moderátor</b><span>Vytvorím hru, čítam otázky a vidím aj odpovede.</span></button>
      <form class="rm-card" id="rmJoin" autocomplete="off">
        <b>🙋 Som hráč</b>
        <input id="rmKod" maxlength="4" placeholder="KÓD HRY" autocapitalize="characters" spellcheck="false" aria-label="Kód hry" value="${h(last.room || '')}">
        <input id="rmMeno" maxlength="16" placeholder="Tvoje meno" aria-label="Tvoje meno" value="${h(last.name || '')}">
        <button class="rm-go" type="submit">Pripojiť sa</button>
        <p class="rm-err" id="rmErr"></p>
      </form>
      <p class="rm-tip">Každý si otvorí <b>tento istý súbor</b> v prehliadači (napr. Chrome). Treba internet – najistejšie je, keď ste všetci na jednej Wi-Fi alebo na hotspote z mobilu moderátora.</p>
    </div>`;
    document.body.appendChild(box);
    root.classList.add('rm-start');
    box.querySelector('#rmMod').onclick = () => {
      let room = ls('rm-room') || '';
      if (!/^[A-Z]{4}$/.test(room)) { room = RM.novyKod(); ls('rm-room', room); }
      RM.nastav({mode: 'mod', room});
    };
    const kod = box.querySelector('#rmKod');
    kod.addEventListener('input', () => { const v = kod.value.toUpperCase().replace(/[^A-Z]/g, ''); if (v !== kod.value) kod.value = v; });
    box.querySelector('#rmJoin').addEventListener('submit', e => {
      e.preventDefault();
      const room = kod.value.trim().toUpperCase(), name = box.querySelector('#rmMeno').value.trim();
      const err = box.querySelector('#rmErr');
      if (!/^[A-Z]{4}$/.test(room)) { err.textContent = 'Kód hry má 4 písmená – nájdeš ho na mobile moderátora.'; kod.focus(); return; }
      if (!name) { err.textContent = 'Napíš svoje meno.'; box.querySelector('#rmMeno').focus(); return; }
      ls('rm-last', JSON.stringify({room, name}));
      RM.nastav({mode: 'hrac', room, name: name.slice(0, 16)});
    });
    return;
  }

  root.classList.add('rm-' + RM.mode);
  setTimeout(() => root.classList.remove('rm-boot'), 0);   // úpravy obrazoviek nižšie sú hotové
  const potvrd = (el, txt, fn) => {                    // druhé ťuknutie potvrdí (bez okien prehliadača)
    if (!el.dataset.armed) { el.dataset.armed = '1'; el.dataset.txt = el.textContent; el.textContent = txt; setTimeout(() => { if (el.isConnected && el.dataset.armed) { delete el.dataset.armed; el.textContent = el.dataset.txt; } }, 4000); return; }
    fn();
  };

  /* ---------- MODERÁTOR ---------- */
  if (RM.mode === 'mod') {
    let zvukHraci = ls('rm-zvuk-hraci') === '1';
    window.RM_ZVUK = () => !(S && S.rmZvukHraci && RM.peersN > 0);   // zvuky hrá moderátor, ak ich nepresunul na mobily hráčov
    const stavText = () => ({
      ok: `Hra je otvorená – hráči sa môžu pripojiť (pripojené mobily: ${RM.peersN}).`,
      connecting: 'Pripájam sa na internet…',
      reconnecting: 'Spojenie s internetom vypadlo, skúšam znova… Pripojení hráči zatiaľ hrajú ďalej.',
      taken: 'Tento kód hry je ešte obsadený (napr. hra otvorená v inom okne alebo pred chvíľou zatvorená). Skúšam znova…',
      error: 'Prehliadač nepodporuje spojenie. Skús Chrome.'
    })[RM.status] || 'Pripájam sa…';
    const roomHtml = () => `<section class="rm-room" id="rmRoom"><h3>📱 Hra len na mobiloch</h3>
        <div class="rm-kod">Kód hry: <b>${h(RM.room)}</b></div>
        <p class="hint rm-stav" id="rmRoomStav">${h(stavText())}</p>
        <ol class="steps">
          <li>Hráči si otvoria <b>tento istý súbor</b> v prehliadači (napr. Chrome).</li>
          <li>Ťuknú <b>Som hráč</b>, zadajú kód <b>${h(RM.room)}</b> a svoje meno.</li>
          <li>Keď sú všetci v zozname, spusti hru. Ty vidíš aj odpovede, hráči majú v mobile tabuľu, otázky a tlačidlo.</li>
        </ol>
        <div class="pchips" id="plist"></div>
        <label class="check"><input type="checkbox" id="rmZvuk"${zvukHraci ? ' checked' : ''}> Zvuky a melódie hrať na mobiloch hráčov (keď nie ste v jednej miestnosti)</label>
        <div class="rm-row"><button class="lnk" type="button" data-act="phonesreset">Odpojiť všetky mobily</button><button class="lnk" type="button" data-act="rm-novykod">Nový kód hry</button><button class="lnk" type="button" data-act="rm-leave">Zmeniť rolu</button></div>
      </section>`;
    const _vSetup = vSetup;
    vSetup = function () {
      return _vSetup()
        .replace(/<section class="cheat-cta" style="border-top:0;padding-top:0">[\s\S]*?<\/section>/, '')
        .replace(/<section class="phones" id="phones">[\s\S]*?<\/section>/, roomHtml())
        .replace('<button class="btn" data-act="join" data-r="tv">TV pre hráčov</button>', '')
        .replace('<button class="btn" data-act="join" data-r="solo">Jedna obrazovka</button>', '');
    };
    const _act = act;
    act = function (a, el) {
      if (a === 'rm-leave') return potvrd(el, 'Naozaj? Ťukni znova', () => RM.nastav(null));
      if (a === 'rm-novykod') return potvrd(el, 'Hráči sa budú musieť pripojiť znova – ťukni znova', () => { const room = RM.novyKod(); ls('rm-room', room); RM.nastav({mode: 'mod', room}); });
      return _act(a, el);
    };
    document.addEventListener('change', e => { if (e.target.id === 'rmZvuk') { zvukHraci = e.target.checked; ls('rm-zvuk-hraci', zvukHraci ? '1' : '0'); render(); } });
    const _render = render;
    render = function (remote) { if (S) S.rmZvukHraci = zvukHraci; return _render(remote); };

    // pilulka s kódom hry – ťuknutím sa ukáže, ako sa pripojiť
    const pill = document.createElement('button');
    pill.type = 'button'; pill.id = 'rmPill';
    document.body.appendChild(pill);
    const info = document.createElement('div');
    info.id = 'rmInfo'; info.hidden = true;
    document.body.appendChild(info);
    const paintInfo = () => {
      if (info.hidden) return;
      const hraci = RM.server.hraci();
      info.innerHTML = `<div class="rm-in"><h3>📱 Pripojenie hráčov</h3>
        <div class="rm-kod">Kód hry: <b>${h(RM.room)}</b></div>
        <p class="hint">${h(stavText())}</p>
        <p class="hint">Hráč si otvorí tento istý súbor, ťukne <b>Som hráč</b> a zadá kód. Kto vypadol, zadá svoje meno znova a pokračuje so svojimi bodmi.</p>
        <div class="pchips">${hraci.length ? hraci.map(p => `<span class="pchip"><b>${p.online ? '📱' : '📵'}</b> ${h(p.name)}</span>`).join('') : '<span class="hint">Zatiaľ nikto.</span>'}</div>
        <button class="rm-go" type="button" id="rmInfoX">Zavrieť</button></div>`;
      info.querySelector('#rmInfoX').onclick = () => { info.hidden = true; };
    };
    pill.onclick = () => { info.hidden = !info.hidden; paintInfo(); };
    const dot = () => ({ok: '🟢', connecting: '🟡', reconnecting: '🟡', taken: '🟠'})[RM.status] || '🔴';
    RM.onStatus = () => {
      pill.innerHTML = `${dot()} Kód <b>${h(RM.room)}</b> · 📱 ${RM.peersN}`;
      const st = document.getElementById('rmRoomStav'); if (st) st.textContent = stavText();
      paintInfo();
    };
    setInterval(paintInfo, 2000);
    // na úvode: prázdni hráči „Hráč 3…“ bez mobilu navyše sa odoberú, keď sa pripojili mobily
    setInterval(() => {
      if (!S || S.phase !== 'setup') return;
      const n = RM.server.hraci().length;
      let zmena = false;
      while (n >= MIN_PLAYERS && S.players.length > Math.max(MIN_PLAYERS, n)) {
        const p = S.players[S.players.length - 1];
        if (p.phone || !/^Hráč \d+$/.test(p.name)) break;
        S.players.pop(); zmena = true;
      }
      if (zmena) { store({players: S.players, sound: S.sound}); render(); }
    }, 1000);
    RM.onStatus();
    render(true);
    return;
  }

  /* ---------- HRÁČ ---------- */
  window.RM_ZVUK = () => !!(S && S.rmZvukHraci);
  // stav hry prichádza od moderátora: hráč sa k nej pripojí sám, aj keď beží dlhšie
  window.RM_PRIJMI = m => {
    if (m.t === 'left') { if (inGame() && m.code === S.code) { S = setupState(); hist = []; render(true); } return true; }
    if (m.t === 'state' && m.S && m.S.phase && (!inGame() || m.S.code !== S.code)) { joinGame(m.S, 'tv'); return true; }
    return false;
  };
  const stavText = () => ({
    ok: 'Pripojený',
    connecting: 'Pripájam sa…',
    nomod: `Moderátor s kódom ${RM.room} ešte nie je pripojený – skúšam znova…`,
    error: 'Prehliadač nepodporuje spojenie. Skús Chrome.'
  })[RM.status] || 'Pripájam sa…';
  let cakajuci = [];
  vSetup = function () {
    return `<section class="setup rm-wait"><h1 class="logo" aria-label="Riskuj a nepiskuj!">Riskuj<span class="logo-sub">a nepiskuj!</span></h1>
      <p class="tag">Si v hre <b>${h(RM.room)}</b> ako <b>${h(RM.name)}</b>.</p>
      <p class="tag" id="rmWaitStav">${RM.status === 'ok' ? 'Čakáme, kým moderátor spustí hru. Potom tu uvidíš tabuľu a otázky, tlačidlo máš dole.' : h(stavText())}</p>
      <div class="pchips" id="rmWaitList">${cakajuci.map(p => `<span class="pchip">${p.online ? '📱' : '📵'} ${h(p.name)}</span>`).join('')}</div></section>`;
  };
  setInterval(() => {
    if (inGame() || !RM.isOpen()) return;
    RM.api('state').then(st => {
      const k = JSON.stringify(st.players || []);
      if (k === JSON.stringify(cakajuci)) return;
      cakajuci = st.players || [];
      if (!inGame()) render(true);
    }).catch(() => {});
  }, 2000);

  // dole: tlačidlo (mobil.html v rámčeku) a stav spojenia
  const panel = document.createElement('div');
  panel.id = 'rmBz'; panel.dataset.mode = 'buzz';
  panel.innerHTML = '<div class="rm-bzhead"><span id="rmBzStav"></span><button type="button" id="rmOdist">Odísť</button></div>';
  const fr = document.createElement('iframe');
  fr.title = 'Tlačidlo'; fr.setAttribute('allow', 'screen-wake-lock; autoplay');
  fr.srcdoc = window.RM_TLACIDLO.replace('<script>', '<script>window.RM_NAME=' + JSON.stringify(RM.name).replace(/</g, '\\u003c') + ';<\/script><script>');
  panel.appendChild(fr);
  document.body.appendChild(panel);
  const odist = panel.querySelector('#rmOdist');
  odist.onclick = () => potvrd(odist, 'Naozaj odísť?', () => RM.nastav(null));
  const VYSKA = {buzz: '34vh', zet: '50vh', final: '60vh', join: '72vh'};
  const nastavVysku = () => root.style.setProperty('--bzh', VYSKA[panel.dataset.mode] || VYSKA.buzz);
  nastavVysku();
  window.addEventListener('message', e => {
    if (e.source !== fr.contentWindow) return;
    const d = e.data || {};
    if (d.rmApi) {
      const {rid, path, body} = d.rmApi;
      RM.api(path, body).then(data => fr.contentWindow.postMessage({rmApiRes: {rid, ok: data != null, data}}, '*'),
        () => fr.contentWindow.postMessage({rmApiRes: {rid, ok: false}}, '*'));
    }
    if (d.rmMode && d.rmMode !== panel.dataset.mode) { panel.dataset.mode = d.rmMode; nastavVysku(); }
  });
  // finálová otázka sa ukáže aj pri políčku na odpoveď
  let lastFq = null;
  const posliFq = () => {
    const q = inGame() && S.phase === 'finalQ' && S.final ? S.final.q : '';
    if (q === lastFq || !fr.contentWindow) return;
    lastFq = q; fr.contentWindow.postMessage({rmFinalQ: q}, '*');
  };
  const _render = render;
  render = function (remote) { const r = _render(remote); posliFq(); return r; };
  RM.onStatus = () => {
    const st = document.getElementById('rmBzStav');
    if (st) st.innerHTML = `${RM.status === 'ok' ? '🟢' : RM.status === 'nomod' ? '🟠' : '🟡'} ${h(stavText())} · hra <b>${h(RM.room)}</b>`;
    const w = document.getElementById('rmWaitStav');
    if (w) w.textContent = RM.status === 'ok' ? 'Čakáme, kým moderátor spustí hru. Potom tu uvidíš tabuľu a otázky, tlačidlo máš dole.' : stavText();
  };
  RM.onStatus();
  render(true);
})();
