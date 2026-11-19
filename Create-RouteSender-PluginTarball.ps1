# Creates an OpenCPN Plugin Manager tarball from the verified Windows x86 build.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$packageDir = Join-Path $PSScriptRoot 'incoming\signalk-route-sender\package'
$version = '0.5.6'
$stageName = "SignalKRouteSender-v$version-msvc-wx32-10.0.26100-x86"
$stageDir = Join-Path $packageDir $stageName
$sourceDll = Join-Path $PSScriptRoot 'incoming\signalk-route-sender\build-win32\Release\signalk_route_sender_pi.dll'
$pluginDir = Join-Path $stageDir 'plugins'
$pluginDataDir = Join-Path $pluginDir 'signalk_route_sender_pi'
$targetDll = Join-Path $pluginDir 'signalk_route_sender_pi.dll'
$metadataPath = Join-Path $stageDir 'metadata.xml'
$helpFile = Join-Path $PSScriptRoot 'incoming\signalk-route-sender\assets\SignalKRouteSender_Hilfe_DE.txt'
$targetHelpFile = Join-Path $pluginDataDir 'SignalKRouteSender_Hilfe_DE.txt'
$tarballPath = Join-Path $packageDir "SignalKRouteSender-v$version`_msvc-wx32-10.0.26100-x86.tar.gz"

if (-not (Test-Path -LiteralPath $sourceDll)) {
    throw "Built plugin DLL not found: $sourceDll"
}
if (-not (Test-Path -LiteralPath $helpFile)) {
    throw "Plugin help file not found: $helpFile"
}

New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
New-Item -ItemType Directory -Force -Path $pluginDataDir | Out-Null
Copy-Item -LiteralPath $sourceDll -Destination $targetDll -Force
Copy-Item -LiteralPath $helpFile -Destination $targetHelpFile -Force

$metadata = @"
<?xml version="1.0" encoding="UTF-8"?>
<plugin version="1">
  <name>Signal K Route Sender</name>
  <version>v$version</version>
  <release>0</release>
  <summary>Send OpenCPN routes to Signal K</summary>
  <api-version>1.21</api-version>
  <open-source>yes</open-source>
  <author>Signal K Route Sender</author>
  <source></source>
  <info-url></info-url>
  <description>Transfers OpenCPN routes to Signal K.</description>
  <target>msvc-wx32</target>
  <target-version>10.0.26100</target-version>
  <target-arch>x86</target-arch>
  <tarball-url></tarball-url>
  <tarball-checksum></tarball-checksum>
</plugin>
"@
[IO.File]::WriteAllText($metadataPath, $metadata, [Text.UTF8Encoding]::new($false))

$tar = Get-Command 'tar.exe' -ErrorAction Stop
& $tar.Source -czf $tarballPath -C $packageDir $stageName
if ($LASTEXITCODE -ne 0) {
    throw "tar.exe failed to create the plugin package (exit code $LASTEXITCODE)."
}

Write-Host "Created OpenCPN Plugin Manager package: $tarballPath"
