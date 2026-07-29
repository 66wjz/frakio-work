param([switch]$Rollback)
$ErrorActionPreference = "Stop"
$Repository = if ($env:FRAKIO_WORK_REPOSITORY) { $env:FRAKIO_WORK_REPOSITORY } else { "MadsGao/frakio-work" }
$InstallBase = if ($env:FRAKIO_WORK_INSTALL_BASE) { $env:FRAKIO_WORK_INSTALL_BASE } else { Join-Path $env:LOCALAPPDATA "Frakio Work Web" }
$DataHome = Join-Path $env:USERPROFILE ".frakio-work"
$Port = if ($env:PORT) { $env:PORT } else { "8787" }

if ($Rollback) {
  $Current = Join-Path $InstallBase "current"
  $Previous = Join-Path $InstallBase "previous"
  if (-not (Test-Path $Current) -or -not (Test-Path $Previous)) { throw "No previous Frakio Work Web version is available." }
  $CurrentTarget = (Get-Item $Current).Target
  $PreviousTarget = (Get-Item $Previous).Target
  Remove-Item $Current -Force
  Remove-Item $Previous -Force
  New-Item -ItemType Junction -Path $Current -Target $PreviousTarget | Out-Null
  New-Item -ItemType Junction -Path $Previous -Target $CurrentTarget | Out-Null
  schtasks /End /TN "Frakio Work Web" 2>$null | Out-Null
  schtasks /Run /TN "Frakio Work Web" | Out-Null
  Write-Host "Frakio Work Web rolled back to $(Split-Path $PreviousTarget -Leaf)."
  exit 0
}
$DetectedArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($DetectedArch -ne "X64") { throw "The Windows self-hosted package currently supports x64 only." }
$Arch = "x64"
$Platform = "win-$Arch"
$Release = if ($env:FRAKIO_WORK_VERSION) {
  $RequestedTag = $env:FRAKIO_WORK_VERSION.Trim()
  if (-not $RequestedTag.StartsWith("v")) { $RequestedTag = "v$RequestedTag" }
  Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/tags/$RequestedTag"
} else {
  Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/latest"
}
$Tag = $Release.tag_name
$Version = $Tag.TrimStart("v")
$Asset = "Frakio.Work.Web-$Version-$Platform.zip"
$ReleaseAsset = $Release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
if (-not $ReleaseAsset -or -not $ReleaseAsset.digest -or -not $ReleaseAsset.digest.StartsWith("sha256:")) { throw "Release metadata does not contain a SHA-256 digest for $Asset." }
$Expected = $ReleaseAsset.digest.Substring("sha256:".Length).ToLower()
$BaseUrl = "https://github.com/$Repository/releases/download/$Tag"
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("frakio-work-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Temp | Out-Null

try {
  Invoke-WebRequest "$BaseUrl/$Asset" -OutFile (Join-Path $Temp $Asset)
  $Actual = (Get-FileHash (Join-Path $Temp $Asset) -Algorithm SHA256).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "Frakio Work package checksum mismatch." }

  $Versions = Join-Path $InstallBase "versions"
  $Target = Join-Path $Versions $Version
  New-Item -ItemType Directory -Force $Versions | Out-Null
  $ExistingCommand = Join-Path $InstallBase "frakio-work.cmd"
  if (Test-Path $ExistingCommand) { & $ExistingCommand stop }
  if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
  Expand-Archive (Join-Path $Temp $Asset) $Versions -Force
  $Expanded = Join-Path $Versions "frakio-work"
  Move-Item $Expanded $Target

  $Current = Join-Path $InstallBase "current"
  $Previous = Join-Path $InstallBase "previous"
  if (Test-Path $Previous) { Remove-Item -Recurse -Force $Previous }
  if (Test-Path $Current) { Move-Item $Current $Previous }
  New-Item -ItemType Junction -Path $Current -Target $Target | Out-Null

  $Node = Get-ChildItem (Join-Path $Current "runtime\hermes") -Recurse -Filter node.exe | Where-Object { $_.FullName -like "*\$Platform\node\node.exe" } | Select-Object -First 1
  if (-not $Node) { throw "Bundled Node runtime is missing." }
  New-Item -ItemType Directory -Force (Join-Path $DataHome "logs") | Out-Null
  $Log = Join-Path $DataHome "logs\managed-web.log"
  $Launcher = Join-Path $InstallBase "run-managed-web.cmd"
  @"
@echo off
set FRAKIO_WORK_DEPLOYMENT_MODE=managed-web
set FRAKIO_WORK_PACKAGED=1
set FRAKIO_WORK_HOME=$DataHome
set FRAKIO_WORK_APP_ROOT=$Current
set FRAKIO_WORK_WEB_DIST=$Current\dist
set FRAKIO_WORK_RUNTIME_HOME=$Current\runtime
set PORT=$Port
"$($Node.FullName)" "$Current\apps\api\server.mjs" >> "$Log" 2>&1
"@ | Set-Content $Launcher -Encoding Ascii
  $Command = Join-Path $InstallBase "frakio-work.cmd"
  "@echo off`r`n`"$($Node.FullName)`" `"$Current\bin\frakio-work-service.mjs`" %*" | Set-Content $Command -Encoding Ascii
  schtasks /Delete /TN "Frakio Work Web" /F 2>$null | Out-Null
  schtasks /Create /TN "Frakio Work Web" /SC ONLOGON /TR "`"$Launcher`"" /F | Out-Null
  Start-Process $Launcher -WindowStyle Hidden
  Write-Host "Frakio Work $Version installed."
  Write-Host "Local URL: http://127.0.0.1:$Port"
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $Log) {
      $Match = Select-String -Path $Log -Pattern "administrator password: ([^\s]+)" | Select-Object -Last 1
      if ($Match) { Write-Host "Administrator password: $($Match.Matches[0].Groups[1].Value)"; break }
    }
  }
  Write-Host "Command: $Command"
} finally {
  Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}
