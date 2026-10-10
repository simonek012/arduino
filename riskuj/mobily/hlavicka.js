/* ================= RISKUJ LEN NA MOBILOCH =================
   Žiadny počítač ani server: mobil moderátora robí to, čo inak robí server.ps1 (prihlasovanie,
   tlačidlá, žetóny, finále) a hráči sa naň pripoja cez internet (PeerJS – priame spojenie
   medzi mobilmi, verejný server PeerJS slúži len na to, aby sa mobily našli).
   Tento skript beží ako prvý – podstrčí hre falošný fetch('/api/…') a BroadcastChannel,
   takže zvyšok hry (tv.html) netreba meniť. */
(function () {
  'use strict';
  const RM = window.RM = {mode: null, room: '', name: '', status: 'off', peersN: 0, onStatus: null, VERZIA: '__VERZIA__'};
  const KODY = 'ABCDEFGHJKLMNPRSTUVXYZ';
  RM.novyKod = () => Array.from({length: 4}, () => KODY[Math.floor(Math.random() * KODY.length)]).join('');

  // voľba roly prežije obnovenie stránky – v adrese (#rm=…) aj v sessionStorage
  let cfg = null;
  try { const m = /[#&]rm=([^&]+)/.exec(location.hash); if (m) cfg = JSON.parse(decodeURIComponent(m[1])); } catch (e) {}
  if (!cfg) try { cfg = JSON.parse(sessionStorage.getItem('rm-cfg') || 'null'); } catch (e) {}
  if (!cfg || !/^(mod|hrac)$/.test(cfg.mode) || !(cfg.off && cfg.mode === 'hrac' || /^[A-Z]{4}$/.test(cfg.room || ''))) cfg = null;
  // rola sa obnoví len pri obnovení rozohranej stránky – keď sa súbor otvorí znova neskôr (napr. ďalší deň),
  // začína sa výberom Som hráč / Som moderátor (inak by mobil hráča mohol ostať „moderátorom“ s vlastnou hrou)
  let zije = 0;
  try { zije = +sessionStorage.getItem('rm-zije') || 0; } catch (e) {}
  const nav = ((performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {}).type;
  if (cfg && Date.now() - zije > 15 * 60e3 && !(nav === 'reload' && Date.now() - zije < 6 * 3600e3)) {
    cfg = null;
    try { sessionStorage.removeItem('rm-cfg'); history.replaceState(null, '', location.href.split('#')[0]); } catch (e) {}
  }
  // hneď od začiatku (kým sa načíta celá stránka) neukazovať návod pre počítač a TV
  document.documentElement.classList.add('rm', 'rm-boot', cfg ? 'rm-' + cfg.mode : 'rm-start');
  RM.nastav = c => {
    const s = c ? JSON.stringify(c) : '';
    try { if (c) sessionStorage.setItem('rm-cfg', s); else sessionStorage.removeItem('rm-cfg'); } catch (e) {}
    const base = location.href.split('#')[0];
    if (c && !RM.mode) {
      // prvá voľba roly: stránka sa znova nenačítava (je veľká a stiahnutý súbor sa niekedy znova otvoriť nedá)
      const z = Object.assign({}, c); delete z.ponuka;
      try { history.replaceState(null, '', base + '#rm=' + encodeURIComponent(JSON.stringify(z))); } catch (e) {}
      RM.spusti(c);
      if (RM.poVolbe) RM.poVolbe();
      return;
    }
    if (c) location.replace(base + '#rm=' + encodeURIComponent(s)); else location.replace(base + '#');
    location.reload();
  };
  /* ---------- bez internetu: mobily sa spoja priamo cez Wi-Fi (WebRTC) a údaje na spojenie
     si vymenia cez QR kódy – moderátor ukáže kód hráčovi, hráč ukáže svoj kód moderátorovi ---------- */
  const QR_PFX = 'RISKUJ1';
  const b64u = b => btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  // z popisu spojenia (SDP) stačí pár údajov – kód je potom malý a ľahko sa naskenuje
  RM.sigZabal = (druh, id, sdp) => {
    const g = re => (re.exec(sdp) || [])[1] || '';
    const fp = g(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/).split(':').map(x => parseInt(x, 16));
    const kand = [];
    sdp.replace(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gi, (m, adr, port) => {
      if (!adr.includes(':') && !kand.includes(adr + ':' + port)) kand.push(adr + ':' + port);   // IPv6 netreba
      return m;
    });
    const setup = {actpass: 'x', active: 'a', passive: 'p'}[g(/a=setup:(\w+)/)] || 'x';
    return {txt: [QR_PFX, druh, id, g(/a=ice-ufrag:(\S+)/), g(/a=ice-pwd:(\S+)/), b64u(fp), setup, kand.slice(0, 6).join(',')].join('|'), kand: kand.length};
  };
  RM.sigRozbal = txt => {
    const p = String(txt || '').trim().split('|');
    if (p[0] !== QR_PFX || p.length < 8 || !/^[OA]$/.test(p[1])) return null;
    const [, druh, id, uf, pw, fpB, st, kd] = p;
    let fp;
    try { fp = unb64u(fpB).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':'); } catch (e) { return null; }
    const l = ['v=0', 'o=- ' + Math.floor(Math.random() * 1e9) + ' 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
      'a=msid-semantic: WMS', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0'];
    (kd ? kd.split(',') : []).forEach((k, i) => {
      const j = k.lastIndexOf(':');
      if (j > 0) l.push(`a=candidate:${i + 1} 1 udp ${2122260223 - i} ${k.slice(0, j)} ${k.slice(j + 1)} typ host generation 0`);
    });
    l.push('a=ice-ufrag:' + uf, 'a=ice-pwd:' + pw, 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + fp,
      'a=setup:' + ({x: 'actpass', a: 'active', p: 'passive'}[st] || 'actpass'), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '');
    return {druh, id, sdp: {type: druh === 'O' ? 'offer' : 'answer', sdp: l.join('\r\n')}};
  };
  const zber = pc => new Promise(res => {          // počká, kým mobil zistí svoje adresy v sieti
    if (pc.iceGatheringState === 'complete') { res(); return; }
    const t = setTimeout(res, 4000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
  const BEZ_SIETE = 'Mobil nie je na žiadnej Wi-Fi. Pripoj sa na Wi-Fi alebo hotspot (všetci na ten istý).';
  // dátový kanál vyzerá pre zvyšok kódu rovnako ako spojenie z PeerJS (open, send, close)
  function Kanal(pc, dc, naData, naKoniec) {
    let hotovo = false;
    const w = {
      qr: true,
      get open() { return !hotovo && dc.readyState === 'open'; },
      send(d) { dc.send(JSON.stringify(d)); },
      close() { if (hotovo) return; hotovo = true; try { dc.close(); } catch (e) {} try { pc.close(); } catch (e) {} naKoniec(w); }
    };
    dc.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch (x) { return; } if (!hotovo) naData(w, d); };
    dc.onclose = () => w.close();
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') w.close(); });
    return w;
  }

  const up = () => { try { RM.onStatus && RM.onStatus(); } catch (e) {} };
  // kým si mobil nevyberie rolu, nikam sa nepripája
  RM.api = () => Promise.reject(new Error('offline'));
  RM.bcOut = () => {};
  RM.isOpen = () => false;
  const ziva = () => { try { sessionStorage.setItem('rm-zije', String(Date.now())); } catch (e) {} };

  /* ---------- server v mobile moderátora (to isté, čo server.ps1) ---------- */
  function Server() {
    const KEY = 'rm-hraci';
    let players = [];
    try { players = (JSON.parse(localStorage.getItem(KEY)) || []).filter(p => p && p.id && p.name); } catch (e) {}
    let buzzes = [], armed = false, locked = [], epoch = 0, buzzN = 0, turn = '';
    let finalStage = 'off', finalMax = {}, finalBets = {}, finalAnswers = {}, zet = {kto: ''}, tokReq = [], tokN = 0;
    const lastSeen = {};
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(players.map(p => ({id: p.id, name: p.name})))); } catch (e) {} };
    const online = id => !!lastSeen[id] && Date.now() - lastSeen[id] < 6000;
    const find = id => players.find(p => p.id === id) || null;
    const seen = id => { if (find(id)) lastSeen[id] = Date.now(); };
    const q = (path, name) => { const m = new RegExp('[?&]' + name + '=([^&]*)').exec(path); return m ? decodeURIComponent(m[1]) : ''; };
    const state = () => {
      const sent = {};
      players.forEach(p => { sent[p.id] = {bet: p.id in finalBets, answer: p.id in finalAnswers}; });
      return {armed, epoch, buzzes: buzzes.map(b => ({id: b.id, name: b.name, n: b.n})), locked: locked.slice(), turn,
        players: players.map(p => ({id: p.id, name: p.name, online: online(p.id)})),
        final: {stage: finalStage, max: Object.assign({}, finalMax), sent}, zet, treq: tokReq.slice()};
    };
    this.hraci = () => players.map(p => ({id: p.id, name: p.name, online: online(p.id), v: p.v || ''}));
    this.handle = function (path, data) {
      data = data || {};
      switch (path.split('?')[0]) {
        case 'info': return {ips: [], port: 0, public: ''};
        case 'state': seen(q(path, 'id')); return Object.assign(state(), {ver: RM.VERZIA});
        case 'join': {
          const name = String(data.name || '').trim().slice(0, 16) || 'Hráč';
          let p = data.id ? find(String(data.id)) : null;
          if (p) p.name = name;                                       // ten istý mobil, prípadne nové meno
          else p = players.find(x => x.name.toLowerCase() === name.toLowerCase()) || null;   // znovupripojenie
          if (!p) { p = {id: Math.random().toString(36).slice(2, 12), name}; players.push(p); }
          p.v = String(data.v || '');                                  // verzia súboru v mobile hráča
          lastSeen[p.id] = Date.now(); save(); up();
          return {id: p.id, name: p.name};
        }
        case 'buzz': {
          const id = String(data.id || ''), p = find(id);
          let ok = false;
          if (p && armed && !locked.includes(id) && !buzzes.some(b => b.id === id)) { buzzes.push({id, name: p.name, n: ++buzzN}); ok = true; }
          seen(id);
          return {ok, order: buzzes.length};
        }
        case 'arm': armed = true; buzzes = []; locked = (data.locked || []).filter(Boolean).map(String); epoch++; turn = ''; return {epoch};
        case 'unbuzz': { const ids = (data.ids || []).map(String); buzzes = buzzes.filter(b => !ids.includes(b.id)); return {ok: true}; }
        case 'lock': locked = (data.locked || []).filter(Boolean).map(String); return {ok: true};
        case 'turn': turn = String(data.id || ''); return {ok: true};
        case 'disarm': armed = false; return {ok: true};
        case 'idle': armed = false; buzzes = []; locked = []; turn = ''; return {ok: true};
        case 'reset': players = []; buzzes = []; armed = false; locked = []; save(); up(); return {ok: true};
        case 'zetony': zet = data && data.kto !== undefined ? data : {kto: ''}; return {ok: true};
        case 'token': {
          const id = String(data.id || ''); let ok = false;
          if (find(id) && zet.kto && zet.kto === id && (data.kind === 'stit' || data.kind === 'prihr')) {
            tokReq.push({n: ++tokN, id, kind: data.kind, to: parseInt(data.to, 10) || 0, k: String(data.k || '')});
            while (tokReq.length > 20) tokReq.shift();
            seen(id); ok = true;
          }
          return {ok};
        }
        case 'final': {
          const stage = String(data.stage || '');
          if (stage === 'bet' && finalStage !== 'bet') { finalBets = {}; finalAnswers = {}; }
          finalMax = {};
          if (data.max) Object.keys(data.max).forEach(k => { finalMax[k] = parseInt(data.max[k], 10) || 0; });
          finalStage = ['bet', 'answer', 'closed'].includes(stage) ? stage : 'off';
          if (finalStage === 'off') { finalBets = {}; finalAnswers = {}; }
          return {ok: true};
        }
        case 'finalsubmit': {
          const id = String(data.id || ''); let ok = false;
          if (find(id) && id in finalMax) {
            if (data.kind === 'bet' && finalStage === 'bet') {
              const v = parseInt(data.value, 10) || 0;
              finalBets[id] = Math.max(0, Math.min(finalMax[id], v)); ok = true;
            } else if (data.kind === 'answer' && finalStage === 'answer') {
              finalAnswers[id] = String(data.value || '').trim().slice(0, 120); ok = true;
            }
            seen(id);
          }
          return {ok, stage: finalStage};
        }
        case 'finaldata': return {stage: finalStage, bets: Object.assign({}, finalBets), answers: Object.assign({}, finalAnswers)};
      }
      return undefined;                    // neznáma adresa → 404
    };
  }

  /* ---------- hra volá fetch('/api/…') – odpovie server v mobile moderátora ---------- */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opt) {
    const m = /^\/api\/(.*)$/.exec(String(url && url.url || url));
    if (!m) return realFetch(url, opt);
    let body;
    try { body = opt && opt.body ? JSON.parse(opt.body) : undefined; } catch (e) {}
    return RM.api(m[1], body).then(d => d === undefined
      ? new Response('Nenájdené', {status: 404})
      : new Response(JSON.stringify(d), {status: 200, headers: {'Content-Type': 'application/json'}}));
  };

  /* ---------- „druhé okno“ hry (TV) je teraz mobil hráča – správy idú cez sieť ---------- */
  window.BroadcastChannel = function () { RM.bc = this; this.onmessage = null; };
  window.BroadcastChannel.prototype.postMessage = function (m) { RM.bcOut(m); };
  window.BroadcastChannel.prototype.close = function () {};
  RM.bcIn = m => {
    const bc = RM.bc; if (!bc || !bc.onmessage || !m) return;
    if (RM.mode === 'hrac' && window.RM_PRIJMI && window.RM_PRIJMI(m)) return;
    try { bc.onmessage({data: m}); } catch (e) { console.error(e); }
  };

  /* ---------- spojenie (PeerJS) ---------- */
  const u = new URLSearchParams(location.search);
  const PJ = {debug: 0, config: {iceServers: [
    {urls: 'stun:stun.l.google.com:19302'}, {urls: 'stun:stun1.l.google.com:19302'},
    {urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject'}
  ]}};
  if (u.get('pjhost')) Object.assign(PJ, {host: u.get('pjhost'), port: +u.get('pjport') || 9000, path: u.get('pjpath') || '/', secure: u.get('pjsecure') === '1'});
  const peerId = room => 'riskuj-sk-mobily-' + room.toLowerCase();
  const NET_ERR = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

  // spustí spojenie podľa zvolenej roly (pri obnovení stránky hneď, inak po voľbe na úvode)
  RM.spusti = cfg => {
    if (RM.mode) return;
    Object.assign(RM, cfg);
    // naskenovaný kód moderátora (bez internetu) sa použije len raz – po ďalšom obnovení stránky už nie
    if (cfg.ponuka) {
      const c = Object.assign({}, cfg); delete c.ponuka;
      try { sessionStorage.setItem('rm-cfg', JSON.stringify(c)); history.replaceState(null, '', location.href.split('#')[0] + '#rm=' + encodeURIComponent(JSON.stringify(c))); } catch (e) {}
    }
    window.RM_HRAC = cfg.mode === 'hrac';
    window.RM_ROLE = cfg.mode === 'hrac' ? 'tv' : 'mod';
    ziva(); setInterval(ziva, 10000);
    try { sessionStorage.setItem('riskuj-role', window.RM_ROLE); } catch (e) {}
    if (RM.mode === 'mod') {
      RM.server = new Server();
      RM.api = (path, body) => { try { return Promise.resolve(RM.server.handle(path, body)); } catch (e) { return Promise.reject(e); } };
      const conns = new Set();
      let peer = null, stateMsg = null, stateT = 0;
      const send = (c, d) => { try { if (c.open) c.send(d); } catch (e) {} };
      const all = d => conns.forEach(c => send(c, d));
      const count = () => { RM.peersN = conns.size; up(); };
      // stav hry sa posiela najviac ~12× za sekundu (pri rýchlych zmenách len ten posledný)
      RM.bcOut = m => {
        if (m && m.t === 'state') {
          stateMsg = m;
          if (!stateT) stateT = setTimeout(() => { stateT = 0; const s = stateMsg; stateMsg = null; if (s) all({k: 'bc', m: s}); }, 80);
          return;
        }
        all({k: 'bc', m});
      };
      function onData(c, d) {
        if (!d || typeof d !== 'object') return;
        if (d.k === 'api') {
          let res, ok = true;
          try { res = RM.server.handle(String(d.path || ''), d.body); } catch (e) { ok = false; }
          send(c, {k: 'apir', rid: d.rid, ok: ok && res !== undefined, data: res === undefined ? null : res});
        } else if (d.k === 'bc') RM.bcIn(d.m);
      }
      let retryT = 0;
      const retry = (ms, fn) => { clearTimeout(retryT); retryT = setTimeout(fn, ms); };
      function create() {
        RM.status = 'connecting'; up();
        try { peer = new Peer(peerId(RM.room), PJ); } catch (e) { RM.status = 'error'; up(); retry(4000, create); return; }
        peer.on('open', () => { RM.status = 'ok'; up(); });
        peer.on('connection', c => {
          c.on('open', () => { conns.add(c); count(); });
          c.on('data', d => onData(c, d));
          c.on('close', () => { conns.delete(c); count(); });
          c.on('error', () => { conns.delete(c); count(); });
        });
        // spojenie so serverom PeerJS sa stratilo – hráči, čo už sú pripojení, hrajú ďalej
        peer.on('disconnected', () => { RM.status = 'reconnecting'; up(); retry(2000, () => { if (peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} } }); });
        peer.on('error', e => {
          if (e.type === 'unavailable-id') { RM.status = 'taken'; up(); try { peer.destroy(); } catch (x) {} retry(4000, create); }
          else if (NET_ERR.includes(e.type) || e.type === 'browser-incompatible') {
            RM.status = 'reconnecting'; up();
            retry(3000, () => { if (!peer || peer.destroyed) create(); else if (peer.disconnected) { try { peer.reconnect(); } catch (x) { try { peer.destroy(); } catch (y) {} create(); } } });
          }
        });
      }
      RM.pripojeni = () => conns.size;
      // hráč bez internetu: moderátor ukáže ponuku (QR), hráč odpovie svojím QR kódom
      const cakaju = new Map();
      RM.qrPonuka = async () => {
        const pc = new RTCPeerConnection({iceServers: []});
        const dc = pc.createDataChannel('riskuj', {ordered: true});
        const id = Math.random().toString(36).slice(2, 8);
        await pc.setLocalDescription(await pc.createOffer());
        await zber(pc);
        const z = RM.sigZabal('O', id, pc.localDescription.sdp);
        if (!z.kand) { pc.close(); throw new Error(BEZ_SIETE); }
        cakaju.set(id, pc);
        while (cakaju.size > 8) { const [k, v] = cakaju.entries().next().value; try { v.close(); } catch (e) {} cakaju.delete(k); }
        dc.onopen = () => {
          cakaju.delete(id);
          const w = Kanal(pc, dc, onData, w => { conns.delete(w); count(); });
          conns.add(w); count();
          if (RM.onQr) RM.onQr('ok', id);
        };
        pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' && cakaju.has(id)) { cakaju.delete(id); pc.close(); if (RM.onQr) RM.onQr('chyba', id); } });
        return z.txt;
      };
      RM.qrPrijmi = async txt => {
        const s = RM.sigRozbal(txt);
        if (!s) throw new Error('Toto nie je kód z hry Riskuj.');
        if (s.druh !== 'A') throw new Error('To je kód moderátora – naskenuj kód z mobilu hráča.');
        const pc = cakaju.get(s.id);
        if (!pc || pc.signalingState !== 'have-local-offer') throw new Error('Tento kód je už použitý alebo starý – hráč nech naskenuje nový kód.');
        await pc.setRemoteDescription(s.sdp);
        return s.id;
      };
      create();
    } else {
      let peer = null, conn = null, lastIn = 0, rid = 0, retryT = 0;
      const pend = new Map();
      const retry = (ms, fn) => { clearTimeout(retryT); retryT = setTimeout(fn, ms); };
      const isOpen = () => !!(conn && conn.open);
      RM.api = (path, body) => new Promise((res, rej) => {
        if (path === 'join') body = Object.assign({}, body, {v: RM.VERZIA});   // moderátor tak zistí starý súbor
        if (!isOpen()) { rej(new Error('offline')); return; }
        const id = ++rid;
        const tm = setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout')); } }, 5000);
        pend.set(id, {res: d => { clearTimeout(tm); res(d); }, rej: e => { clearTimeout(tm); rej(e); }});
        try { conn.send({k: 'api', rid: id, path, body}); } catch (e) { pend.delete(id); clearTimeout(tm); rej(e); }
      });
      function prijmi(d) {
        if (!d) return;
        lastIn = Date.now();
        if (d.k === 'apir') { const p = pend.get(d.rid); if (p) { pend.delete(d.rid); if (d.ok) p.res(d.data); else p.rej(new Error('api')); } }
        else if (d.k === 'bc') RM.bcIn(d.m);
      }
      // hráč posiela moderátorovi len „ahoj“ a „žijem“ – stav hry riadi výhradne moderátor
      RM.bcOut = m => { if (m && (m.t === 'hello' || m.t === 'ping') && isOpen()) { try { conn.send({k: 'bc', m}); } catch (e) {} } };
      function connect() {
        if (!peer || peer.destroyed) { create(); return; }
        if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} retry(2500, connect); return; }
        if (conn) { try { conn.close(); } catch (e) {} }
        RM.status = RM.status === 'nomod' ? 'nomod' : 'connecting'; up();
        const c = conn = peer.connect(peerId(RM.room), {reliable: true});
        const tm = setTimeout(() => { if (c === conn && !c.open) { try { c.close(); } catch (e) {} conn = null; connect(); } }, 12000);
        c.on('open', () => {
          clearTimeout(tm); if (c !== conn) return;
          RM.status = 'ok'; lastIn = Date.now(); up();
          RM.bcOut({t: 'hello'});
        });
        c.on('data', d => { if (c === conn) prijmi(d); });
        const zavrene = () => { clearTimeout(tm); if (c !== conn) return; conn = null; if (RM.status === 'ok') RM.status = 'connecting'; up(); retry(1500, connect); };
        c.on('close', zavrene);
        c.on('error', zavrene);
      }
      function create() {
        RM.status = 'connecting'; up();
        try { peer = new Peer(PJ); } catch (e) { RM.status = 'error'; up(); retry(4000, create); return; }
        peer.on('open', () => connect());
        peer.on('disconnected', () => retry(2000, () => { if (peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} } }));
        peer.on('error', e => {
          if (e.type === 'peer-unavailable') { RM.status = 'nomod'; up(); conn = null; retry(2500, connect); }
          else if (NET_ERR.includes(e.type)) { if (RM.status !== 'ok') { RM.status = 'connecting'; up(); } retry(3000, () => { if (!peer || peer.destroyed) create(); else if (peer.disconnected) { try { peer.reconnect(); } catch (x) {} retry(2500, connect); } else if (!isOpen()) connect(); }); }
          else if (e.type === 'unavailable-id' || e.type === 'invalid-id') { try { peer.destroy(); } catch (x) {} retry(2000, create); }
        });
        // peer sa reconnectne sám, no keď je spojenie s moderátorom ticho (moderátor posiela znamenie každé 2 s), pripojíme sa znova
      }
      RM.isOpen = isOpen;
      if (RM.off) {
        // bez internetu: hráč naskenuje kód moderátora a ukáže mu svoj
        let pc = null;
        RM.status = 'qr';
        RM.qrOdpovedz = async txt => {
          const s = RM.sigRozbal(txt);
          if (!s) throw new Error('Toto nie je kód z hry Riskuj.');
          if (s.druh !== 'O') throw new Error('To je kód iného hráča – naskenuj kód z mobilu moderátora.');
          if (pc) { try { pc.close(); } catch (e) {} }
          const p = pc = new RTCPeerConnection({iceServers: []});
          p.ondatachannel = e => {
            const dc = e.channel;
            const otvor = () => {
              if (p !== pc) return;
              if (conn) conn.close();
              conn = Kanal(p, dc, (w, d) => { if (w === conn) prijmi(d); }, w => { if (w !== conn) return; conn = null; RM.status = 'qr'; RM.qrPreruseny = true; up(); });
              RM.status = 'ok'; lastIn = Date.now(); up();
              RM.bcOut({t: 'hello'});
            };
            if (dc.readyState === 'open') otvor(); else dc.onopen = otvor;
          };
          p.addEventListener('connectionstatechange', () => { if (p === pc && p.connectionState === 'failed' && RM.status !== 'ok') { RM.status = 'qr-zlyhalo'; up(); } });
          await p.setRemoteDescription(s.sdp);
          await p.setLocalDescription(await p.createAnswer());
          await zber(p);
          const z = RM.sigZabal('A', s.id, p.localDescription.sdp);
          if (!z.kand) { p.close(); throw new Error(BEZ_SIETE); }
          RM.status = 'qr-caka'; up();
          return z.txt;
        };
        setInterval(() => { if (isOpen() && Date.now() - lastIn > 15000) conn.close(); }, 2000);
      } else {
        setInterval(() => { if (isOpen() && Date.now() - lastIn > 9000) { try { conn.close(); } catch (e) {} conn = null; RM.status = 'connecting'; up(); connect(); } }, 2000);
        create();
      }
    }
  };
  if (cfg) RM.spusti(cfg);
})();
