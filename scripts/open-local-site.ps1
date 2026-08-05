param(
  [switch]$NoOpen
)

$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4326/'
$healthUrl = 'http://127.0.0.1:4326/__editor/health'
$requiredEditorApiVersion = 7
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

function Test-BoDavidEditorApi {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
    return [int]$response.editorApiVersion -eq $requiredEditorApiVersion
  } catch {
    return $false
  }
}

function Stop-StaleBoDavidSite {
  $listenerProcessId = 0
  $listenerLines = netstat -ano | Select-String ':4326\s'
  foreach ($line in $listenerLines) {
    if ($line.Line -match '^\s*TCP\s+127\.0\.0\.1:4326\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      $listenerProcessId = [int]$Matches[1]
      break
    }
  }
  if ($listenerProcessId -gt 0) {
    Stop-Process -Id $listenerProcessId -Force
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      Start-Sleep -Milliseconds 150
      if (-not (Test-BoDavidSite)) { break }
    }
  }
}

$siteIsReady = Test-BoDavidSite
if ($siteIsReady -and -not (Test-BoDavidEditorApi)) {
  Stop-StaleBoDavidSite
  $siteIsReady = $false
}

if (-not $siteIsReady) {
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

if (-not (Test-BoDavidSite) -or -not (Test-BoDavidEditorApi)) {
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
