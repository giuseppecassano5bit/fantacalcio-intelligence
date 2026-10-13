# Installa (o aggiorna) FantaIntelligence su Windows e la avvia. Da incollare in PowerShell:
#
#   irm https://raw.githubusercontent.com/giuseppecassano5bit/fantacalcio-intelligence/main/scripts/installa.ps1 | iex
#
# Cartella: %USERPROFILE%\FantaIntelligence (cambiabile con la variabile FANTA_DIR). Se manca Node.js 22.13+,
# ne scarica una copia privata da nodejs.org dentro la cartella dell'app: non servono permessi di amministratore.
# Rilanciare il comando aggiorna l'app: i dati (cartella data) e il file .env restano dove sono.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'giuseppecassano5bit/fantacalcio-intelligence'
  $Ref = if ($env:FANTA_REF) { $env:FANTA_REF } else { 'main' } # ramo o commit da installare
  $Dest = if ($env:FANTA_DIR) { $env:FANTA_DIR } else { Join-Path $HOME 'FantaIntelligence' }
  $NodeDist = 'https://nodejs.org/dist/latest-v24.x'

  function Say($m) { Write-Host "`n[FantaIntelligence] $m" -ForegroundColor Green }
  function Die($m) { Write-Host "`n[FantaIntelligence] ERRORE: $m" -ForegroundColor Red; throw "FantaIntelligence: $m" }

  function Expand-Zip($zip, $to) {
    # tar.exe (Windows 10 1803+) è molto più veloce di Expand-Archive
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) { tar.exe -xf $zip -C $to; if ($LASTEXITCODE -eq 0) { return } }
    Expand-Archive -Path $zip -DestinationPath $to -Force
  }

  function New-TempDir {
    $d = Join-Path ([IO.Path]::GetTempPath()) ('fanta-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $d | Out-Null
    return $d
  }

  if ((Test-Path $Dest) -and (Get-ChildItem $Dest -Force | Select-Object -First 1) -and -not (Test-Path (Join-Path $Dest 'scripts\avvia.mjs'))) {
    Die "la cartella $Dest esiste gia' e non contiene FantaIntelligence. Scegline un'altra impostando FANTA_DIR."
  }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null

  # ---------- Node.js ----------
  function Test-Node {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    $v = (& node -p 'process.versions.node') 2>$null
    try { return ([version]$v -ge [version]'22.13.0') } catch { return $false }
  }
  $NodeDir = Join-Path $Dest '.node'
  $env:Path = "$NodeDir;$env:Path"
  # FANTA_SCARICA_NODE=1 usa sempre la copia privata (serve per le verifiche automatiche)
  $forza = ($env:FANTA_SCARICA_NODE -eq '1') -and -not (Test-Path (Join-Path $NodeDir 'node.exe'))
  if ($forza -or -not (Test-Node)) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    Say 'Scarico Node.js (circa 30 MB) da nodejs.org...'
    $sums = (Invoke-WebRequest "$NodeDist/SHASUMS256.txt" -UseBasicParsing).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { Die "non trovo Node.js per Windows $arch." }
    $expected, $file = $line.Trim() -split '\s+'
    $tmp = New-TempDir
    $zip = Join-Path $tmp $file
    Invoke-WebRequest "$NodeDist/$file" -OutFile $zip -UseBasicParsing
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $expected.ToLower()) { Die 'il file di Node.js scaricato e'' danneggiato: riprova.' }
    Expand-Zip $zip $tmp
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $NodeDir
    Remove-Item $tmp -Recurse -Force
    if (-not (Test-Node)) { Die "Node.js non funziona dopo l'installazione." }
  }
  Say "Node.js $(& node -v) pronto."

  # ---------- Codice dell'app ----------
  Say "Scarico l'ultima versione dell'app da GitHub..."
  $tmp = New-TempDir
  $zip = Join-Path $tmp 'app.zip'
  Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip -UseBasicParsing
  Expand-Zip $zip $tmp
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1
  foreach ($item in Get-ChildItem $src.FullName -Force) {
    $target = Join-Path $Dest $item.Name
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Move-Item $item.FullName $target
  }
  Remove-Item $tmp -Recurse -Force

  Say "App installata in $Dest"
  Say 'Le prossime volte basta un doppio clic su Avvia-Windows.bat in quella cartella.'
  Set-Location $Dest
  & node scripts\avvia.mjs
}
