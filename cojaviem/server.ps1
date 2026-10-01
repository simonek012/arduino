# Čo ja viem – malý server pre domácu Wi-Fi.
# Nič netreba inštalovať, stačí PowerShell, ktorý je súčasťou Windows.
# TV/počítač:  http://localhost:8081      Mobily:  http://<IP počítača>:8081/m
# Hra cez internet: spusti online.bat (server spúšťa sám, s adresou tunela v -PublicUrl).
param(
  [int]$Port = 8081,
  [switch]$LocalOnly,
  [switch]$NoBrowser,
  [string]$PublicUrl = ''   # verejná adresa z Cloudflare tunela (vyplní online.bat)
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$playersFile = Join-Path $root 'hraci.json'

# ---------- stav na serveri ----------
$players = New-Object System.Collections.ArrayList   # @{ id; name }
$lastSeen = @{}                                      # id -> čas posledného ozvania mobilu
$answers = @{}                                       # id -> @{ v; ms }
$shownAt = @{}                                       # id -> kedy mobil dostal aktuálnu otázku (od toho sa meria čas odpovede)
$kicked = @{}                                        # id mobilov, ktoré moderátor odpojil – tie sa samé naspäť nepripoja
$waiting = New-Object System.Collections.ArrayList   # mobily, ktoré čakajú na zmenu (odpovieme im hneď, ako sa niečo stane)
$script:ver = 0                                      # zvýši sa pri každej zmene otázky
$script:held = $false
$script:expired = $false
$script:epoch = 0
$script:open = $false
$script:kind = ''                                    # abc | order | match
$script:count = 3                                    # počet možností / položiek
$script:items = @()                                  # texty možností / položiek (pri priraďovaní ľavá strana A, B, C…)
$script:items2 = @()                                 # pri priraďovaní pravá strana 1, 2, 3…
$script:askedAt = [DateTime]::UtcNow
$script:seconds = 20
$script:qtext = ''                                      # znenie otázky pre mobily
$GRACE_MS = 400                                      # odpoveď odoslaná na poslednú chvíľu ešte chvíľu letí po Wi-Fi

function SavePlayers {
  try { [System.IO.File]::WriteAllText($playersFile, (ConvertTo-Json -InputObject @($players | ForEach-Object { @{ id = $_.id; name = $_.name } }) -Compress), $utf8) } catch {}
}
if (Test-Path $playersFile) {
  try {
    $saved = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($playersFile, $utf8))
    foreach ($p in $saved) { if ($p.id -and $p.name) { [void]$players.Add(@{ id = [string]$p.id; name = [string]$p.name }) } }
  } catch {}
}

# Adresy počítača v sieti. Prvá je tá, na ktorú sa majú pripájať mobily:
# skutočná Wi-Fi/sieťová karta s bránou, virtuálne adaptéry (VirtualBox, Hyper-V, VPN…) až na koniec.
function Get-LanIPs {
  $list = foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback' -or $nic.NetworkInterfaceType -eq 'Tunnel') { continue }
    $props = $nic.GetIPProperties()
    $gw = $false
    foreach ($g in $props.GatewayAddresses) { if ($g.Address.AddressFamily -eq 'InterNetwork' -and $g.Address.ToString() -ne '0.0.0.0') { $gw = $true } }
    $virt = "$($nic.Name) $($nic.Description)" -match 'virtual|vmware|vbox|hyper-v|vethernet|\bwsl\b|docker|\btap\b|\btun\b|vpn|bluetooth|zerotier|tailscale|hamachi'
    foreach ($ua in $props.UnicastAddresses) {
      $a = $ua.Address.ToString()
      if ($ua.Address.AddressFamily -ne 'InterNetwork' -or $a.StartsWith('169.254.')) { continue }
      $score = 0
      if (-not $gw) { $score += 10 }
      if ($virt) { $score += 20 }
      if ($nic.NetworkInterfaceType -ne 'Wireless80211' -and $nic.NetworkInterfaceType -ne 'Ethernet') { $score += 5 }
      if ($a -like '10.*') { $score += 1 } elseif ($a -notlike '192.168.*') { $score += 2 }
      New-Object PSObject -Property @{ ip = $a; score = $score }
    }
  }
  @($list | Sort-Object score | ForEach-Object { $_.ip })
}

