param(
    [switch]$Build,
    [switch]$SeedDemoData,
    [switch]$Stop,
    [switch]$ResetTestData,
    [string]$ConfirmDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

& "$PSScriptRoot\scripts\bootstrap.ps1" @PSBoundParameters
