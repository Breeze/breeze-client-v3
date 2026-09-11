<#
.SYNOPSIS
  Runs Breeze's server-backed tests end to end: makes sure the test database exists,
  starts the .NET test server if it is not already running, runs the tests, and stops
  the server again.

.DESCRIPTION
  1. Checks that dotnet, sqlcmd and node are on PATH.
  2. Creates BreezeTestDb from breeze-server-v3\tests\Databases\BreezeTestDb.sql if it
     does not exist yet. (After that the test run itself rebuilds it before every run -
     see test/global-setup.ts - so it is always clean.)
  3. If a test server is already answering on http://localhost:34377 it is reused and left
     running. Otherwise one is started with `dotnet run`, and the script waits for it.
  4. Runs the chosen tier(s).
  5. Stops the server if this script started it (unless -KeepServer), and exits with the
     test result: 0 if every tier passed.

  The tests expect the server on port 34377 (test/test-fns.ts), so the port is fixed.

.PARAMETER Tier
  integration (default), browser, or all (integration, then browser).

.PARAMETER Filter
  Only run tests whose name matches, e.g. -Filter "nullable dateTime".

.PARAMETER ServerRepo
  Path to the breeze-server-v3 checkout. Defaults to a sibling of this repo.

.PARAMETER SqlInstance
  SQL Server instance, passed to sqlcmd -S. Defaults to "." (the local default instance).

.PARAMETER KeepServer
  Leave a server this script started running afterwards, for quicker re-runs.

.PARAMETER SkipDbReset
  Skip the database rebuild at the start of the test run. Faster when re-running one
  test, but the database then carries whatever the last run left behind.

.EXAMPLE
  .\scripts\test-with-server.ps1

.EXAMPLE
  .\scripts\test-with-server.ps1 -Tier all

.EXAMPLE
  .\scripts\test-with-server.ps1 -Filter "nullable dateTime" -KeepServer -SkipDbReset
#>
[CmdletBinding()]
param(
  [ValidateSet('integration', 'browser', 'all')]
  [string] $Tier = 'integration',
  [string] $Filter,
  [string] $ServerRepo,
  [string] $SqlInstance = '.',
  [switch] $KeepServer,
  [switch] $SkipDbReset,
  [int] $StartupTimeoutSeconds = 180
)

# Written for Windows PowerShell 5.1 as well as PowerShell 7: no ?? / && / ternaries.
$ErrorActionPreference = 'Stop'

$Url = 'http://localhost:34377'
$Database = 'BreezeTestDb'
$clientRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $ServerRepo) {
  $ServerRepo = Join-Path (Split-Path $clientRepo -Parent) 'breeze-server-v3'
}

function Write-Step([string] $message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Assert-Command([string] $name, [string] $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "'$name' was not found on PATH. $hint"
  }
}

