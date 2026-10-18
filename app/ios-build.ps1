# Builds Karaki for iPhone in Expo's cloud and sends it to TestFlight (18 Oct 2026),
# the same way as the S² guest app and Q&I, with the same App Store Connect API key (no Apple sign in).
# The key file stays in s2-guest-app\Keys (ignored by git there); only its PATH is passed,
# its content is never read here.
#
#   .\ios-build.ps1             build and send to TestFlight
#   .\ios-build.ps1 -NoSubmit   build only
param([switch]$NoSubmit)
Set-Location $PSScriptRoot
$ErrorActionPreference = 'Stop'
$env:EXPO_ASC_API_KEY_PATH = 'C:\Users\mahmo\OneDrive - Be Smart Me\BeSmart APPs - BeSmart APPs\s2-guest-app\Keys\AuthKey_ZNP8WSPSSW.p8'
$env:EXPO_ASC_KEY_ID = "ZNP8WSPSSW"
$env:EXPO_ASC_ISSUER_ID = "18b6239d-cad3-4791-8b97-452594119296"
$env:EXPO_APPLE_TEAM_ID = "5TV89KGJVR"
$env:EXPO_APPLE_TEAM_TYPE = "COMPANY_OR_ORGANIZATION"
$env:EAS_BUILD_NO_EXPO_GO_WARNING = "true"
# Apple's API refuses Expo's capability patch (the S² lesson); Sign in with Apple and Push
# Notifications are ticked by hand on the com.besmart.karaki identifier
$env:EXPO_NO_CAPABILITY_SYNC = "1"

if (-not (Test-Path $env:EXPO_ASC_API_KEY_PATH)) { throw "The App Store Connect key is not at $($env:EXPO_ASC_API_KEY_PATH)" }

# the very first time: link this folder to a project on expo.dev (writes extra.eas.projectId into app.json)
$app = Get-Content app.json -Raw | ConvertFrom-Json
if (-not ($app.expo.extra -and $app.expo.extra.eas -and $app.expo.extra.eas.projectId)) {
  npx eas-cli@latest init --non-interactive --force
}

if ($NoSubmit) { npx eas-cli@latest build --platform ios --profile production --non-interactive }
else { npx eas-cli@latest build --platform ios --profile production --non-interactive --auto-submit }
