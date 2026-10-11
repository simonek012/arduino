#!/usr/bin/env python3
"""Zostaví riskuj-mobily.html – Riskuj len na mobiloch (moderátor + hráči, bez počítača).

Vstup: tv.html (celá hra), mobil.html (tlačidlo hráča) a súbory v priečinku mobily/.
Výstup: jeden súbor, ktorý si všetci otvoria v prehliadači. Mobil moderátora robí to, čo inak
server.ps1, a mobily sa spoja cez PeerJS. Po úprave tv.html stačí spustiť:  python3 build_mobily.py
"""
import json
import pathlib
import re

D = pathlib.Path(__file__).resolve().parent
M = D / 'mobily'
OUT = D / 'riskuj-mobily.html'


def rep(s, a, b, n=1):
    if s.count(a) != n:
        raise SystemExit(f'Nenašiel som (alebo je tam {s.count(a)}×, čakal som {n}×): {a[:80]}')
    return s.replace(a, b)


def no_close_tag(name, s):
    if re.search(r'</script', s, re.I):
        raise SystemExit(f'{name} obsahuje </script – rozbilo by to stránku')
    return s


tv = (D / 'tv.html').read_text('utf-8')
# chyby počas behu sa ukážu na obrazovke (dá sa poslať snímka) – skript beží ako prvý
CHYBY = '''<script>window.RM_CHYBY = [];
window.addEventListener('error', function (e) {
  var t = (e.message || 'chyba') + (e.lineno ? ' (riadok ' + e.lineno + ')' : '');
  RM_CHYBY.push(t);
  var f = document.getElementById('rmFatalErr'); if (f) f.textContent = RM_CHYBY.join(' | ');
  if (!document.body) return;
  var b = document.getElementById('rmChyba');
  if (!b) { b = document.createElement('div'); b.id = 'rmChyba'; b.onclick = function () { b.remove(); }; document.body.appendChild(b); }
  b.textContent = '⚠ Chyba: ' + t + ' (ťukni pre skrytie)';
});</script>
'''
FATAL = '''<div id="rmFatal"><h2>Riskuj sa nespustil</h2>
<p>Otvor tento súbor v prehliadači <b>Chrome</b> – nie v náhľade WhatsAppu, Messengera, Teams ani v prehliadači súborov.</p>
<p>Alebo otvor hru z webu: <b>simonek012.github.io/arduino/riskuj/riskuj-mobily.html</b></p>
<p id="rmFatalErr"></p></div>
'''
mob = (D / 'mobil.html').read_text('utf-8')
peerjs = no_close_tag('peerjs.min.js', (M / 'peerjs.min.js').read_text('utf-8'))
qrgen = no_close_tag('qrcode.min.js', (M / 'qrcode.min.js').read_text('utf-8'))
jsqr = no_close_tag('jsqr.min.js', (M / 'jsqr.min.js').read_text('utf-8'))
hlavicka = no_close_tag('hlavicka.js', (M / 'hlavicka.js').read_text('utf-8'))
# verzia = číslo v mobily/verzia.txt (pri každom novom súbore pre hráčov o 1 vyššie) – je v názve súboru aj na obrazovke
VERZIA = (M / 'verzia.txt').read_text('utf-8').strip()
hlavicka = hlavicka.replace("'__VERZIA__'", repr(VERZIA))
koniec = no_close_tag('koniec.js', (M / 'koniec.js').read_text('utf-8'))
css = (M / 'mobily.css').read_text('utf-8')

# ---------- tlačidlo hráča (mobil.html) beží v rámčeku a so serverom hovorí cez rodiča ----------
mob = re.sub(r"function api\(path, body\) \{\n.*?\n\}\n", """let rmN = 0; const rmPend = {};
window.addEventListener('message', e => {
  const d = e.data && e.data.rmApiRes; if (!d || !rmPend[d.rid]) return;
  const p = rmPend[d.rid]; delete rmPend[d.rid];
  if (d.ok) p.res(d.data); else p.rej(new Error('api'));
});
function api(path, body) {   // požiadavku vybaví mobil moderátora (cez stránku okolo rámčeka)
  return new Promise((res, rej) => {
    const rid = ++rmN; rmPend[rid] = {res, rej};
    parent.postMessage({rmApi: {rid, path, body}}, '*');
    setTimeout(() => { if (rmPend[rid]) { delete rmPend[rid]; rej(new Error('timeout')); } }, 5000);
  });
}
""", mob, count=1, flags=re.S)
if 'rmPend' not in mob:
    raise SystemExit('V mobil.html som nenašiel funkciu api()')
