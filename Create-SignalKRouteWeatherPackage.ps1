param(
    [string]$ProjectDirectory = (Join-Path $PSScriptRoot 'incoming\signalk-route-weather'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'incoming\signalk-route-weather\package')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDirectory 'package.json') -PathType Leaf)) {
    throw "package.json not found in project directory: $ProjectDirectory"
}

$npm = Get-Command npm -ErrorAction Stop
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$manifest = Get-Content -Raw -LiteralPath (Join-Path $ProjectDirectory 'package.json') | ConvertFrom-Json
$expectedFile = Join-Path $OutputDirectory "$($manifest.name)-$($manifest.version).tgz"

Push-Location $ProjectDirectory
try {
    & $npm.Source pack --pack-destination $OutputDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "npm pack failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $expectedFile -PathType Leaf)) {
    throw "npm pack completed but the expected archive was not created: $expectedFile"
}

Write-Output "Created: $expectedFile"
$installer = Join-Path $OutputDirectory 'Install-SignalKRouteWeather.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-SignalKRouteWeather.ps1') -Destination $installer -Force
Write-Output "Installer: $installer"
