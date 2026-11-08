#requires -Version 7.0
<#
Preparation/transport only: this does NOT certify the plan's live acceptance matrix.
Use primary/subagent prompts in the owned TUIs to exercise deliberate writes, isolation,
shared reads, idle/manual/restart/races, conflicts, capacity and tool denial. Retain evidence.
Credentials: by default supply a provider key through a caller/user environment variable
(default Z_AI_API_KEY); configs contain only {env:...}, never its value. Alternatively,
-UseAuthJson explicitly copies ~/.local/share/opencode/auth.json into each isolated data
root; Cleanup removes these copies. Protect the run directory and clean up after failures.
No production DB access or login automation. Other DB-only credentials remain a blocker.
The psmux child must see that variable too; an older psmux server may not inherit it.
Capture is best-effort redacted: review artifacts before sharing. Never type secrets in TUI.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('Validate', 'Prepare', 'Launch', 'Capture', 'Cleanup')]
  [string]$Action = 'Validate',
  [string]$RunRoot,
  [switch]$DryRun,
  [switch]$PreflightVerified,
  [ValidateSet('all', 'opf18', 'opf2x')]
  [string]$Runtime = 'all',
  [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')]
  [string]$ProviderId = 'zai-coding-plan',
  [AllowEmptyString()]
  [string]$CredentialEnv = 'Z_AI_API_KEY',
  [switch]$UseAuthJson,
  [ValidatePattern('^[^\s/]+\/[^\s]+$')]
  [string]$Model = 'zai-coding-plan/glm-5.3-flash',
  [ValidateSet('', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')]
  [string]$Reasoning = '',
  [ValidateRange(0.001, 0.1)]
  [double]$IntervalHours = 0.01
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'Temp/opencode'
$plugin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../src/plugin.js'))
$v1Root = 'C:/Users/alvins/Documents/git/opencode-v1.18.5/packages/opencode'
$v2Exe = 'C:/Users/alvins/Documents/git/opencode-v2.2.5/packages/cli/dist/cli-windows-x64/bin/opencode.exe'
$bun = (Get-Command bun -CommandType Application -ErrorAction Stop).Source
$mux = (Get-Command psmux -CommandType Application -ErrorAction Stop).Source
foreach ($file in @((Join-Path $v1Root 'src/index.ts'), $v2Exe)) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed runtime: $file" }
}
$bunVersion = (& $bun --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $bunVersion -ne '1.3.14') { throw 'opf18 requires verified Bun 1.3.14' }
# Inspect binary bytes, not an unpinned runtime invocation (even --version).
$exeHash = (Get-FileHash -LiteralPath $v2Exe -Algorithm SHA256).Hash
if (!$RunRoot) { $RunRoot = Join-Path $base ('continuity-' + [guid]::NewGuid().ToString('N')) }
$RunRoot = [IO.Path]::GetFullPath($RunRoot)
$parent = [IO.Path]::GetFullPath((Split-Path $RunRoot -Parent))
$leaf = Split-Path $RunRoot -Leaf
if ($parent -ne [IO.Path]::GetFullPath($base) -or $leaf -notmatch '^continuity-([a-f0-9]{32})$') {
  throw 'RunRoot must be a direct continuity-<32 lowercase GUID hex> child of LocalAppData/Temp/opencode'
}
$id = $Matches[1]
# Reject junction/symlink redirection on every existing ancestor.
$ancestor = $RunRoot
while ($ancestor) {
  if (Test-Path -LiteralPath $ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Reparse-point path refused: $ancestor"
    }
  }
  $ancestor = Split-Path $ancestor -Parent
}
function Quote-PS([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }
function Git-Run {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & git @Arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Test repository setup failed' }
}
function Mux-Run {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  $result = & $mux @Arguments
  if ($LASTEXITCODE -ne 0) { throw "psmux action failed: $($Arguments[0])" }
  return $result
}
$manifestPath = Join-Path $RunRoot 'owner.json'
$rows = foreach ($targetRuntime in @('opf18', 'opf2x')) {
  if ($Runtime -ne 'all' -and $Runtime -ne $targetRuntime) { continue }
  foreach ($checkout in @('a', 'a-peer', 'b')) {
    [pscustomobject]@{
      Runtime = $targetRuntime; Checkout = $checkout
      Session = "continuity-$id-$targetRuntime-$checkout"
      Database = Join-Path $RunRoot "$targetRuntime/database/continuity.db"
      Config = Join-Path $RunRoot "$targetRuntime/config/opencode"
      Workspace = Join-Path $RunRoot "repo-$checkout"
      Runner = Join-Path $RunRoot "$targetRuntime-$checkout.ps1"
    }
  }
}
if ($Action -eq 'Validate' -or $DryRun -or $WhatIfPreference) {
  [pscustomobject]@{
    Action = $Action; RunRoot = $RunRoot; Bun = $bun; BunVersion = $bunVersion
    Opf18Source = Join-Path $v1Root 'src/index.ts'; Opf2xExecutable = $v2Exe
    Opf2xSHA256 = $exeHash; Plugin = $plugin; PluginPresent = (Test-Path $plugin)
    Credentials = $(if ($UseAuthJson) { 'Copy auth.json into isolated data roots; Cleanup removes copies' } else { "Environment reference only: $CredentialEnv; DB-only auth blocks live generation" })
    LaunchBlockedUntil = 'Adapter/preflight verification and provider/model access confirmation'
  } | Format-List
  $rows | Format-Table Runtime, Checkout, Session, Database, Config -Wrap
  return
}
if ($Action -eq 'Prepare') {
  if (Test-Path -LiteralPath $RunRoot) { throw 'Prepare requires a new run directory' }
  if (!$PSCmdlet.ShouldProcess($RunRoot, 'Prepare isolated live harness')) { return }
  New-Item -ItemType Directory -Path $RunRoot | Out-Null
  @{ id = $id; root = $RunRoot; credentialEnv = $CredentialEnv; useAuthJson = [bool]$UseAuthJson; created = [DateTime]::UtcNow.ToString('o'); opf2xSHA256 = $exeHash } |
    ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Git-Run @('init', '--initial-branch=branch-a', (Join-Path $RunRoot 'repo-a'))
  Git-Run @('-C', (Join-Path $RunRoot 'repo-a'), '-c', 'user.name=Continuity Harness', '-c', 'user.email=continuity@example.invalid', 'commit', '--allow-empty', '-m', 'Test-owned baseline')
  Git-Run @('-C', (Join-Path $RunRoot 'repo-a'), 'worktree', 'add', '--force', (Join-Path $RunRoot 'repo-a-peer'), 'branch-a')
  Git-Run @('-C', (Join-Path $RunRoot 'repo-a'), 'worktree', 'add', '-b', 'branch-b', (Join-Path $RunRoot 'repo-b'))
  foreach ($runtime in @('opf18', 'opf2x')) {
    $root = Join-Path $RunRoot $runtime
    foreach ($dir in @('config/opencode', 'data', 'state', 'cache', 'database')) {
      New-Item -ItemType Directory -Path (Join-Path $root $dir) -Force | Out-Null
    }
    # Native v2 uses settings; v1 uses options. Keep built-in endpoints (no guessed URL).
    # V2 loads plugin directories (package.json exports), never single plugin files.
    # -UseAuthJson: no env apiKey block; copy the user's auth.json into the isolated data
    # root (V1 reads it natively) instead of passing secret values through this harness.
    $provider = if ($UseAuthJson) { @{} }
    elseif ($runtime -eq 'opf18') { @{ options = @{ apiKey = "{env:$CredentialEnv}" } } }
    else { @{ settings = @{ apiKey = "{env:$CredentialEnv}" } } }
    if ($UseAuthJson) {
      $sourceAuth = Join-Path $env:USERPROFILE '.local/share/opencode/auth.json'
      if (!(Test-Path -LiteralPath $sourceAuth -PathType Leaf)) { throw '-UseAuthJson: no ~/.local/share/opencode/auth.json' }
      $targetData = Join-Path $root 'data/opencode'
      New-Item -ItemType Directory -Path $targetData -Force | Out-Null
      Copy-Item -LiteralPath $sourceAuth -Destination (Join-Path $targetData 'auth.json') -Force
    }
    $pluginEntry = if ($runtime -eq 'opf18') { @(([uri]$plugin).AbsoluteUri) } else { @((Split-Path (Split-Path $plugin -Parent) -Parent)) }
    # ConvertTo-Json collapses single-element arrays and mangles trailing braces; assemble and verify manually.
    $pluginJson = '[' + (($pluginEntry | ForEach-Object { '"' + ($_ -replace '\\', '\\' -replace '"', '\"') + '"' }) -join ',') + ']'
    $pluginKey = if ($runtime -eq 'opf18') { 'plugin' } else { 'plugins' }
    $configJson = (@{ model = $Model; provider = @{ $ProviderId = $provider } } | ConvertTo-Json -Depth 8)
    $configJson = $configJson.TrimEnd().TrimEnd('}').TrimEnd() + ",`n  `"$pluginKey`": $pluginJson`n}"
    $null = $configJson | ConvertFrom-Json # self-check: refuse to write invalid config
    $configJson | Set-Content (Join-Path $root 'config/opencode/opencode.json') -Encoding utf8
    $distill = @{ model = $Model; intervalHours = $IntervalHours }
    if ($Reasoning) { $distill.reasoning = $Reasoning }
    @{ distillation = $distill } |
      ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'config/opencode/continuity.jsonc') -Encoding utf8
  }
  foreach ($row in $rows) {
    $root = Join-Path $RunRoot $row.Runtime
    $launch = if ($row.Runtime -eq 'opf18') {
      "& $(Quote-PS $bun) run --cwd $(Quote-PS $v1Root) --conditions=browser ./src/index.ts $(Quote-PS $row.Workspace)"
    } else { "& $(Quote-PS $v2Exe) --standalone $(Quote-PS $row.Workspace)" }
    $runner = @(
      "`$ErrorActionPreference = 'Stop'"
      # Discard inherited config injections/remote targets, not provider key variables.
      "foreach (`$name in @('OPENCODE_CONFIG','OPENCODE_CONFIG_CONTENT','OPENCODE_SERVER_URL','OPENCODE_ATTACH')) { Remove-Item env:`$name -ErrorAction SilentlyContinue }"
      "`$env:OPENCODE_DB = $(Quote-PS $row.Database)"
      "`$env:OPENCODE_CONFIG_DIR = $(Quote-PS $row.Config)"
      "`$env:OPENCODE_TEST_HOME = $(Quote-PS (Join-Path $root 'home'))"
      "`$env:HOME = $(Quote-PS (Join-Path $root 'home'))"
      "`$env:USERPROFILE = $(Quote-PS (Join-Path $root 'home'))"
      "`$env:XDG_CONFIG_HOME = $(Quote-PS (Join-Path $root 'config'))"
      "`$env:XDG_DATA_HOME = $(Quote-PS (Join-Path $root 'data'))"
      "`$env:XDG_STATE_HOME = $(Quote-PS (Join-Path $root 'state'))"
      "`$env:XDG_CACHE_HOME = $(Quote-PS (Join-Path $root 'cache'))"
      # Auth-file mode does not require or explicitly propagate an environment key.
      $(if (!$UseAuthJson -and $CredentialEnv) {
        @(
          "`$key = [Environment]::GetEnvironmentVariable($(Quote-PS $CredentialEnv), 'Process')",
          "if (!`$key) { `$key = [Environment]::GetEnvironmentVariable($(Quote-PS $CredentialEnv), 'User') }",
          "if (!`$key) { throw 'Provider key unavailable in psmux child; no login automation or DB import permitted' }",
          "[Environment]::SetEnvironmentVariable($(Quote-PS $CredentialEnv), `$key, 'Process'); `$key = `$null"
        )
      } else { @() })
      "Set-Location -LiteralPath $(Quote-PS $row.Workspace)"
      "Write-Host 'TEST-OWNED DB/config pinned; credential values omitted.'"
      $launch
      'exit $LASTEXITCODE'
    )
    $runner | Set-Content -LiteralPath $row.Runner -Encoding utf8
  }
  Write-Output "Prepared $RunRoot (no sessions launched). Use this exact RunRoot for later actions."
  return
}
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Missing ownership manifest' }
$owner = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($owner.id -ne $id -or $owner.root -ne $RunRoot) { throw 'Ownership manifest mismatch' }
if ($Action -eq 'Launch') {
  if (!$PreflightVerified) { throw 'Launch blocked: supply -PreflightVerified only after all adapter/DB/permission/model gates pass' }
  if (!(Test-Path -LiteralPath $plugin -PathType Leaf)) { throw 'Plugin is not implemented yet' }
  if ($owner.opf2xSHA256 -ne $exeHash) { throw 'opf2x executable changed since preparation; revalidate' }
  foreach ($row in $rows) {
    if ($PSCmdlet.ShouldProcess($row.Session, 'Launch test-owned TUI; may incur model charges')) {
      # XDG alone does not isolate ~/.opencode discovery (v1 ConfigPaths.directories).
      $homePath = Join-Path $RunRoot "$($row.Runtime)/home"
      New-Item -ItemType Directory -Path $homePath -Force | Out-Null
      $runnerText = Get-Content -LiteralPath $row.Runner -Raw
      if (!$runnerText.Contains('OPENCODE_TEST_HOME')) {
        ("`$env:OPENCODE_TEST_HOME = $(Quote-PS $homePath)`n" + $runnerText) |
          Set-Content -LiteralPath $row.Runner -Encoding utf8
      }
      # The built v2 config discovery also uses os.homedir(), not only Global.Path.home.
      $runnerText = Get-Content -LiteralPath $row.Runner -Raw
      if (!$runnerText.Contains('env:USERPROFILE')) {
        ("`$env:HOME = $(Quote-PS $homePath)`n`$env:USERPROFILE = $(Quote-PS $homePath)`n" + $runnerText) |
          Set-Content -LiteralPath $row.Runner -Encoding utf8
      }
      $runnerText = Get-Content -LiteralPath $row.Runner -Raw
      if ($row.Runtime -eq 'opf2x' -and !($owner.PSObject.Properties['useAuthJson'] -and $owner.useAuthJson) -and $owner.credentialEnv -eq 'Z_AI_API_KEY' -and !$runnerText.Contains('env:ZAI_API_KEY')) {
        # Native ZAICodingPlan AuthOptions.bearer expects ZAI_API_KEY; never serialize its value.
        $runnerText.Replace('Set-Location -LiteralPath',
          "`$env:ZAI_API_KEY = [Environment]::GetEnvironmentVariable($(Quote-PS $owner.credentialEnv), 'Process')`nSet-Location -LiteralPath") |
          Set-Content -LiteralPath $row.Runner -Encoding utf8
      }
      # Pass only a runner path through psmux; never serialize provider secrets.
      Mux-Run @('new-session', '-d', '-s', $row.Session, '-c', $row.Workspace, '-n', 'tui',
        "pwsh -NoProfile -File `"$($row.Runner)`"") | Out-Null
    }
  }
} elseif ($Action -eq 'Capture') {
  foreach ($row in $rows) {
    if ($PSCmdlet.ShouldProcess($row.Session, 'Capture redacted test-owned pane')) {
      $text = (Mux-Run @('capture-pane', '-p', '-S', '-500', '-t', "$($row.Session):tui") | Out-String)
      $text = $text -replace '(?im)^.*(?:api.?key|authorization|bearer|password|secret|access.?token|refresh.?token).*$','[credential-bearing line omitted]'
      foreach ($name in @($owner.credentialEnv, 'ZAI_API_KEY', 'Z_AI_API_KEY', 'OPENCODE_SERVER_PASSWORD')) {
        foreach ($scope in @('Process', 'User')) {
          $value = [Environment]::GetEnvironmentVariable($name, $scope)
          if ($value) { $text = $text.Replace($value, '[REDACTED]') }
        }
      }
      $text | Set-Content -LiteralPath (Join-Path $RunRoot "$($row.Runtime)-$($row.Checkout)-capture.txt") -Encoding utf8
    }
  }
} elseif ($Action -eq 'Cleanup') {
  # Exact manifest-derived names only. Never kill-server, wildcard-kill, delete databases,
  # or remove the repository: retain evidence and recovery files for operator inspection.
  $existing = @(& $mux list-sessions -F '#{session_name}' 2>$null)
  foreach ($row in $rows) {
    if ($existing -contains $row.Session -and $PSCmdlet.ShouldProcess($row.Session, 'Stop test-owned session')) {
      Mux-Run @('kill-session', '-t', $row.Session) | Out-Null
    }
  }
  # Copied credentials never outlive the run, even if -UseAuthJson was not used this time.
  foreach ($auth in @(Get-ChildItem -LiteralPath $RunRoot -Recurse -Filter 'auth.json' -File -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess($auth.FullName, 'Delete copied credential file')) { Remove-Item -LiteralPath $auth.FullName -Force }
  }
  Write-Output "Owned sessions stopped; evidence/database files retained at $RunRoot."
}