function Send($client, [int]$code, [string]$type, [byte[]]$body) {
  $status = @{ 200 = 'OK'; 400 = 'Bad Request'; 404 = 'Not Found' }[$code]
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $s = $client.GetStream()
  $hb = $utf8.GetBytes($head)
  $s.Write($hb, 0, $hb.Length)
  if ($body.Length) { $s.Write($body, 0, $body.Length) }
  $s.Flush()
}
function SendJson($client, $obj) {
  Send $client 200 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $obj -Compress -Depth 6)))
}
function SendFile($client, [string]$name) {
  $f = Join-Path $root $name
  if (Test-Path $f) { Send $client 200 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes($f)) }
  else { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes("Chýba súbor $name")) }
}
function Bump { $script:ver++ }                     # niečo sa zmenilo – čakajúce mobily sa to dozvedia hneď
function IsOnline([string]$id) { $lastSeen.ContainsKey($id) -and (([DateTime]::UtcNow - $lastSeen[$id]).TotalSeconds -lt 7) }
function LeftMs { [int][Math]::Max(0, ($script:seconds * 1000) - ([DateTime]::UtcNow - $script:askedAt).TotalMilliseconds) }
function FindPlayer([string]$id) {
  if (-not $id) { return $null }
  foreach ($p in $players) { if ($p.id -eq $id) { return $p } }
  return $null
}
function StateObj([string]$me) {
  $sent = @{}
  foreach ($k in $answers.Keys) { $sent[$k] = $true }
  $list = New-Object System.Collections.ArrayList
  foreach ($p in $players) { [void]$list.Add(@{ id = $p.id; name = $p.name; online = (IsOnline $p.id) }) }
  $left = LeftMs
  $st = @{
    epoch   = $script:epoch
    ver     = $script:ver
    open    = ($script:open -and $left -gt 0)
    kind    = $script:kind
    count   = $script:count
    items   = @($script:items)
    items2  = @($script:items2)
    left    = $left
    seconds = $script:seconds
    q       = $script:qtext
    sent    = $sent
    players = @($list)
  }
  if ($me) {
    $st['known'] = [bool](FindPlayer $me)
    if ($kicked.ContainsKey($me)) { $st['kicked'] = $true }
    if ($answers.ContainsKey($me)) { $st['mine'] = $answers[$me].v }
  }
  $st
}
function SendState($client, [string]$me, [bool]$ozval = $true) {
  if ($me -and (FindPlayer $me)) {
    if ($ozval) { $lastSeen[$me] = [DateTime]::UtcNow }        # čakajúca odpoveď sa neráta – mobil už nemusí existovať
    if ($script:open -and (LeftMs) -gt 0 -and -not $shownAt.ContainsKey($me)) { $shownAt[$me] = [DateTime]::UtcNow }
  }
  SendJson $client (StateObj $me)
}
# Mobily čakajú na zmenu najviac 4 sekundy, potom dostanú odpoveď aj tak (a tým vieme, že sú pripojené).
function ReleaseWaiting {
  if (-not $waiting.Count) { return }
  $now = [DateTime]::UtcNow
  foreach ($w in @($waiting)) {
    if ([string]$script:ver -ne $w.v -or $now -ge $w.until) {
      $waiting.Remove($w)
      try { SendState $w.c $w.me $false } catch {}
      try { $w.c.Close() } catch {}
    }
  }
}
function QueryParam([string]$path, [string]$name) {
  if ($path -match "[?&]$name=([^&]*)") { return [System.Uri]::UnescapeDataString($matches[1]) }
  return ''
}
function TryParse($ms) {
  $bytes = $ms.ToArray()
  $text = [System.Text.Encoding]::ASCII.GetString($bytes)
  $idx = $text.IndexOf("`r`n`r`n")
  if ($idx -lt 0) { return $null }
  $lines = $text.Substring(0, $idx) -split "`r`n"
  $first = $lines[0] -split ' '
  $len = 0
  $remote = $false
  foreach ($h in $lines) {
    if ($h -match '^Content-Length:\s*(\d+)') { $len = [int]$matches[1] }
    if ($h -match '^(Cf-Connecting-Ip|Cf-Ray):') { $remote = $true }   # prišlo z internetu cez Cloudflare tunel
  }
  $start = $idx + 4
  if ($bytes.Length - $start -lt $len) { return $null }
  $body = if ($len) { $utf8.GetString($bytes, $start, $len) } else { '' }
  return @{ method = $first[0]; path = $first[1]; body = $body; remote = $remote }
}

