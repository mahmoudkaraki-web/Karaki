# Installs packages for one part of the family app without breaking the node_modules junction (18 Oct 2026).
# The repo sits in OneDrive; each part's node_modules is a junction to
# C:\dev\nm\Karaki APP\family-app\<part>\node_modules so OneDrive never syncs it.
# npm (install and ci alike) replaces a junction with a real folder, so the install runs in the
# C:\dev\nm folder itself and only package.json and package-lock.json travel back and forth.
#
#   .\scripts\npm-install.ps1 server                     install what server\package.json lists
#   .\scripts\npm-install.ps1 app some-package@1.2.3     add a package (any npm install arguments)
#   .\scripts\npm-install.ps1 app -Expo some-package     add it at the version Expo SDK 57 wants
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('server', 'app')][string]$Part,
  [switch]$Expo,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Packages
)
$ErrorActionPreference = 'Stop'
$repo = Join-Path (Split-Path $PSScriptRoot -Parent) $Part
$nmHome = Join-Path 'C:\dev\nm\Karaki APP\family-app' $Part
$link = Join-Path $repo 'node_modules'

New-Item -ItemType Directory -Force (Join-Path $nmHome 'node_modules') | Out-Null
$item = Get-Item $link -Force -ErrorAction SilentlyContinue
if ($item -and -not $item.LinkType) { throw "node_modules in $Part is a real folder, not the junction: move it to $nmHome and make the junction again" }
if (-not $item) { New-Item -ItemType Junction -Path $link -Target (Join-Path $nmHome 'node_modules') | Out-Null }

foreach ($f in 'package.json', 'package-lock.json') { if (Test-Path (Join-Path $repo $f)) { Copy-Item (Join-Path $repo $f) $nmHome -Force } }
Push-Location $nmHome
try {
  if ($Expo -and $Packages) {
    $known = Get-Content (Join-Path $nmHome 'node_modules\expo\bundledNativeModules.json') -Raw | ConvertFrom-Json
    $specs = @(foreach ($p in $Packages) { $v = $known.$p; if ($v) { "$p@$v" } else { $p } })
    & npm.cmd install @specs
  } elseif ($Packages) { & npm.cmd install @Packages } else { & npm.cmd install }
  if ($LASTEXITCODE -ne 0) { throw "npm failed ($LASTEXITCODE)" }
} finally { Pop-Location }
foreach ($f in 'package.json', 'package-lock.json') { Copy-Item (Join-Path $nmHome $f) $repo -Force }
if (-not (Get-Item $link -Force).LinkType) { throw 'the junction was replaced; move node_modules back to C:\dev\nm' }
"installed in $nmHome; the junction is intact"
