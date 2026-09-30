# Čo ja viem – malý server pre domácu Wi-Fi.
# Nič netreba inštalovať, stačí PowerShell, ktorý je súčasťou Windows.
# TV/počítač:  http://localhost:8081      Mobily:  http://<IP počítača>:8081/m
param(
  [int]$Port = 8081,
  [switch]$LocalOnly,
  [switch]$NoBrowser
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
$script:epoch = 0
$script:open = $false
$script:kind = ''                                    # abc | order
$script:count = 3                                    # počet možností / položiek
$script:items = @()                                  # texty položiek pre zoraďovanie
$script:askedAt = [DateTime]::UtcNow
$script:seconds = 20
$script:qtext = ''                                      # znenie otázky pre mobily

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
function SendJson($client, $obj) {
  Send $client 200 'application/json; charset=utf-8' ($utf8.GetBytes((ConvertTo-Json -InputObject $obj -Compress -Depth 6)))
}
function SendFile($client, [string]$name) {
  $f = Join-Path $root $name
  if (Test-Path $f) { Send $client 200 'text/html; charset=utf-8' ([System.IO.File]::ReadAllBytes($f)) }
  else { Send $client 404 'text/plain; charset=utf-8' ($utf8.GetBytes("Chýba súbor $name")) }
}
function IsOnline([string]$id) { $lastSeen.ContainsKey($id) -and (([DateTime]::UtcNow - $lastSeen[$id]).TotalSeconds -lt 6) }
function LeftMs { [int][Math]::Max(0, ($script:seconds * 1000) - ([DateTime]::UtcNow - $script:askedAt).TotalMilliseconds) }
function StateObj {
  $sent = @{}
  foreach ($k in $answers.Keys) { $sent[$k] = $true }
  @{
    epoch   = $script:epoch
    open    = ($script:open -and (LeftMs) -gt 0)
    kind    = $script:kind
    count   = $script:count
    items   = @($script:items)
    left    = LeftMs
    seconds = $script:seconds
    q       = $script:qtext
    sent    = $sent
    players = @($players | ForEach-Object { @{ id = $_.id; name = $_.name; online = (IsOnline $_.id) } })
  }
}
function FindPlayer([string]$id) { $players | Where-Object { $_.id -eq $id } | Select-Object -First 1 }
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
  foreach ($h in $lines) { if ($h -match '^Content-Length:\s*(\d+)') { $len = [int]$matches[1] } }
  $start = $idx + 4
  if ($bytes.Length - $start -lt $len) { return $null }
  $body = if ($len) { $utf8.GetString($bytes, $start, $len) } else { '' }
  return @{ method = $first[0]; path = $first[1]; body = $body }
}

function Handle($client, $req) {
  $path = ($req.path -split '\?')[0]
  $data = $null
  if ($req.body) { try { $data = $req.body | ConvertFrom-Json } catch {} }
  switch ($path) {
    '/'          { SendFile $client 'tv.html'; return }
    '/m'         { SendFile $client 'mobil.html'; return }
    '/api/info'  { SendJson $client @{ ips = @(Get-LanIPs); port = $Port }; return }
    '/api/state' {
      $me = QueryParam $req.path 'id'
      if ($me -and (FindPlayer $me)) { $lastSeen[$me] = [DateTime]::UtcNow }
      $st = StateObj
      if ($me -and $answers.ContainsKey($me)) { $st['mine'] = $answers[$me].v }
      SendJson $client $st; return
    }
    '/api/join' {
      $name = ([string]$data.name).Trim()
      if ($name.Length -gt 16) { $name = $name.Substring(0, 16) }
      if (-not $name) { $name = 'Hráč' }
      $p = $null
      if ($data.id) { $p = FindPlayer ([string]$data.id) }
      if ($p) { $p.name = $name }
      else {
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
    # nová otázka: vyčistí odpovede a spustí čas
    '/api/ask' {
      $answers.Clear()
      $script:kind = if ([string]$data.kind -eq 'order') { 'order' } else { 'abc' }
      $script:count = [Math]::Max(2, [Math]::Min(6, [int]$data.count))
      $script:items = @()
      if ($data.items) { foreach ($it in $data.items) { $script:items += [string]$it } }
      $script:seconds = [Math]::Max(3, [Math]::Min(120, [int]$data.seconds))
      $script:qtext = ([string]$data.q).Trim()
      if ($script:qtext.Length -gt 300) { $script:qtext = $script:qtext.Substring(0, 300) }
      $script:askedAt = [DateTime]::UtcNow
      $script:open = $true
      $script:epoch++
      SendJson $client @{ epoch = $script:epoch }; return
    }
    # odpoveď z mobilu: abc = číslo možnosti, order = poradie ako "2,0,3,1"
    '/api/answer' {
      $id = [string]$data.id
      $ok = $false
      if ((FindPlayer $id) -and $script:open -and (LeftMs) -gt 0 -and -not $answers.ContainsKey($id)) {
        $v = ([string]$data.v).Trim()
        if ($v.Length -gt 40) { $v = $v.Substring(0, 40) }
        $answers[$id] = @{ v = $v; ms = [int]([DateTime]::UtcNow - $script:askedAt).TotalMilliseconds }
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
    '/api/close' { $script:open = $false; SendJson $client @{ ok = $true }; return }
    '/api/idle'  { $script:open = $false; $answers.Clear(); $script:kind = ''; $script:qtext = ''; SendJson $client @{ ok = $true }; return }
    '/api/reset' {
      $players.Clear(); $answers.Clear(); $lastSeen.Clear(); $script:open = $false
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
if ($players.Count) { Write-Host "  Zapamätaní hráči: $(($players | ForEach-Object { $_.name }) -join ', ')" }
Write-Host '  Toto okno nechaj otvorené. Hru ukončíš zatvorením okna.'
Write-Host ''
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

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