function Handle($client, $req) {
  $path = ($req.path -split '\?')[0]
  $data = $null
  if ($req.body) { try { $data = $req.body | ConvertFrom-Json } catch {} }
  # Z internetu je dostupné len to, čo potrebujú mobily. Moderátorská obrazovka a jej
  # ovládanie ostávajú len na tomto počítači – aj holý odkaz otvorí hráčom mobilnú stránku.
  if ($req.remote) {
    if ($path -eq '/' -or $path -eq '/m') { SendFile $client 'mobil.html'; return }
    if ($path -notin '/api/state', '/api/join', '/api/answer') {
      Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')); return
    }
  }
  switch ($path) {
    '/'          { SendFile $client 'tv.html'; return }
    '/m'         { SendFile $client 'mobil.html'; return }
    '/api/info'  { SendJson $client @{ ips = @(Get-LanIPs); port = $Port; public = $PublicUrl }; return }
    # s parametrom v= mobil čaká, kým sa niečo zmení (nová otázka, koniec času…), a dozvie sa to hneď
    '/api/state' {
      $me = QueryParam $req.path 'id'
      $v = QueryParam $req.path 'v'
      if ($v -ne '' -and $v -eq [string]$script:ver) {
        if ($me -and (FindPlayer $me)) { $lastSeen[$me] = [DateTime]::UtcNow }
        [void]$waiting.Add(@{ c = $client; me = $me; v = $v; until = [DateTime]::UtcNow.AddSeconds(4) })
        $script:held = $true
        return
      }
      SendState $client $me; return
    }
    '/api/join' {
      $name = ([string]$data.name).Trim()
      if ($name.Length -gt 16) { $name = $name.Substring(0, 16) }
      if (-not $name) { $name = 'Hráč' }
      $want = [string]$data.id
      $p = FindPlayer $want
      if ($p) { $p.name = $name }
      else {
        foreach ($x in $players) { if (-not $p -and $x.name.ToLower() -eq $name.ToLower()) { $p = $x } }
        if ($p) { Write-Host "  ~ znovu pripojený: $($p.name)" }
      }
      if (-not $p) {
        # mobil, ktorý server nepozná (napr. po reštarte bez hraci.json), si nechá svoje doterajšie id
        $nid = if ($want -match '^[0-9a-f]{10}$') { $want } else { [guid]::NewGuid().ToString('N').Substring(0, 10) }
        $p = @{ id = $nid; name = $name }
        [void]$players.Add($p)
        Write-Host "  + pripojil sa hráč: $name"
      }
      $kicked.Remove($p.id)
      if ($want) { $kicked.Remove($want) }
      $lastSeen[$p.id] = [DateTime]::UtcNow
      SavePlayers
      SendJson $client @{ id = $p.id; name = $p.name }; return
    }
    # nová otázka: vyčistí odpovede a spustí čas
    '/api/ask' {
      $answers.Clear(); $shownAt.Clear()
      $script:kind = switch ([string]$data.kind) { 'order' { 'order' } 'match' { 'match' } default { 'abc' } }
      $script:count = [Math]::Max(2, [Math]::Min(6, [int]$data.count))
      $script:items = @()
      if ($data.items) { foreach ($it in $data.items) { $script:items += [string]$it } }
      $script:items2 = @()
      if ($data.items2) { foreach ($it in $data.items2) { $script:items2 += [string]$it } }
      $script:seconds = [Math]::Max(3, [Math]::Min(120, [int]$data.seconds))
      $script:qtext = ([string]$data.q).Trim()
      if ($script:qtext.Length -gt 300) { $script:qtext = $script:qtext.Substring(0, 300) }
      $script:askedAt = [DateTime]::UtcNow
      $script:open = $true
      $script:expired = $false
      $script:epoch++
      Bump
      SendJson $client @{ epoch = $script:epoch }; return
    }
    # odpoveď z mobilu: abc = číslo možnosti, order = poradie ako "2,0,3,1", match = ku každému písmenu číslo ako "1,2,0"
    '/api/answer' {
      $id = [string]$data.id
      $ok = $false
      $now = [DateTime]::UtcNow
      $elapsed = ($now - $script:askedAt).TotalMilliseconds
      $sameQ = ($null -eq $data.e) -or ([int]$data.e -eq $script:epoch)
      if ((FindPlayer $id) -and $script:open -and $sameQ -and $elapsed -lt ($script:seconds * 1000 + $GRACE_MS) -and -not $answers.ContainsKey($id)) {
        $v = ([string]$data.v).Trim()
        if ($v.Length -gt 40) { $v = $v.Substring(0, 40) }
        $from = if ($shownAt.ContainsKey($id)) { $shownAt[$id] } else { $script:askedAt }
        $ms = [Math]::Min(($now - $from).TotalMilliseconds, $script:seconds * 1000)
        $answers[$id] = @{ v = $v; ms = [int][Math]::Max(0, $ms) }
        $ok = $true
      }
      if (FindPlayer $id) { $lastSeen[$id] = [DateTime]::UtcNow }
      SendJson $client @{ ok = $ok; left = LeftMs }; return
    }
    '/api/answers' {
      $out = @{}
      foreach ($k in $answers.Keys) { $out[$k] = @{ v = $answers[$k].v; ms = $answers[$k].ms } }
      SendJson $client @{ epoch = $script:epoch; open = $script:open; left = LeftMs; answers = $out }; return
    }
    '/api/close' { $script:open = $false; Bump; SendJson $client @{ ok = $true }; return }
    '/api/idle'  { $script:open = $false; $answers.Clear(); $script:kind = ''; $script:qtext = ''; Bump; SendJson $client @{ ok = $true }; return }
    '/api/reset' {
      foreach ($p in $players) { $kicked[$p.id] = $true }
      $players.Clear(); $answers.Clear(); $lastSeen.Clear(); $script:open = $false
      Bump
      SavePlayers; Write-Host '  mobily odpojené'
      SendJson $client @{ ok = $true }; return
    }
    default { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')) }
  }
}

# ---------- štart ----------
$ip = if ($LocalOnly) { [System.Net.IPAddress]::Loopback } else { [System.Net.IPAddress]::Any }
$listener = New-Object System.Net.Sockets.TcpListener($ip, $Port)
try { $listener.Start() }
catch {
  Write-Host "Port $Port je obsadený. Možno už server beží v inom okne." -ForegroundColor Red
  Read-Host 'Stlač Enter na zatvorenie'
  exit 1
}
Write-Host ''
Write-Host '  ČO JA VIEM – server beží' -ForegroundColor Yellow
Write-Host "  Na TV / počítači otvor:   http://localhost:$Port"
foreach ($a in Get-LanIPs) { Write-Host "  Mobily (rovnaká Wi-Fi):   http://${a}:$Port/m" -ForegroundColor Cyan }
if ($PublicUrl) { Write-Host "  Mobily cez internet:      $PublicUrl" -ForegroundColor Green }
if ($players.Count) { Write-Host "  Zapamätaní hráči: $(($players | ForEach-Object { $_.name }) -join ', ')" }
Write-Host '  Ak sa mobil nevie pripojiť: keď sa Windows opýta, či PowerShellu povoliť sieť, daj Povoliť.'
Write-Host '  Toto okno nechaj otvorené. Hru ukončíš zatvorením okna.'
Write-Host ''
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

$conns = New-Object System.Collections.ArrayList
$readable = New-Object System.Collections.ArrayList
while ($true) {
  while ($listener.Pending()) {
    $c = $listener.AcceptTcpClient()
    $c.NoDelay = $true
    [void]$conns.Add(@{ c = $c; buf = (New-Object System.IO.MemoryStream); t = [DateTime]::UtcNow })
  }
  $busy = $false
  foreach ($k in @($conns)) {
    $c = $k.c
    try {
      if ($c.Available -gt 0) {
        $busy = $true
        $tmp = New-Object byte[] $c.Available
        $n = $c.GetStream().Read($tmp, 0, $tmp.Length)
        $k.buf.Write($tmp, 0, $n)
        $req = TryParse $k.buf
        if ($req) {
          $script:held = $false
          $conns.Remove($k)
          Handle $c $req
          if (-not $script:held) { $c.Close() }             # čakajúci mobil zatvoríme až po odpovedi
        }
      }
      elseif ($readable.Contains($c.Client) -or ([DateTime]::UtcNow - $k.t).TotalSeconds -gt 10) { $c.Close(); $conns.Remove($k) }   # mobil spojenie zavrel
    }
    catch { try { $c.Close() } catch {}; $conns.Remove($k) }
  }
  if ($script:open -and -not $script:expired -and (LeftMs) -le 0) { $script:expired = $true; Bump }   # čas vypršal
  ReleaseWaiting
  $readable.Clear()
  if (-not $busy) {
    # počkáme, kým niečo príde (najviac 20 ms), namiesto slepého spánku – odpoveď tak odíde hneď
    [void]$readable.Add($listener.Server)
    foreach ($k in $conns) { [void]$readable.Add($k.c.Client) }
    try { [System.Net.Sockets.Socket]::Select($readable, $null, $null, 20000) } catch { $readable.Clear(); Start-Sleep -Milliseconds 5 }
  }
}
