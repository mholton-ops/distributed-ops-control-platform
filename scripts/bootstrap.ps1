param(
    [switch]$Build,
    [switch]$SeedDemoData,
    [switch]$Stop,
    [switch]$ResetTestData,
    [string]$ConfirmDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Compose {
    param([string[]]$Arguments)

    & docker compose @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function New-HexSecret {
    param([int]$ByteCount = 32)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found in PATH."
}

if (($SeedDemoData -or $ResetTestData) -and $ConfirmDatabase -ne "ops_control_test") {
    throw "Demo seeding or test-volume reset requires -ConfirmDatabase ops_control_test."
}
if (-not $SeedDemoData -and -not $ResetTestData -and $ConfirmDatabase) {
    throw "-ConfirmDatabase is only valid with -SeedDemoData or -ResetTestData."
}
if ($Stop -and ($Build -or $SeedDemoData -or $ResetTestData -or $ConfirmDatabase)) {
    throw "-Stop cannot be combined with build or seed options."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
    $generatedAuthToken = -not $env:OPS_TEST_AUTH_TOKEN
    $generatedStopAdminPassword = $false
    $generatedStopAppPassword = $false
    $generatedStopActor = $false
    $generatedComposeDatabaseUrl = -not $env:COMPOSE_DATABASE_URL

    if (-not $env:OPS_TEST_AUTH_TOKEN) {
        $env:OPS_TEST_AUTH_TOKEN = New-HexSecret
    }
    elseif ($env:OPS_TEST_AUTH_TOKEN.Length -lt 32) {
        throw "OPS_TEST_AUTH_TOKEN must contain at least 32 characters."
    }

    if ($Stop -and -not $env:OPS_TEST_ACTOR) {
        $env:OPS_TEST_ACTOR = "stop-only-operator"
        $generatedStopActor = $true
    }
    elseif (-not $Stop -and -not $env:OPS_TEST_ACTOR) {
        throw "OPS_TEST_ACTOR must be supplied as an explicit non-secret test audit identity."
    }

    if ($Stop -and -not $env:POSTGRES_ADMIN_PASSWORD) {
        $env:POSTGRES_ADMIN_PASSWORD = New-HexSecret
        $generatedStopAdminPassword = $true
    }
    if ($Stop -and -not $env:OPS_TEST_DB_PASSWORD) {
        $env:OPS_TEST_DB_PASSWORD = New-HexSecret
        $generatedStopAppPassword = $true
    }

    if (-not $Stop -and -not $env:POSTGRES_ADMIN_PASSWORD) {
        throw "POSTGRES_ADMIN_PASSWORD must be supplied through the approved runtime/vault workflow for disposable cluster initialization."
    }
    if (-not $Stop -and $env:POSTGRES_ADMIN_PASSWORD.Length -lt 24) {
        throw "POSTGRES_ADMIN_PASSWORD must contain at least 24 characters."
    }
    if (-not $Stop -and -not $env:OPS_TEST_DB_PASSWORD) {
        throw "OPS_TEST_DB_PASSWORD must be supplied through the approved runtime/vault workflow for the restricted app role."
    }
    if (-not $Stop -and $env:OPS_TEST_DB_PASSWORD.Length -lt 24) {
        throw "OPS_TEST_DB_PASSWORD must contain at least 24 characters."
    }
    if (-not $Stop -and $env:POSTGRES_ADMIN_PASSWORD -ceq $env:OPS_TEST_DB_PASSWORD) {
        throw "POSTGRES_ADMIN_PASSWORD and OPS_TEST_DB_PASSWORD must be different values."
    }

    if ($generatedComposeDatabaseUrl) {
        $encodedPassword = [System.Uri]::EscapeDataString($env:OPS_TEST_DB_PASSWORD)
        $env:COMPOSE_DATABASE_URL = "postgresql://ops_test:$encodedPassword@postgres:5432/ops_control_test"
    }

    if ($Stop) {
        Write-Host "Stopping the disposable test stack..."
        Invoke-Compose -Arguments @("down", "--remove-orphans")
        return
    }

    if ($ResetTestData) {
        Write-Host "Resetting the explicitly disposable PostgreSQL test volume..."
        Invoke-Compose -Arguments @("down", "--volumes", "--remove-orphans")
    }
    else {
        Invoke-Compose -Arguments @("down", "--remove-orphans")
    }

    $buildArguments = @("build")
    if ($Build) {
        $buildArguments += "--pull"
    }
    $buildArguments += @("api", "web")

    Write-Host "Building locked Node 24 test images..."
    Invoke-Compose -Arguments $buildArguments

    Write-Host "Starting the loopback-only PostgreSQL test service..."
    Invoke-Compose -Arguments @("up", "-d", "--wait", "postgres")

    Write-Host "Applying migrations to ops_control_test..."
    Invoke-Compose -Arguments @("run", "--rm", "--no-deps", "api", "npm", "run", "db:migrate")

    if ($SeedDemoData) {
        Write-Host "Loading explicitly confirmed demo data into ops_control_test..."
        Invoke-Compose -Arguments @(
            "run",
            "--rm",
            "--no-deps",
            "-e",
            "OPS_ALLOW_DEMO_SEED=ops_control_test",
            "api",
            "npm",
            "run",
            "seed"
        )
    }

    Write-Host "Starting the loopback-only API and web test services..."
    Invoke-Compose -Arguments @("up", "-d", "--wait", "api", "web")
    Invoke-Compose -Arguments @("ps")

    Write-Host "Test UI: http://127.0.0.1:3000"
    Write-Host "Test API health: http://127.0.0.1:4000/health"
}
finally {
    if ($generatedAuthToken) {
        Remove-Item Env:OPS_TEST_AUTH_TOKEN -ErrorAction SilentlyContinue
    }
    if ($generatedStopAdminPassword) {
        Remove-Item Env:POSTGRES_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    }
    if ($generatedStopAppPassword) {
        Remove-Item Env:OPS_TEST_DB_PASSWORD -ErrorAction SilentlyContinue
    }
    if ($generatedStopActor) {
        Remove-Item Env:OPS_TEST_ACTOR -ErrorAction SilentlyContinue
    }
    if ($generatedComposeDatabaseUrl) {
        Remove-Item Env:COMPOSE_DATABASE_URL -ErrorAction SilentlyContinue
    }
    Pop-Location
}