mob = rep(mob, "$('#fText').textContent = 'Napíš odpoveď na finálovú otázku, ktorá je na TV.';",
          "$('#fText').textContent = window.RM_FQ ? 'Otázka: ' + window.RM_FQ : 'Napíš odpoveď na finálovú otázku.';")
mob = rep(mob, '<p>Napíš svoje meno. Na TV sa ukáže, keď sa prihlásiš prvý.</p>', '<p>Napíš svoje meno.</p>')
mob = rep(mob, '<p class="tip">Nechaj obrazovku zapnutú. Keď vypadne Wi-Fi, mobil sa pripojí sám.</p>', '')
mob = rep(mob, "if (me && me.id) { showGame(); keepAwake(); } else { showJoin(); }\npoll();", """if (me && me.id) { showGame(); keepAwake(); } else { showJoin(); }
poll();
// meno zadané na úvode – pripojí sa samo (aj keď si ho hráč zmenil); kým spojenie s moderátorom
// ešte nie je hotové, skúša to znova
let rmAuto = !!window.RM_NAME && !(me && me.id && me.name === window.RM_NAME), rmBusy = false, rmT = 0;
async function rmTry() {
  if (!rmAuto || rmBusy) return;
  rmBusy = true; clearTimeout(rmT);
  await doJoin(window.RM_NAME, me && me.id);
  rmBusy = false;
  if (me && me.name === window.RM_NAME && !$('#game').hidden) { rmAuto = false; return; }
  $('#jstatus').textContent = 'Pripájam sa k moderátorovi…';
  rmT = setTimeout(rmTry, 2000);
}
rmTry();
// hneď ako je spojenie s moderátorom hotové, prihlási sa (nečaká na ďalší pokus)
window.addEventListener('message', e => { if (e.data && e.data.rmSpojene) { failCount = 0; rmTry(); } });
$('#rename').addEventListener('click', () => { rmAuto = false; });
// stránka okolo rámčeka podľa toho prispôsobí výšku
setInterval(() => {
  const mode = rmAuto ? 'buzz' : !$('#join').hidden ? 'join' : !$('#final').hidden ? 'final' : !$('#zet').hidden ? 'zet' : 'buzz';
  if (mode !== window.__rmMode) { window.__rmMode = mode; parent.postMessage({rmMode: mode}, '*'); }
}, 200);
window.addEventListener('message', e => {
  if (!e.data || e.data.rmFinalQ === undefined) return;
  window.RM_FQ = e.data.rmFinalQ; finalKey += '~'; if (st) paint();
});""")
mob = mob.replace('font:900 clamp(48px,17vw,96px)/1', 'font:900 clamp(40px,min(17vw,15vh),96px)/1')

# ---------- hra (tv.html) ----------
tv = rep(tv, "try { ROLE = sessionStorage.getItem('riskuj-role') || 'solo'; } catch (e) {}",
         "try { ROLE = sessionStorage.getItem('riskuj-role') || 'solo'; } catch (e) {}\nif (window.RM_ROLE) ROLE = window.RM_ROLE;   // len na mobiloch: rolu určuje úvodná voľba")
# hráč nikdy nedostane ovládanie, ani keď mu na chvíľu vypadne spojenie s moderátorom
tv = rep(tv, "const ctrls = () => ROLE !== 'tv' || !modAlive();",
         "const ctrls = () => ROLE !== 'tv' || (!modAlive() && !window.RM_HRAC);")
# kde hrajú zvuky, určuje moderátor (štandardne len jeho mobil)
tv = rep(tv, "const here = ROLE !== 'mod' || !livePeers().some(p => p.role === 'tv');",
         "const here = window.RM_ZVUK ? window.RM_ZVUK() : (ROLE !== 'mod' || !livePeers().some(p => p.role === 'tv'));", 2)
