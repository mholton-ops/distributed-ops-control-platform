param(
    [ValidateSet("healthy-movement", "sync-lag-divergence")]
    [string]$Scenario = "sync-lag-divergence"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $env:OPS_TEST_AUTH_TOKEN -or $env:OPS_TEST_AUTH_TOKEN.Length -lt 32) {
    throw "OPS_TEST_AUTH_TOKEN must be at least 32 characters and supplied through approved runtime secret plumbing."
}

Write-Host "Running deterministic simulator against API..."
npm run build:packages
npm run build --workspace @ops/simulator

$priorScenario = $env:SIM_SCENARIO
try {
    $env:SIM_SCENARIO = $Scenario
    npm run start --workspace @ops/simulator
    if ($LASTEXITCODE -ne 0) {
        throw "Simulator failed with exit code $LASTEXITCODE."
    }
    Write-Host "Simulator run complete. Inspect dashboard and reconciliation views."
}
finally {
    if ($null -eq $priorScenario) {
        Remove-Item Env:SIM_SCENARIO -ErrorAction SilentlyContinue
    }
    else {
        $env:SIM_SCENARIO = $priorScenario
    }
}
