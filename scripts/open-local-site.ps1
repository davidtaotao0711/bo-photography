param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4326/'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$astroPath = Join-Path $projectRoot 'node_modules\astro\astro.js'

function Test-BoDavidSite {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match 'Bo David'
  } catch {
    return $false
  }
}

if (-not (Test-BoDavidSite)) {
  if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $astroPath)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      'The local website could not start. Run npm install in the project first.',
      'Bo David Website'
    ) | Out-Null
    exit 1
  }

  $env:ASTRO_TELEMETRY_DISABLED = '1'
  Start-Process `
    -FilePath $nodePath `
    -ArgumentList @($astroPath, 'dev', '--host', '127.0.0.1', '--port', '4326', '--strictPort') `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-BoDavidSite) { break }
  }
}

if (-not (Test-BoDavidSite)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    'The local website did not become ready. Port 4326 may be occupied.',
    'Bo David Website'
  ) | Out-Null
  exit 1
}

if (-not $NoOpen) {
  Start-Process $url
}

Write-Output $url
