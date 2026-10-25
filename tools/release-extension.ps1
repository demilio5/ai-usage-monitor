param([switch]$Bump, [ValidateSet('patch', 'minor', 'major')][string]$ReleaseType = 'patch', [switch]$PrepareOnly, [string]$CredentialTarget, [string]$GitHubCli)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
. (Join-Path $PSScriptRoot 'mozilla-credentials.ps1')

function Run-Checked {
  param([string]$Executable, [string[]]$Arguments)
  $ErrorActionPreference = 'Continue'
  & $Executable @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
  if ($LASTEXITCODE -ne 0) { throw 'Release command failed; subsequent publication was stopped.' }
}

$localPath = Join-Path $root 'release.local.json'
$local = if (Test-Path -LiteralPath $localPath) { Get-Content -LiteralPath $localPath -Raw | ConvertFrom-Json } else { $null }
if (-not $CredentialTarget) { $CredentialTarget = if ($local.credentialTarget) { $local.credentialTarget } else { 'ai-usage-monitor-amo' } }
if (-not $GitHubCli) { $GitHubCli = if ($local.gitHubCli) { $local.gitHubCli } else { 'gh' } }

if (-not $PrepareOnly) {
  $dirty = & git status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit source changes before releasing.' }
  Run-Checked $GitHubCli @('api', 'user', '--jq', '.login')
}
if ($Bump) { Run-Checked 'node' @('scripts/prepare-version.mjs', $ReleaseType) }
Run-Checked 'npm.cmd' @('run', 'check')
Run-Checked 'npm.cmd' @('run', 'package')
Run-Checked 'npm.cmd' @('run', 'package:source')
if ($PrepareOnly) { Write-Host 'Release preparation passed; nothing was signed or published.'; exit 0 }
if ($Bump) {
  Run-Checked 'git' @('add', 'package.json', 'package-lock.json', 'CHANGELOG.json')
  $version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
  Run-Checked 'git' @('commit', '-m', "release: prepare $version")
}
Invoke-WithMozillaCredential -Target $CredentialTarget -Action {
  & node scripts/sign-mozilla.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Mozilla signing did not complete. Retry without -Bump; no update feed was published.' }
}
try {
  $env:AI_USAGE_GH_PATH = $GitHubCli
  Run-Checked 'node' @('scripts/publish-release.mjs')
} finally { Remove-Item Env:AI_USAGE_GH_PATH -ErrorAction SilentlyContinue }
