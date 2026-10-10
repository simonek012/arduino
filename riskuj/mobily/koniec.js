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

  /* ---------- QR kódy: kreslenie a skenovanie fotoaparátom (na spojenie bez internetu) ---------- */
  const QR = {
    svg(txt) {
      const q = qrcode(0, 'L'); q.addData(txt); q.make();
      const n = q.getModuleCount(), m = 3;
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!q.isDark(r, c)) continue;
        let k = 1; while (c + k < n && q.isDark(r, c + k)) k++;
        d += `M${c + m} ${r + m}h${k}v1h-${k}z`; c += k - 1;
      }
      return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR kód"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    },
    // zapne zadný fotoaparát a každý prečítaný kód pošle do naText; vráti funkciu, ktorá kameru vypne
    async skener(video, naText) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('kamera');
      const stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}}});
      let stop = false, det = null;
      try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) det = new BarcodeDetector({formats: ['qr_code']}); } catch (e) {}
      video.muted = true; video.setAttribute('playsinline', ''); video.srcObject = stream;
      video.play().catch(() => {});
      const cv = document.createElement('canvas'), cx = cv.getContext('2d', {willReadFrequently: true});
      const krok = async () => {
        if (stop) return;
        let txt = null;
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            if (det) { const r = await det.detect(video); if (r.length) txt = r[0].rawValue; }
            else if (window.jsQR) {
              const k = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
              cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
              cx.drawImage(video, 0, 0, cv.width, cv.height);
              const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, {inversionAttempts: 'dontInvert'});
              if (r && r.data) txt = r.data;
            }
          } catch (e) { det = null; }          // keď vstavaná čítačka zlyhá, ďalej číta jsQR
        }
        if (txt && !stop) { try { naText(txt); } catch (e) {} }
        if (!stop) setTimeout(krok, det ? 120 : 160);
      };
      krok();
      return () => { stop = true; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; };
    }
  };

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
        <input id="rmMeno" maxlength="16" placeholder="Tvoje meno" aria-label="Tvoje meno" value="${h(last.name || '')}">
        <button class="rm-go" type="button" id="rmSken">📷 Naskenovať QR kód moderátora</button>
        <div class="rm-skener" id="rmSkener" hidden>
          <div class="rm-cam big"><video muted playsinline></video></div>
          <button class="lnk" type="button" id="rmSkenX">Zrušiť</button>
        </div>
        <p class="rm-err" id="rmErr"></p>
        <div class="rm-alebo">alebo zadaj kód hry</div>
        <div class="rm-kodrow">
          <input id="rmKod" maxlength="4" placeholder="KÓD" autocapitalize="characters" spellcheck="false" aria-label="Kód hry" value="${h(last.room || '')}">
          <button class="rm-go2" type="submit">Pripojiť</button>
        </div>
        <button class="lnk" type="button" id="rmBezNetu">📶 Bez internetu a kamera nejde? Pripojiť ručne</button>
      </form>
      <p class="rm-tip">Každý si otvorí <b>tento istý súbor</b> v prehliadači (napr. Chrome), hráč napíše meno a naskenuje QR kód z mobilu moderátora.<br>
        <b>Bez internetu</b> (bez dát): všetci sa pripojte na jednu Wi-Fi alebo na hotspot z mobilu moderátora – QR kód funguje aj tak.</p>
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
    // QR kód moderátora: s internetom je v ňom kód hry, bez internetu údaje na priame spojenie
    const err = t => { box.querySelector('#rmErr').textContent = t || ''; };
    const meno = () => {
      const name = box.querySelector('#rmMeno').value.trim();
      if (!name) { err('Najprv napíš svoje meno.'); box.querySelector('#rmMeno').focus(); }
      return name.slice(0, 16);
    };
    let skenStop = null;
    const skenKoniec = () => { if (skenStop) { skenStop(); skenStop = null; } box.querySelector('#rmSkener').hidden = true; box.querySelector('#rmSken').hidden = false; };
    const naskenovane = txt => {
      txt = String(txt || '').trim();
      const name = box.querySelector('#rmMeno').value.trim().slice(0, 16);
      let m = /^RISKUJ-HRA\|([A-Z]{4})$/.exec(txt);
      if (m) { skenKoniec(); ls('rm-last', JSON.stringify({room: m[1], name})); RM.nastav({mode: 'hrac', room: m[1], name}); return; }
      const s = RM.sigRozbal ? RM.sigRozbal(txt) : null;
      if (s && s.druh === 'O') { skenKoniec(); ls('rm-last', JSON.stringify({room: '', name})); RM.nastav({mode: 'hrac', off: 1, room: '', name, ponuka: txt}); return; }
      err(s ? 'To je kód iného hráča – naskenuj kód z mobilu moderátora.' : 'Toto nie je QR kód z hry Riskuj.');
    };
    box.querySelector('#rmSken').onclick = async () => {
      err(''); if (!meno()) return;
      box.querySelector('#rmSkener').hidden = false; box.querySelector('#rmSken').hidden = true;
      try { skenStop = await QR.skener(box.querySelector('#rmSkener video'), naskenovane); }
      catch (e) { skenKoniec(); err('Kamera nejde – povoľ ju prehliadaču, alebo zadaj kód hry nižšie.'); }
    };
    box.querySelector('#rmSkenX').onclick = skenKoniec;
    box.querySelector('#rmBezNetu').onclick = () => {
      const name = box.querySelector('#rmMeno').value.trim();
      if (!name) { box.querySelector('#rmErr').textContent = 'Napíš svoje meno.'; box.querySelector('#rmMeno').focus(); return; }
      ls('rm-last', JSON.stringify({room: kod.value.trim().toUpperCase(), name}));
      RM.nastav({mode: 'hrac', off: 1, room: '', name: name.slice(0, 16)});
    };
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
      connecting: 'Pripájam sa na internet… Ak internet nemáte, pripoj hráčov cez QR kód (tlačidlo nižšie).',
      reconnecting: 'Internet nie je dostupný – hráčov pripoj cez QR kód (tlačidlo nižšie). Pripojení hráči hrajú ďalej.',
      taken: 'Tento kód hry je ešte obsadený (napr. hra otvorená v inom okne alebo pred chvíľou zatvorená). Skúšam znova…',
      error: 'Prehliadač nepodporuje spojenie. Skús Chrome.'
    })[RM.status] || 'Pripájam sa…';
    const roomHtml = () => `<section class="rm-room" id="rmRoom"><h3>📱 Hra len na mobiloch</h3>
        ${RM.status === 'reconnecting' || RM.status === 'error' ? '' : `<div class="rm-kod">Kód hry: <b>${h(RM.room)}</b></div>`}
        <p class="hint rm-stav" id="rmRoomStav">${h(stavText())}</p>
        ${RM.status === 'reconnecting' || RM.status === 'error' ? '' : `<div class="rm-qrjoin"><div class="rm-qrkod">${QR.svg('RISKUJ-HRA|' + RM.room)}</div>
          <p class="hint">Hráč napíše meno, ťukne <b>📷 Naskenovať QR kód</b> a namieri mobil sem. Alebo zadá kód <b>${h(RM.room)}</b>.</p></div>`}
        ${RM.status === 'reconnecting' || RM.status === 'error' ? `<ol class="steps">
          <li>Všetci sa pripojte na <b>jednu Wi-Fi</b> alebo na <b>hotspot z tvojho mobilu</b> (mobilné dáta môžu byť vypnuté).</li>
          <li>Hráči si otvoria <b>tento istý súbor</b>, ťuknú <b>Som hráč</b>, napíšu meno a ťuknú <b>📷 Naskenovať QR kód</b>.</li>
          <li>Ty ťukni <b>Pripojiť hráča bez internetu</b> – hráč naskenuje tvoj kód a ty potom jeho (každý hráč zvlášť).</li>
          <li>Keď sú všetci v zozname, spusti hru.</li>
        </ol>` : `<ol class="steps">
          <li>Hráči si otvoria <b>tento istý súbor</b> v prehliadači (napr. Chrome) a ťuknú <b>Som hráč</b>.</li>
          <li>Napíšu meno a naskenujú QR kód vyššie (alebo zadajú kód <b>${h(RM.room)}</b>).</li>
          <li>Keď sú všetci v zozname, spusti hru. Ty vidíš aj odpovede, hráči majú v mobile tabuľu, otázky a tlačidlo.</li>
        </ol>`}
        <button class="rm-go2${RM.status === 'reconnecting' || RM.status === 'error' ? '' : ' rm-maly'}" type="button" data-act="rm-qr">📶 Pripojiť hráča bez internetu (QR kód)</button>
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
      if (a === 'rm-qr') return otvorQr();
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
        ${RM.status === 'reconnecting' || RM.status === 'error' ? '' : `<div class="rm-qrkod">${QR.svg('RISKUJ-HRA|' + RM.room)}</div>`}
        <div class="rm-kod">Kód hry: <b>${h(RM.room)}</b></div>
        <p class="hint">${h(stavText())}</p>
        <p class="hint">Hráč si otvorí tento istý súbor, ťukne <b>Som hráč</b>, napíše meno a naskenuje QR kód (alebo zadá kód). Kto vypadol, použije rovnaké meno a pokračuje so svojimi bodmi.</p>
        <div class="pchips">${hraci.length ? hraci.map(p => `<span class="pchip"><b>${p.online ? '📱' : '📵'}</b> ${h(p.name)}</span>`).join('') : '<span class="hint">Zatiaľ nikto.</span>'}</div>
        <button class="rm-go2" type="button" id="rmInfoQr">📶 Pripojiť hráča bez internetu (QR kód)</button>
        <button class="rm-go" type="button" id="rmInfoX">Zavrieť</button></div>`;
      info.querySelector('#rmInfoX').onclick = () => { info.hidden = true; };
      info.querySelector('#rmInfoQr').onclick = () => { info.hidden = true; otvorQr(); };
    };
    pill.onclick = () => { info.hidden = !info.hidden; paintInfo(); };
    const dot = () => ({ok: '🟢', connecting: '🟡', reconnecting: '🟡', taken: '🟠'})[RM.status] || '🔴';
    let bolNet = null;
    RM.onStatus = () => {
      const bezNetu = RM.status === 'reconnecting' || RM.status === 'error';
      pill.innerHTML = bezNetu ? `📶 Bez internetu · 📱 ${RM.peersN}` : `${dot()} Kód <b>${h(RM.room)}</b> · 📱 ${RM.peersN}`;
      if (bolNet !== null && bolNet !== bezNetu && S && S.phase === 'setup') setTimeout(() => render(), 0);   // iný návod na pripojenie
      bolNet = bezNetu;
      const st = document.getElementById('rmRoomStav'); if (st) st.textContent = stavText();
      paintInfo();
    };
    setInterval(() => { paintInfo(); if (!qrBox.hidden) qrHraci(); }, 2000);

    // pripojenie bez internetu: moderátor ukáže QR kód, hráč ukáže svoj a moderátor ho naskenuje
    const qrBox = document.createElement('div');
    qrBox.id = 'rmQr'; qrBox.className = 'rm-over'; qrBox.hidden = true;
    qrBox.innerHTML = `<div class="rm-in">
      <div class="rm-hlava"><h3>📶 Pripojiť bez internetu</h3><button class="btn" type="button" id="rmQrX">Hotovo</button></div>
      <p class="hint">Všetci na <b>jednej Wi-Fi</b> (stačí hotspot z tvojho mobilu, aj bez dát).</p>
      <p class="rm-krok"><b>1.</b> Hráč ťukne <b>Bez internetu</b> a naskenuje tento kód:</p>
      <div class="rm-qrkod" id="rmQrKod"></div>
      <p class="rm-krok"><b>2.</b> Potom namier fotoaparát na kód, ktorý sa ukáže v mobile hráča:</p>
      <div class="rm-cam"><video muted playsinline></video></div>
      <p class="rm-qrstav" id="rmQrStav"></p>
      <div class="pchips" id="rmQrHraci"></div>
      <details class="rm-vloz"><summary>Kamera nejde?</summary>
        <p class="hint">Odfoť kód z mobilu hráča inou aplikáciou (napr. Google Lens), skopíruj text a vlož ho sem.</p>
        <textarea id="rmQrText" rows="3" spellcheck="false" autocapitalize="off"></textarea>
        <button class="btn" type="button" id="rmQrVloz">Pripojiť</button></details></div>`;
    document.body.appendChild(qrBox);
    let qrStop = null, qrBusy = false;
    const qrVidene = new Set();
    const qrStav = (t, ok) => { const el = qrBox.querySelector('#rmQrStav'); el.textContent = t || ''; el.className = 'rm-qrstav' + (t ? ok ? ' ok' : ' bad' : ''); };
    function qrHraci() {
      const l = RM.server.hraci();
      qrBox.querySelector('#rmQrHraci').innerHTML = l.map(p => `<span class="pchip">${p.online ? '📱' : '📵'} ${h(p.name)}</span>`).join('');
    }
    const novaPonuka = async () => {
      const box = qrBox.querySelector('#rmQrKod');
      box.innerHTML = '<span class="hint">Pripravujem kód…</span>';
      try { const t = await RM.qrPonuka(); if (!qrBox.hidden) box.innerHTML = QR.svg(t); }
      catch (e) {
        box.innerHTML = `<span class="rm-err">${h(e.message)}</span><button class="lnk" type="button" id="rmQrZnova">Skúsiť znova</button>`;
        box.querySelector('#rmQrZnova').onclick = novaPonuka;
      }
    };
    const qrText = async txt => {
      txt = String(txt || '').trim();
      if (!txt || qrBusy || qrVidene.has(txt)) return;
      const s = RM.sigRozbal(txt);
      if (s && s.druh === 'O') return;                 // vlastný kód moderátora (napr. v odraze) nevadí
      qrVidene.add(txt); qrBusy = true;
      try { await RM.qrPrijmi(txt); qrStav('Spájam sa s hráčom…', true); novaPonuka(); }
      catch (e) { qrStav(e.message); }
      qrBusy = false;
    };
    RM.onQr = co => {
      if (co === 'ok') { qrStav('✅ Hráč je pripojený. Ďalší hráč môže naskenovať nový kód.', true); try { navigator.vibrate && navigator.vibrate(80); } catch (e) {} }
      else qrStav('Spojenie sa nepodarilo. Ste na tej istej Wi-Fi? Hráč nech naskenuje nový kód.');
      if (!qrBox.hidden) qrHraci();
    };
    async function otvorQr() {
      if (!qrBox.hidden) return;
      qrBox.hidden = false; qrStav(''); qrHraci();
      qrBox.querySelector('#rmQrKod').innerHTML = '<span class="hint">Pripravujem kód…</span>';
      // najprv kamera – s povolenou kamerou dá prehliadač do kódu aj skutočnú adresu mobilu v sieti
      if (!qrStop) {
        try { qrStop = await QR.skener(qrBox.querySelector('video'), qrText); }
        catch (e) { qrStav('Kamera nejde – povoľ ju prehliadaču, alebo použi „Kamera nejde?“ nižšie.'); qrBox.querySelector('.rm-vloz').open = true; }
      }
      if (qrBox.hidden) { if (qrStop) { qrStop(); qrStop = null; } return; }
      novaPonuka();
    }
    qrBox.querySelector('#rmQrX').onclick = () => { qrBox.hidden = true; if (qrStop) { qrStop(); qrStop = null; } render(); };
    qrBox.querySelector('#rmQrVloz').onclick = () => { const t = qrBox.querySelector('#rmQrText'); qrText(t.value); t.value = ''; };
    RM.otvorQr = otvorQr;
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
    qr: 'Pripoj sa cez QR kód moderátora',
    'qr-caka': 'Čakám, kým moderátor naskenuje tvoj kód…',
    'qr-zlyhalo': 'Spojenie sa nepodarilo',
    error: 'Prehliadač nepodporuje spojenie. Skús Chrome.'
  })[RM.status] || 'Pripájam sa…';
  let cakajuci = [];
  vSetup = function () {
    return `<section class="setup rm-wait"><h1 class="logo" aria-label="Riskuj a nepiskuj!">Riskuj<span class="logo-sub">a nepiskuj!</span></h1>
      <p class="tag">${RM.off ? `Si v hre ako <b>${h(RM.name)}</b> (bez internetu).` : `Si v hre <b>${h(RM.room)}</b> ako <b>${h(RM.name)}</b>.`}</p>
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
  let bolOk = false;
  RM.onStatus = () => {
    const ok = RM.status === 'ok';
    if (ok && !bolOk && fr.contentWindow) fr.contentWindow.postMessage({rmSpojene: 1}, '*');
    bolOk = ok;
    const st = document.getElementById('rmBzStav');
    if (st) st.innerHTML = `${RM.status === 'ok' ? '🟢' : RM.status === 'nomod' ? '🟠' : '🟡'} ${h(stavText())} · ${RM.off ? 'bez internetu' : `hra <b>${h(RM.room)}</b>`}`;
    if (RM.off) parUkaz();
    const w = document.getElementById('rmWaitStav');
    if (w) w.textContent = RM.status === 'ok' ? 'Čakáme, kým moderátor spustí hru. Potom tu uvidíš tabuľu a otázky, tlačidlo máš dole.' : stavText();
  };
  // bez internetu: kým nie je spojenie, hráč skenuje kód moderátora a ukazuje mu svoj
  let parUkaz = () => {};
  if (RM.off) {
    const par = document.createElement('div');
    par.id = 'rmPar'; par.className = 'rm-over';
    par.innerHTML = `<div class="rm-in">
      <h3>📶 Pripojenie bez internetu</h3>
      <p class="hint">Buď na <b>tej istej Wi-Fi</b> ako moderátor (napr. na hotspote z jeho mobilu). Mobilné dáta môžu byť vypnuté.</p>
      <p class="rm-qrstav bad" id="rmParErr"></p>
      <div id="rmPar1" class="rm-krokbox"><p class="rm-krok"><b>1.</b> Moderátor ťukne <b>Pripojiť hráča bez internetu</b>. Naskenuj kód z jeho mobilu:</p>
        <div class="rm-cam big"><video muted playsinline></video></div>
        <details class="rm-vloz"><summary>Kamera nejde?</summary>
          <p class="hint">Odfoť kód moderátora inou aplikáciou (napr. Google Lens), skopíruj text a vlož ho sem.</p>
          <textarea id="rmParText" rows="3" spellcheck="false" autocapitalize="off"></textarea>
          <button class="btn" type="button" id="rmParVloz">Pokračovať</button></details></div>
      <div id="rmPar2" class="rm-krokbox" hidden><p class="rm-krok"><b>2.</b> Ukáž tento kód moderátorovi, nech ho naskenuje:</p>
        <div class="rm-qrkod" id="rmParKod"></div>
        <p class="hint" id="rmParCaka"></p>
        <button class="lnk" type="button" id="rmParZnova">Naskenovať kód moderátora znova</button></div>
      <div class="rm-row"><span>Hráč: <b>${h(RM.name)}</b></span><button class="lnk" type="button" id="rmParOdist">Odísť</button></div></div>`;
    document.body.appendChild(par);
    let stop = null, busy = false, posledny = '', cakaT = 0;
    const chyba = t => { par.querySelector('#rmParErr').textContent = t || ''; };
    const krok = n => { par.querySelector('#rmPar1').hidden = n !== 1; par.querySelector('#rmPar2').hidden = n !== 2; };
    const zastav = () => { if (stop) { stop(); stop = null; } };
    const spracuj = async txt => {
      txt = String(txt || '').trim();
      if (!txt || busy || txt === posledny) return;
      posledny = txt; busy = true;
      try {
        const odp = await RM.qrOdpovedz(txt);
        zastav(); chyba('');
        par.querySelector('#rmParKod').innerHTML = QR.svg(odp);
        par.querySelector('#rmParCaka').textContent = 'Čakám na spojenie…';
        krok(2);
        clearTimeout(cakaT);
        cakaT = setTimeout(() => { if (RM.status !== 'ok') par.querySelector('#rmParCaka').textContent = 'Stále čakám… Moderátor musí naskenovať tento kód. Ak to nejde, skontrolujte, či ste na tej istej Wi-Fi, a skúste znova.'; }, 30000);
      } catch (e) { chyba(e.message); }
      busy = false;
    };
    const skenuj = async () => {
      krok(1); posledny = '';
      if (stop) return;
      try { stop = await QR.skener(par.querySelector('video'), spracuj); }
      catch (e) { chyba('Kamera nejde – povoľ ju prehliadaču, alebo použi „Kamera nejde?“ nižšie.'); par.querySelector('.rm-vloz').open = true; }
      if (par.hidden) zastav();
    };
    par.querySelector('#rmParVloz').onclick = () => { const t = par.querySelector('#rmParText'); posledny = ''; spracuj(t.value); t.value = ''; };
    par.querySelector('#rmParZnova').onclick = () => { chyba(''); skenuj(); };
    const odist2 = par.querySelector('#rmParOdist');
    odist2.onclick = () => potvrd(odist2, 'Naozaj odísť?', () => RM.nastav(null));
    let zobrazeny = null;
    parUkaz = () => {
      const ok = RM.status === 'ok';
      if (ok === zobrazeny && RM.status !== 'qr-zlyhalo') return;
      if (ok) { zobrazeny = true; par.hidden = true; zastav(); clearTimeout(cakaT); return; }
      if (RM.status === 'qr-zlyhalo') { chyba('Spojenie sa nepodarilo. Ste na tej istej Wi-Fi? Naskenuj nový kód od moderátora.'); RM.status = 'qr'; skenuj(); }
      if (zobrazeny === false) return;
      zobrazeny = false; par.hidden = false;
      if (RM.qrPreruseny) chyba('Spojenie s moderátorom sa prerušilo – naskenuj znova jeho kód.');
      if (RM.ponuka) { const t = RM.ponuka; RM.ponuka = null; krok(1); spracuj(t).then(() => { if (par.querySelector('#rmPar2').hidden) skenuj(); }); }
      else skenuj();
    };
  }
  RM.onStatus();
  render(true);
})();
