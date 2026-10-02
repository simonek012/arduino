# Kto? Čo? Koľko? – malý server pre hru s mobilmi (bez moderátora).
# Nič netreba inštalovať, stačí PowerShell, ktorý je súčasťou Windows.
# TV/počítač:  http://localhost:8082      Mobily:  http://<IP počítača>:8082/m
# Hra cez internet: spusti online.bat (server spúšťa sám, s adresou tunela v -PublicUrl).
#
# Server hru neriadi – len preposiela: TV (tv.html) je „mozog“ hry a posiela sem, čo majú mobily vidieť,
# mobily sem posielajú svoje odpovede, tipy a ťahy pri kreslení a TV si ich vyzdvihne.
param(
  [int]$Port = 8082,
  [switch]$LocalOnly,
  [switch]$NoBrowser,
  [string]$PublicUrl = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$playersFile = Join-Path $root 'hraci.json'

# ---------- stav na serveri ----------
$players  = New-Object System.Collections.ArrayList   # @{ id; name }
$lastSeen = @{}                                       # id -> čas posledného ozvania
$script:verejne = 'null'                              # čo vidia všetci (JSON od TV)
$pre = @{}                                            # id -> súkromné údaje pre jeden mobil (JSON od TV)
$vstupy = New-Object System.Collections.ArrayList     # @{ n; json } – odpovede z mobilov, TV si ich berie podľa n
$script:vstupN = 0
$script:ver = 0
$script:hraciKey = ''
$script:hraciJson = '[]'

function SavePlayers {
  try { [System.IO.File]::WriteAllText($playersFile, (ConvertTo-Json -InputObject @($players | ForEach-Object { @{ id = $_.id; name = $_.name } }) -Compress), $utf8) } catch {}
}
if (Test-Path $playersFile) {
  try {
    $saved = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($playersFile, $utf8))
    foreach ($p in $saved) { if ($p.id -and $p.name) { [void]$players.Add(@{ id = [string]$p.id; name = [string]$p.name }) } }
  } catch {}
}

function Get-LanIPs {
  $list = foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
    foreach ($ua in $nic.GetIPProperties().UnicastAddresses) {
      if ($ua.Address.AddressFamily -eq 'InterNetwork') { $ua.Address.ToString() }
    }
  }
  @($list | Sort-Object { if ($_ -like '192.168.*') { 0 } elseif ($_ -like '10.*') { 1 } else { 2 } })
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
function SendText($client, [string]$json) { Send $client 200 'application/json; charset=utf-8' ($utf8.GetBytes($json)) }
function SendJson($client, $obj) { SendText $client (ConvertTo-Json -InputObject $obj -Compress -Depth 6) }
function SendFile($client, [string]$name) {
  $f = Join-Path $root $name
  if (Test-Path $f) { Send $client 200 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes($f)) }
  else { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes("Chýba súbor $name")) }
}
function IsOnline([string]$id) { $lastSeen.ContainsKey($id) -and (([DateTime]::UtcNow - $lastSeen[$id]).TotalSeconds -lt 6) }
function FindPlayer([string]$id) { foreach ($p in $players) { if ($p.id -eq $id) { return $p } }; return $null }
function QueryParam([string]$path, [string]$name) {
  if ($path -match "[?&]$name=([^&]*)") { return [System.Uri]::UnescapeDataString($matches[1]) }
  return ''
}
# zoznam hráčov ako JSON – skladá sa znova, len keď sa niečo zmení
function HraciJson {
  $key = [string]$script:ver
  foreach ($p in $players) { $key += if (IsOnline $p.id) { '1' } else { '0' } }
  if ($key -ne $script:hraciKey) {
    $pl = New-Object System.Collections.ArrayList
    foreach ($p in $players) { [void]$pl.Add(@{ id = $p.id; name = $p.name; online = (IsOnline $p.id) }) }
    $script:hraciJson = ConvertTo-Json -InputObject @($pl) -Compress -Depth 3
    if (-not $script:hraciJson -or $players.Count -eq 0) { $script:hraciJson = '[]' }
    $script:hraciKey = $key
  }
  $script:hraciJson
}
function JeJson([string]$t) {   # do servera pustíme len platný JSON objekt, aby sa TV nezasekla
  if (-not $t -or $t.Length -gt 60000) { return $false }
  $t = $t.Trim()
  if (-not $t.StartsWith('{') -or -not $t.EndsWith('}')) { return $false }
  try { [void](ConvertFrom-Json -InputObject $t); return $true } catch { return $false }
}

