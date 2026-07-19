$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4321/editor'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$astroPath = Join-Path $projectRoot 'node_modules\astro\astro.js'

function Test-Editor {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Editor)) {
  if (-not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $astroPath)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      'The local editor could not start. Run npm install in the project first.',
      'Bo David Editor'
    ) | Out-Null
    exit 1
  }

  $env:ASTRO_TELEMETRY_DISABLED = '1'
  Start-Process -FilePath $nodePath -ArgumentList @($astroPath, 'dev', '--host', '127.0.0.1', '--port', '4321', '--strictPort') -WorkingDirectory $projectRoot -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-Editor) { break }
  }
}

if (-not (Test-Editor)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    'The local editor did not become ready. Port 4321 may be occupied.',
    'Bo David Editor'
  ) | Out-Null
  exit 1
}

Start-Process $url
