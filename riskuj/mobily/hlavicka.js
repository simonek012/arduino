/* ================= RISKUJ LEN NA MOBILOCH =================
   Žiadny počítač ani server: mobil moderátora robí to, čo inak robí server.ps1 (prihlasovanie,
   tlačidlá, žetóny, finále) a hráči sa naň pripoja cez internet (PeerJS – priame spojenie
   medzi mobilmi, verejný server PeerJS slúži len na to, aby sa mobily našli).
   Tento skript beží ako prvý – podstrčí hre falošný fetch('/api/…') a BroadcastChannel,
   takže zvyšok hry (tv.html) netreba meniť. */
(function () {
  'use strict';
  const RM = window.RM = {mode: null, room: '', name: '', status: 'off', peersN: 0, onStatus: null};
  const KODY = 'ABCDEFGHJKLMNPRSTUVXYZ';
  RM.novyKod = () => Array.from({length: 4}, () => KODY[Math.floor(Math.random() * KODY.length)]).join('');

  // voľba roly prežije obnovenie stránky – v adrese (#rm=…) aj v sessionStorage
  let cfg = null;
  try { const m = /[#&]rm=([^&]+)/.exec(location.hash); if (m) cfg = JSON.parse(decodeURIComponent(m[1])); } catch (e) {}
  if (!cfg) try { cfg = JSON.parse(sessionStorage.getItem('rm-cfg') || 'null'); } catch (e) {}
  if (!cfg || !/^(mod|hrac)$/.test(cfg.mode) || !/^[A-Z]{4}$/.test(cfg.room || '')) cfg = null;
  // hneď od začiatku (kým sa načíta celá stránka) neukazovať návod pre počítač a TV
  document.documentElement.classList.add('rm', 'rm-boot', cfg ? 'rm-' + cfg.mode : 'rm-start');
  RM.nastav = c => {
    const s = c ? JSON.stringify(c) : '';
    try { if (c) sessionStorage.setItem('rm-cfg', s); else sessionStorage.removeItem('rm-cfg'); } catch (e) {}
    const base = location.href.split('#')[0];
    if (c) location.replace(base + '#rm=' + encodeURIComponent(s)); else location.replace(base + '#');
    location.reload();
  };
  if (!cfg) return;                       // úvodnú voľbu (moderátor / hráč) ukáže koniec stránky
  Object.assign(RM, cfg);
  window.RM_HRAC = cfg.mode === 'hrac';
  window.RM_ROLE = cfg.mode === 'hrac' ? 'tv' : 'mod';
  try { sessionStorage.setItem('riskuj-role', window.RM_ROLE); } catch (e) {}
  const up = () => { try { RM.onStatus && RM.onStatus(); } catch (e) {} };

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
    this.hraci = () => players.map(p => ({id: p.id, name: p.name, online: online(p.id)}));
    this.handle = function (path, data) {
      data = data || {};
      switch (path.split('?')[0]) {
        case 'info': return {ips: [], port: 0, public: ''};
        case 'state': seen(q(path, 'id')); return state();
        case 'join': {
          const name = String(data.name || '').trim().slice(0, 16) || 'Hráč';
          let p = data.id ? find(String(data.id)) : null;
          if (p) p.name = name;                                       // ten istý mobil, prípadne nové meno
          else p = players.find(x => x.name.toLowerCase() === name.toLowerCase()) || null;   // znovupripojenie
          if (!p) { p = {id: Math.random().toString(36).slice(2, 12), name}; players.push(p); }
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
    create();
  } else {
    let peer = null, conn = null, lastIn = 0, rid = 0, retryT = 0;
    const pend = new Map();
    const retry = (ms, fn) => { clearTimeout(retryT); retryT = setTimeout(fn, ms); };
    const isOpen = () => !!(conn && conn.open);
    RM.api = (path, body) => new Promise((res, rej) => {
      if (!isOpen()) { rej(new Error('offline')); return; }
      const id = ++rid;
      const tm = setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout')); } }, 5000);
      pend.set(id, {res: d => { clearTimeout(tm); res(d); }, rej: e => { clearTimeout(tm); rej(e); }});
      try { conn.send({k: 'api', rid: id, path, body}); } catch (e) { pend.delete(id); clearTimeout(tm); rej(e); }
    });
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
      c.on('data', d => {
        if (c !== conn || !d) return;
        lastIn = Date.now();
        if (d.k === 'apir') { const p = pend.get(d.rid); if (p) { pend.delete(d.rid); if (d.ok) p.res(d.data); else p.rej(new Error('api')); } }
        else if (d.k === 'bc') RM.bcIn(d.m);
      });
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
    setInterval(() => { if (isOpen() && Date.now() - lastIn > 9000) { try { conn.close(); } catch (e) {} conn = null; RM.status = 'connecting'; up(); connect(); } }, 2000);
    RM.isOpen = isOpen;
    create();
  }
})();