# Z nazbieraných bajtov poskladá HTTP požiadavku (ak je už celá).
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
  # Z internetu sú dostupné len veci pre mobily.
  if ($req.remote) {
    if ($path -eq '/' -or $path -eq '/m') { SendFile $client 'mobil.html'; return }
    if ($path -notin '/api/state', '/api/join', '/api/vstup') { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')); return }
  }
  switch ($path) {
    '/'          { SendFile $client 'tv.html'; return }
    '/m'         { SendFile $client 'mobil.html'; return }
    '/api/info'  { SendJson $client @{ ips = @(Get-LanIPs); port = $Port; public = $PublicUrl }; return }
    '/api/state' {   # mobil: verejný stav hry + jeho súkromné údaje
      $me = QueryParam $req.path 'id'
      $ja = 'null'
      if ($me -and (FindPlayer $me)) { $lastSeen[$me] = [DateTime]::UtcNow; if ($pre.ContainsKey($me)) { $ja = $pre[$me] } }
      SendText $client ('{"ver":' + $script:ver + ',"known":' + $(if ($me -and (FindPlayer $me)) { 'true' } else { 'false' }) + ',"hraci":' + (HraciJson) + ',"hra":' + $script:verejne + ',"ja":' + $ja + '}')
      return
    }
    '/api/join' {
      $data = $null; try { $data = $req.body | ConvertFrom-Json } catch {}
      $name = ([string]$data.name).Trim()
      if ($name.Length -gt 14) { $name = $name.Substring(0, 14) }
      if (-not $name) { $name = 'Hráč' }
      $p = $null
      if ($data.id) { $p = FindPlayer ([string]$data.id) }
      if ($p) { $p.name = $name }
      else {
        foreach ($x in $players) { if ($x.name.ToLower() -eq $name.ToLower()) { $p = $x; break } }   # znovupripojenie pod rovnakým menom
        if ($p) { Write-Host "  ~ znovu pripojený: $($p.name)" }
      }
      if (-not $p) {
        if ($players.Count -ge 12) { SendJson $client @{ error = 'Hra je plná (najviac 12 hráčov).' }; return }
        $p = @{ id = [guid]::NewGuid().ToString('N').Substring(0, 10); name = $name }
        [void]$players.Add($p)
        Write-Host "  + pripojil sa hráč: $name"
      }
      $lastSeen[$p.id] = [DateTime]::UtcNow
      $script:ver++
      SavePlayers
      SendJson $client @{ id = $p.id; name = $p.name }; return
    }
    '/api/vstup' {   # mobil: odpoveď, tip, hlas alebo kus kresby
      $id = QueryParam $req.path 'id'
      $ok = $false
      if ((FindPlayer $id) -and (JeJson $req.body)) {
        $script:vstupN++
        [void]$vstupy.Add(@{ n = $script:vstupN; json = ('{"n":' + $script:vstupN + ',"id":"' + $id + '","d":' + $req.body.Trim() + '}') })
        while ($vstupy.Count -gt 3000) { $vstupy.RemoveAt(0) }
        $lastSeen[$id] = [DateTime]::UtcNow
        $ok = $true
      }
      SendText $client ('{"ok":' + $(if ($ok) { 'true' } else { 'false' }) + '}'); return
    }
    # --- len pre TV ---
    '/api/hraci'   { SendText $client ('{"hraci":' + (HraciJson) + ',"public":"' + $PublicUrl + '"}'); return }
    '/api/vstupy'  {
      $od = 0; [void][int]::TryParse((QueryParam $req.path 'od'), [ref]$od)
      $sb = New-Object System.Text.StringBuilder
      [void]$sb.Append('{"max":' + $script:vstupN + ',"v":[')
      $first = $true
      foreach ($v in $vstupy) { if ($v.n -gt $od) { if (-not $first) { [void]$sb.Append(',') }; [void]$sb.Append($v.json); $first = $false } }
      [void]$sb.Append(']}')
      SendText $client $sb.ToString(); return
    }
    '/api/verejne' { if ($req.body) { $script:verejne = $req.body.Trim() }; $script:ver++; SendText $client '{"ok":true}'; return }
    '/api/pre'     {
      $id = QueryParam $req.path 'id'
      if ($id) { if ($req.body -and $req.body.Trim() -ne 'null') { $pre[$id] = $req.body.Trim() } else { $pre.Remove($id) } }
      $script:ver++
      SendText $client '{"ok":true}'; return
    }
    '/api/vyhod'   {   # TV odstráni hráča (napr. omylom pripojený mobil)
      $id = QueryParam $req.path 'id'
      $p = FindPlayer $id
      if ($p) { $players.Remove($p); $pre.Remove($id); $script:ver++; SavePlayers }
      SendText $client '{"ok":true}'; return
    }
    '/api/reset'   { $players.Clear(); $lastSeen.Clear(); $pre.Clear(); $vstupy.Clear(); $script:verejne = 'null'; $script:ver++; SavePlayers; SendText $client '{"ok":true}'; return }
    default        { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')) }
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
Write-Host '  KTO? ČO? KOĽKO? – server beží' -ForegroundColor Yellow
Write-Host "  Na TV / počítači otvor:   http://localhost:$Port"
foreach ($a in Get-LanIPs) { Write-Host "  Mobily (rovnaká Wi-Fi):   http://${a}:$Port/m" -ForegroundColor Cyan }
if ($PublicUrl) { Write-Host "  Mobily cez internet:      $PublicUrl" -ForegroundColor Green }
Write-Host '  Ak sa mobil nevie pripojiť: keď sa Windows opýta, či PowerShellu povoliť sieť, daj Povoliť.'
Write-Host '  Toto okno nechaj otvorené. Hru ukončíš zatvorením okna.'
Write-Host ''
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

# Jednovláknová slučka: obslúži všetky pripravené spojenia, nečaká na „tiché“ spojenia prehliadača.
$conns = New-Object System.Collections.ArrayList
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
        if ($req) { Handle $c $req; $c.Close(); $conns.Remove($k) }
      }
      elseif (([DateTime]::UtcNow - $k.t).TotalSeconds -gt 10) { $c.Close(); $conns.Remove($k) }
    }
    catch { try { $c.Close() } catch {}; $conns.Remove($k) }
  }
  if (-not $busy) { Start-Sleep -Milliseconds 4 }
}