function Test-ServerUp {
  try {
    $response = Invoke-WebRequest -Uri "$Url/breeze/NorthwindIBModel/Metadata" -UseBasicParsing -TimeoutSec 3
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Test-ProcessAlive([int] $id) {
  return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
}

function Invoke-Sql([string[]] $sqlArgs) {
  # -b: fail on SQL errors. -f 65001 is not optional: the script is UTF-8, and without it
  # sqlcmd reads it as the ANSI code page and silently corrupts every accented character.
  & sqlcmd -S $SqlInstance -E -b -f 65001 @sqlArgs
  if ($LASTEXITCODE -ne 0) { throw "sqlcmd failed (exit $LASTEXITCODE)." }
}

$serverPid = $null
$serverLog = Join-Path ([IO.Path]::GetTempPath()) 'breeze-test-server.log'
$failedTiers = @()

try {
  # --- 1. prerequisites -------------------------------------------------------------------
  Write-Step "Checking prerequisites"
  Assert-Command 'node' 'Install Node 20 or later.'
  Assert-Command 'dotnet' 'Install the .NET 10 SDK.'
  Assert-Command 'sqlcmd' 'Install the SQL Server command-line tools.'
  $serverProject = Join-Path $ServerRepo 'tests\Test.AspNetCore.EFCore\Test.AspNetCore.EFCore.csproj'
  $dbScript = Join-Path $ServerRepo 'tests\Databases\BreezeTestDb.sql'
  if (-not (Test-Path $serverProject)) {
    throw "Test server project not found at $serverProject. Pass -ServerRepo <path to breeze-server-v3>."
  }
  $vitest = Join-Path $clientRepo 'node_modules\vitest\vitest.mjs'
  if (-not (Test-Path $vitest)) {
    throw "Vitest is not installed. Run 'npm install' in $clientRepo first."
  }
  Write-Host "client repo: $clientRepo"
  Write-Host "server repo: $ServerRepo"

  # --- 2. database --------------------------------------------------------------------------
  Write-Step "Checking database $Database on '$SqlInstance'"
  $exists = & sqlcmd -S $SqlInstance -E -b -h -1 -W -Q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID('$Database') IS NULL THEN 0 ELSE 1 END"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not connect to SQL Server '$SqlInstance'. Is it running? Pass -SqlInstance if it is not the default instance."
  }
  if ((($exists | Out-String).Trim()) -eq '0') {
    Write-Host "$Database does not exist yet - creating it from $dbScript"
    Invoke-Sql @('-Q', "CREATE DATABASE [$Database]")
    Invoke-Sql @('-d', $Database, '-i', $dbScript)
    Write-Host "created."
  } else {
    Write-Host "exists."
  }

  # --- 3. server ----------------------------------------------------------------------------
  Write-Step "Test server on $Url"
  if (Test-ServerUp) {
    Write-Host "already running - reusing it, and leaving it running afterwards."
  } else {
    Write-Host "starting: dotnet run (log: $serverLog)"
    # Win32_Process.Create rather than Start-Process: it starts the server fully detached,
    # inheriting none of this script's handles. With Start-Process the server inherited the
    # script's stdout, so anyone piping this script's output (Tee-Object, CI) waited until
    # the server exited - for ever, with -KeepServer.
    $cmdLine = "cmd.exe /d /c dotnet run --project `"$serverProject`" --no-launch-profile --urls $Url > `"$serverLog`" 2>&1"
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine = $cmdLine
      CurrentDirectory = $clientRepo
      ProcessStartupInformation = $startup
    }
    if ($created.ReturnValue -ne 0) {
      throw "Could not start the test server (Win32_Process.Create returned $($created.ReturnValue))."
    }
    $serverPid = [int]$created.ProcessId

    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while (-not (Test-ServerUp)) {
      if (-not (Test-ProcessAlive $serverPid)) {
        Write-Host "--- last lines of the server log ---"
        Get-Content $serverLog -Tail 30 -ErrorAction SilentlyContinue
        $serverPid = $null
        throw "The test server exited during startup. See $serverLog."
      }
      if ((Get-Date) -gt $deadline) {
        throw "The test server did not answer within $StartupTimeoutSeconds seconds. See $serverLog."
      }
      Start-Sleep -Seconds 1
    }
    Write-Host "ready."
  }

  # --- 4. tests -----------------------------------------------------------------------------
  $env:BREEZE_TEST_SERVER = $Url
  $env:BREEZE_TEST_DB = $Database
  $env:BREEZE_SQL_INSTANCE = $SqlInstance
  $env:BREEZE_TEST_DB_SCRIPT = $dbScript
  if ($SkipDbReset) { $env:BREEZE_SKIP_DB_RESET = '1' } else { Remove-Item Env:BREEZE_SKIP_DB_RESET -ErrorAction SilentlyContinue }

  $tiers = if ($Tier -eq 'all') { @('integration', 'browser') } else { @($Tier) }
  Push-Location $clientRepo
  try {
    foreach ($t in $tiers) {
      Write-Step "Running the $t tier"
      # node + vitest.mjs rather than npm/npx: those are .cmd shims, and cmd would split a
      # -Filter value containing spaces.
      $vitestArgs = @($vitest, 'run', '--config', "vitest.$t.config.ts")
      if ($Filter) { $vitestArgs += @('-t', $Filter) }
      if ($Filter) {
        # Vitest exits 0 when -t matches nothing - every test is simply skipped - so a
        # mistyped filter would look like a pass. Keep a copy of the output to check.
        $out = Join-Path ([IO.Path]::GetTempPath()) "breeze-vitest-$t.log"
        if (-not $env:NO_COLOR) { $env:FORCE_COLOR = '1' }   # keep colours when piped, unless the user opted out
        & node @vitestArgs | Tee-Object -FilePath $out
        $code = $LASTEXITCODE
        $esc = [char]27
        $text = (Get-Content $out -Raw) -replace "$esc\[[0-9;]*m", ''
        $summaries = [regex]::Matches($text, 'Tests\s+([^\r\n]*)')
        $summary = if ($summaries.Count -gt 0) { $summaries[$summaries.Count - 1].Groups[1].Value } else { '' }
        if ($code -eq 0 -and $summary -notmatch '\d+ passed') {
          Write-Host "No test in the $t tier matched -Filter '$Filter'." -ForegroundColor Yellow
          $code = 1
        }
      } else {
        & node @vitestArgs
        $code = $LASTEXITCODE
      }
      if ($code -ne 0) { $failedTiers += $t }
    }
  } finally {
    Pop-Location
  }
}
finally {
  # --- 5. clean up --------------------------------------------------------------------------
  if ($serverPid -and (Test-ProcessAlive $serverPid)) {
    if ($KeepServer) {
      Write-Step "Leaving the test server running. Stop it with: taskkill /PID $serverPid /T /F"
    } else {
      Write-Step "Stopping the test server"
      # /T: the server is cmd -> dotnet run -> the test host; stopping only the top process
      # would leave the test host listening on the port.
      & taskkill /PID $serverPid /T /F *> $null
    }
  }
}

Write-Host ""
if ($failedTiers.Count -gt 0) {
  Write-Host "FAILED: $($failedTiers -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "All requested tiers passed." -ForegroundColor Green
exit 0
