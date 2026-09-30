# Riskuj! cez internet – spustí hru a sprístupní ju mobilom kdekoľvek na svete.
# Používa bezplatný Cloudflare tunel: netreba nič nastavovať na routeri ani sa registrovať.
# Spúšťa sa dvojklikom na online.bat.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root 'cloudflared.exe'
$log = Join-Path $root 'tunel.log'
$Port = 8080

Write-Host ''
Write-Host '  RISKUJ! CEZ INTERNET' -ForegroundColor Yellow
Write-Host ''

# 1) program na tunel si stiahneme sami (len prvýkrát)
if (-not (Test-Path $exe)) {
  Write-Host '  Prvé spustenie: sťahujem program cloudflared (asi 60 MB, chvíľu to potrvá)...'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $tmp = "$exe.stahuje"
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $tmp -UseBasicParsing
    Move-Item $tmp $exe -Force
    Write-Host '  Stiahnuté.' -ForegroundColor Green
  } catch {
    Remove-Item "$exe.stahuje" -ErrorAction SilentlyContinue
    Write-Host '  Nepodarilo sa stiahnuť cloudflared. Je počítač pripojený na internet?' -ForegroundColor Red
    Read-Host '  Stlač Enter na zatvorenie'
    exit 1
  }
}

# 2) tunel z minulého spustenia (ak zostal visieť) zavrieme a spustíme nový
Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $log, "$log.out" -ErrorAction SilentlyContinue
Write-Host '  Otváram spojenie do internetu...'
# -NoNewWindow: tunel beží v tomto okne na pozadí a zavrie sa spolu s ním
$tunel = Start-Process -FilePath $exe -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://localhost:$Port") `
  -NoNewWindow -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.out"

# 3) počkáme, kým Cloudflare pridelí adresu (býva to do 10 sekúnd)
function CitajLog {
  try {
    $f = [System.IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
    try { (New-Object System.IO.StreamReader($f)).ReadToEnd() } finally { $f.Close() }
  } catch { '' }
}
$url = ''
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  if ((CitajLog) -match 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com') { $url = $matches[0] }
  if ($tunel.HasExited) { break }
}

if ($url) {
  try { Set-Clipboard -Value $url } catch {}
  Write-Host ''
  Write-Host '  ================================================================' -ForegroundColor Green
  Write-Host "   ODKAZ PRE KAMARÁTOV:  $url" -ForegroundColor Green
  Write-Host '   (je už skopírovaný – stačí ho vložiť do WhatsAppu cez Ctrl+V)' -ForegroundColor Green
  Write-Host '  ================================================================' -ForegroundColor Green
  Write-Host '   Odkaz a QR kód nájdeš aj na TV v úvode hry.'
  Write-Host '   Pri každom spustení je odkaz iný, pošli vždy ten nový.'
  Write-Host ''
} else {
  Write-Host ''
  Write-Host '  Spojenie do internetu sa nepodarilo otvoriť. Hra pobeží len na domácej Wi-Fi.' -ForegroundColor Red
  Write-Host "  (Podrobnosti sú v súbore $log.)"
  Write-Host ''
}

# 4) spustíme samotnú hru; keď zatvoríš toto okno, skončí hra aj tunel
try { & (Join-Path $root 'server.ps1') -Port $Port -PublicUrl $url }
finally { if ($tunel -and -not $tunel.HasExited) { try { $tunel.Kill() } catch {} } }