# texty: nie je tu TV ani počítač, hráči majú všetko v mobile
for a, b, n in [
    ("const ROLE_NAME = {solo: 'jedna obrazovka', tv: 'TV pre hráčov', mod: 'moderátor'};",
     "const ROLE_NAME = {solo: 'jedna obrazovka', tv: 'mobil hráča', mod: 'moderátor'};", 1),
    ("'TV · moderátor pripojený' : 'TV · moderátor nie je pripojený'",
     "'📱 moderátor pripojený' : '📱 moderátor nie je pripojený'", 1),
    ('Televízny kvíz pre 2 až 6 hráčov', 'Kvíz pre 2 až 6 hráčov', 1),
    ('Hlásia sa rukou alebo nahlas a moderátor klikne na toho, kto bol prvý, alebo stlačí jeho číslo (1 až 6). Hráč sa potom na obrazovke označí.',
     'Hlásia sa tlačidlom v mobile – kto stlačí prvý, ten odpovedá.', 1),
    ('Každý si napíše stávku a odpoveď na papier.', 'Každý si zadá stávku a odpoveď v mobile.', 1),
    ('Otázku vidíš len ty – prečítaj ju alebo ukáž na TV.', 'Otázku vidíš len ty – prečítaj ju nahlas alebo ju ukáž hráčom.', 1),
    ('Ukázať otázku na TV', 'Ukázať otázku hráčom', 2),
    ("'>Ukázať odpoveď na TV<'", "'>Ukázať odpoveď hráčom<'", 1),
    ('na TV ešte skryté', 'hráči ešte nevidia', 1),
    ('Na TV sa nezobrazí.', 'Ostatní ju nevidia.', 1),
    ('klikni alebo ${i + 1} = odpovedá', 'ťukni = odpovedá', 1),
    ('Kliknutím kategóriu vyberieš, ďalším kliknutím výber zrušíš.', 'Ťuknutím kategóriu vyberieš, ďalším ťuknutím výber zrušíš.', 1),
    ("'Naozaj ukončiť kolo? Klikni znova'", "'Naozaj ukončiť kolo? Ťukni znova'", 1),
    ("'Naozaj na úvod? Klikni znova'", "'Naozaj na úvod? Ťukni znova'", 1),
]:
    tv = rep(tv, a, b, n)
# bez internetu nesmie stránka čakať na nič z internetu: QR kód na pripojenie mobilov (cdnjs) tu netreba
# a písma z Google sa načítajú len popri (keď sú dostupné)
tv = rep(tv, '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>\n', '')
tv = rep(tv, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Archivo:wght@400;500;600;700;800&display=swap">',
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Archivo:wght@400;500;600;700;800&display=swap" media="print" onload="this.media=\'all\'">')
tv = rep(tv, '<title>Riskuj a nepiskuj! s mobilmi</title>',
         f'<title>Riskuj v{VERZIA} – len na mobiloch</title>\n<meta name="theme-color" content="#050920">\n'
         # aplikácia (PWA): ikona na plochu, celá obrazovka, funguje aj bez signálu (sw.js)
         '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="ikona-192.png">\n'
         '<link rel="apple-touch-icon" href="ikona-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
         '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Riskuj">\n'
         + CHYBY +
         f'<script>{peerjs}</script>\n<script>{qrgen}</script>\n<script>{jsqr}</script>\n<script>{hlavicka}</script>\n<style>{css}</style>')
tlacidlo = json.dumps(mob, ensure_ascii=False).replace('</', '<\\/')
i = tv.rindex('</body>')
tv = tv[:i] + f'<script>\nwindow.RM_TLACIDLO = {tlacidlo};\n{koniec}</script>\n' + tv[i:]
# keď sa časť pre mobily nespustí (napr. súbor otvorený v náhľade inej aplikácie), nech sa neukáže samostatná hra
tv = rep(tv, '<main class="app" id="app"></main>', FATAL + '<main class="app" id="app"></main>')

OUT.write_text(tv, 'utf-8')                          # na webe má stále rovnaký názov (QR kód naň ukazuje)
KOPIA = D / 'na-poslanie' / f'riskuj-mobily-v{VERZIA}.html'   # súbor na poslanie má v názve číslo verzie
KOPIA.parent.mkdir(exist_ok=True)
for stara in KOPIA.parent.glob('riskuj-mobily-v*.html'):
    stara.unlink()
KOPIA.write_text(tv, 'utf-8')
print(f'{OUT.name} + {KOPIA.parent.name}/{KOPIA.name}: {OUT.stat().st_size / 1e6:.1f} MB, verzia {VERZIA}')
