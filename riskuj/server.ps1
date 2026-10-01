# Riskuj! s mobilmi – malý server pre domácu Wi-Fi.
# Nič netreba inštalovať, stačí PowerShell, ktorý je súčasťou Windows.
# TV/počítač:  http://localhost:8080      Mobily:  http://<IP počítača>:8080/m
# Hra cez internet: spusti online.bat (server spúšťa sám, s adresou tunela v -PublicUrl).
param(
  [int]$Port = 8080,
  [switch]$LocalOnly,   # len na skúšku: počúva iba na tomto počítači
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
$buzzes  = New-Object System.Collections.ArrayList   # poradie stlačení od posledného „arm“
$lastSeen = @{}                                       # id -> čas posledného ozvania mobilu
$script:armed  = $false
$script:locked = @()
$script:epoch  = 0
# finále: stávky a odpovede z mobilov
$script:turn = ''                                   # id mobilu, ktorý práve odpovedá
$script:finalStage = 'off'                            # off | bet | answer | closed
$finalMax = @{}                                        # id -> najvyššia možná stávka
$finalBets = @{}                                       # id -> stávka
$finalAnswers = @{}                                    # id -> odpoveď
# žetóny (štít, prihrávka): TV posiela, čo môže práve odpovedajúci hráč použiť, mobil pošle požiadavku
$script:zet = @{ kto = '' }
$tokReq = New-Object System.Collections.ArrayList     # @{ n; id; kind; to; k }
$script:tokN = 0

# Hráči sa ukladajú do súboru, aby prežili aj reštart servera.
function SavePlayers {
  try { [System.IO.File]::WriteAllText($playersFile, (ConvertTo-Json -InputObject @($players | ForEach-Object { @{ id = $_.id; name = $_.name } }) -Compress), $utf8) } catch {}
}
if (Test-Path $playersFile) {
  try {
    $saved = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($playersFile, $utf8))
    foreach ($p in $saved) {   # foreach (nie pipeline), inak PowerShell 5.1 vráti celé pole ako jeden záznam
      if ($p.id -and $p.name) { [void]$players.Add(@{ id = [string]$p.id; name = [string]$p.name }) }
    }
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
function SendJson($client, $obj) {
  Send $client 200 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $obj -Compress -Depth 6)))
}
function SendFile($client, [string]$name) {
  $f = Join-Path $root $name
  if (Test-Path $f) { Send $client 200 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes($f)) }
  else { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes("Chýba súbor $name")) }
}
function IsOnline([string]$id) { $lastSeen.ContainsKey($id) -and (([DateTime]::UtcNow - $lastSeen[$id]).TotalSeconds -lt 6) }
function StateObj {
  $sent = @{}
  foreach ($p in $players) { $sent[$p.id] = @{ bet = $finalBets.ContainsKey($p.id); answer = $finalAnswers.ContainsKey($p.id) } }
  @{
    armed   = $script:armed
    epoch   = $script:epoch
    buzzes  = @($buzzes | ForEach-Object { @{ id = $_.id; name = $_.name } })
    locked  = @($script:locked)
    turn    = $script:turn
    players = @($players | ForEach-Object { @{ id = $_.id; name = $_.name; online = (IsOnline $_.id) } })
    final   = @{ stage = $script:finalStage; max = $finalMax; sent = $sent }
    zet     = $script:zet
    treq    = @($tokReq)
  }
}
function FindPlayer([string]$id) { $players | Where-Object { $_.id -eq $id } | Select-Object -First 1 }
function QueryParam([string]$path, [string]$name) {
  if ($path -match "[?&]$name=([^&]*)") { return [System.Uri]::UnescapeDataString($matches[1]) }
  return ''
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
  $data = $null
  if ($req.body) { try { $data = $req.body | ConvertFrom-Json } catch {} }
  # Z internetu je dostupné len to, čo potrebujú mobily. Moderátorská obrazovka a jej
  # ovládanie ostávajú len na tomto počítači – aj holý odkaz otvorí hráčom tlačidlo.
  if ($req.remote) {
    if ($path -eq '/' -or $path -eq '/m') { SendFile $client 'mobil.html'; return }
    if ($path -notin '/api/state', '/api/join', '/api/buzz', '/api/finalsubmit', '/api/token') {
      Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')); return
    }
  }
  switch ($path) {
    '/'           { SendFile $client 'tv.html'; return }
    '/m'          { SendFile $client 'mobil.html'; return }
    '/api/info'   { SendJson $client @{ ips = @(Get-LanIPs); port = $Port; public = $PublicUrl }; return }
    '/api/state'  {
      $me = QueryParam $req.path 'id'
      if ($me -and (FindPlayer $me)) { $lastSeen[$me] = [DateTime]::UtcNow }
      SendJson $client (StateObj); return
    }
    '/api/join' {
      $name = ([string]$data.name).Trim()
      if ($name.Length -gt 16) { $name = $name.Substring(0, 16) }
      if (-not $name) { $name = 'Hráč' }
      $p = $null
      if ($data.id) { $p = FindPlayer ([string]$data.id) }
      if ($p) { $p.name = $name }   # ten istý mobil, prípadne zmenené meno
      else {
        # znovupripojenie: rovnaké meno (napríklad z iného prehliadača) dostane späť svoje miesto
        $p = $players | Where-Object { $_.name.ToLower() -eq $name.ToLower() } | Select-Object -First 1
        if ($p) { Write-Host "  ~ znovu pripojený: $($p.name)" }
      }
      if (-not $p) {
        $p = @{ id = [guid]::NewGuid().ToString('N').Substring(0, 10); name = $name }
        [void]$players.Add($p)
        Write-Host "  + pripojil sa hráč: $name"
      }
      $lastSeen[$p.id] = [DateTime]::UtcNow
      SavePlayers
      SendJson $client @{ id = $p.id; name = $p.name }; return
    }
    '/api/buzz' {
      $id = [string]$data.id
      $p = FindPlayer $id
      $ok = $false
      if ($p -and $script:armed -and ($script:locked -notcontains $id) -and -not ($buzzes | Where-Object { $_.id -eq $id })) {
        [void]$buzzes.Add(@{ id = $id; name = $p.name })
        $ok = $true
      }
      if ($p) { $lastSeen[$id] = [DateTime]::UtcNow }
      SendJson $client @{ ok = $ok; order = $buzzes.Count }; return
    }
    '/api/arm' {
      $script:armed = $true
      $buzzes.Clear()
      $script:locked = @($data.locked | Where-Object { $_ })
      $script:epoch++
      $script:turn = ''
      SendJson $client @{ epoch = $script:epoch }; return
    }
    '/api/lock'   { $script:locked = @($data.locked | Where-Object { $_ }); SendJson $client @{ ok = $true }; return }
    '/api/turn'   { $script:turn = [string]$data.id; SendJson $client @{ ok = $true }; return }
    '/api/disarm' { $script:armed = $false; SendJson $client @{ ok = $true }; return }
    '/api/idle'   { $script:armed = $false; $buzzes.Clear(); $script:locked = @(); $script:turn = ''; SendJson $client @{ ok = $true }; return }
    '/api/reset'  {
      $players.Clear(); $buzzes.Clear(); $lastSeen.Clear(); $script:armed = $false; $script:locked = @()
      SavePlayers; Write-Host '  mobily odpojené'
      SendJson $client @{ ok = $true }; return
    }
    # --- žetóny ---
    '/api/zetony' { $script:zet = if ($data) { $data } else { @{ kto = '' } }; SendJson $client @{ ok = $true }; return }
    '/api/token' {
      $id = [string]$data.id
      $ok = $false
      if ((FindPlayer $id) -and $script:zet.kto -and $script:zet.kto -eq $id -and ([string]$data.kind -in 'stit', 'prihr')) {
        $script:tokN++
        [void]$tokReq.Add(@{ n = $script:tokN; id = $id; kind = [string]$data.kind; to = [int]$data.to; k = [string]$data.k })
        while ($tokReq.Count -gt 20) { $tokReq.RemoveAt(0) }
        $lastSeen[$id] = [DateTime]::UtcNow
        $ok = $true
      }
      SendJson $client @{ ok = $ok }; return
    }
    # --- finále ---
    '/api/final' {
      $stage = [string]$data.stage
      if ($stage -eq 'bet' -and $script:finalStage -ne 'bet') { $finalBets.Clear(); $finalAnswers.Clear() }
      $finalMax.Clear()
      if ($data.max) { foreach ($pr in $data.max.PSObject.Properties) { $finalMax[$pr.Name] = [int]$pr.Value } }
      $script:finalStage = if ($stage -in 'bet', 'answer', 'closed') { $stage } else { 'off' }
      if ($script:finalStage -eq 'off') { $finalBets.Clear(); $finalAnswers.Clear() }
      SendJson $client @{ ok = $true }; return
    }
    '/api/finalsubmit' {
      $id = [string]$data.id
      $ok = $false
      if ((FindPlayer $id) -and $finalMax.ContainsKey($id)) {
        if ($data.kind -eq 'bet' -and $script:finalStage -eq 'bet') {
          $v = 0; [void][int]::TryParse([string]$data.value, [ref]$v)
          $finalBets[$id] = [Math]::Max(0, [Math]::Min($finalMax[$id], $v)); $ok = $true
        }
        elseif ($data.kind -eq 'answer' -and $script:finalStage -eq 'answer') {
          $t = ([string]$data.value).Trim(); if ($t.Length -gt 120) { $t = $t.Substring(0, 120) }
          $finalAnswers[$id] = $t; $ok = $true
        }
        $lastSeen[$id] = [DateTime]::UtcNow
      }
      SendJson $client @{ ok = $ok; stage = $script:finalStage }; return
    }
    '/api/finaldata' { SendJson $client @{ stage = $script:finalStage; bets = $finalBets; answers = $finalAnswers }; return }
    default       { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes('Nenájdené')) }
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
Write-Host '  RISKUJ! S MOBILMI – server beží' -ForegroundColor Yellow
Write-Host "  Na TV / počítači otvor:   http://localhost:$Port"
foreach ($a in Get-LanIPs) { Write-Host "  Mobily (rovnaká Wi-Fi):   http://${a}:$Port/m" -ForegroundColor Cyan }
if ($PublicUrl) { Write-Host "  Mobily cez internet:      $PublicUrl" -ForegroundColor Green }
if ($players.Count) { Write-Host "  Zapamätaní hráči: $(($players | ForEach-Object { $_.name }) -join ', ')" }
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
