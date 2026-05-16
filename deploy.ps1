#!/usr/bin/env pwsh

# ATHENA Docker Compose Quick Start Script
# Handles validation, build, and initial health checks

param(
    [ValidateSet("up", "down", "logs", "test", "status")]
    [string]$Action = "up"
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommandPath

function Check-Docker {
    try {
        $version = docker --version 2>&1
        Write-Host "✓ Docker found: $version" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Docker not installed or not in PATH" -ForegroundColor Red
        Write-Host "  Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        exit 1
    }
}

function Check-Env {
    $envFile = Join-Path $ProjectRoot "backend" ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host "✗ Backend .env file not found at $envFile" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Backend .env file exists" -ForegroundColor Green
}

function Run-PredeployCheck {
    Write-Host "`n[*] Running predeploy checks..." -ForegroundColor Cyan
    Push-Location (Join-Path $ProjectRoot "backend")
    try {
        $output = npm run predeploy:check 2>&1
        Write-Host $output
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Predeploy checks failed" -ForegroundColor Red
            Pop-Location
            exit 1
        }
        Write-Host "✓ Predeploy checks passed" -ForegroundColor Green
    }
    catch {
        Pop-Location
        Write-Host "✗ Error running predeploy check: $_" -ForegroundColor Red
        exit 1
    }
    finally {
        Pop-Location
    }
}
Pop-Location
            exit 1
        }
        Write-Host "✓ Services started" -ForegroundColor Green
        Write-Host "  Waiting for MySQL to initialize (30 seconds)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
    catch {
        Pop-Location
        Write-Host "✗ Error starting services: $_" -ForegroundColor Red
        exit 1
    }
      docker compose up -d --build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Docker Compose failed to start" -ForegroundColor Red
            exit 1
        }
        Write-Host "✓ Services started" -ForegroundColor Green
        Write-Host "  Waiting for MySQL to initialize (30 seconds)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    } finally {
        Pop-Location
    }
}

function Check-Health {
    Write-Host "`n[*] Checking health..." -ForegroundColor Cyan
    $attempts = 0
    $maxAttempts = 10

    while ($attempts -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:5000/health" -TimeoutSec 5 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                $content = $response.Content | ConvertFrom-Json
                Write-Host "✓ Backend health: $($content.status)" -ForegroundColor Green
                Write-Host "✓ Database status: $($content.database)" -ForegroundColor Green
                return $true
            }
        } catch {
            $attempts++
            if ($attempts -lt $maxAttempts) {
                Write-Host "  Attempt $attempts/$maxAttempts - waiting..." -ForegroundColor Yellow
                Start-Sleep -Seconds 5
            }
        }
    }

    Write-Host "✗ Health check failed after $maxAttempts attempts" -ForegroundColor Red
    Write-Host "  Run 'docker compose logs' for details" -ForegroundColor Yellow
    e
    catch {
        Write-Host "✗ Error viewing logs: $_" -ForegroundColor Red
    }
   xit 1
}

function Show-Logs {
    Push-Location $ProjectRoot
    try {
        docker compose logs -f
    } finally {
        Pop-Location
    }
}

function Stop-Services {
    Write-Host "`n[*] Stopping services..." -ForegroundColor Cyan
    P
    catch {
        Write-Host "✗ Error stopping services: $_" -ForegroundColor Red
    }
   ush-Location $ProjectRoot
    try {
        docker compose down
        Write-Host "✓ Services stopped" -ForegroundColor Green
    } finally {
        Pop-Location
    }
    catch {
        Write-Host "✗ Error checking status: $_" -ForegroundColor Red
    }
   
}

function Show-Status {
    Write-Host "`n[*] Container Status:" -ForegroundColor Cyan
    Push-Location $ProjectRoot
    try {
        docker compose ps
    } finally {
        Pop-Location
    }
}

function Run-Tests {
    Write-Host "`n[*] Running API tests..." -ForegroundColor Cyan
    
    $testPayload = @{
        phone = "+918765432109"
        password = "TestPass123!"
        name = "Test User"
    } | ConvertTo-Json

    try {
        Write-Host "  POST /api/auth/register..." -ForegroundColor Yellow
        $registerResp = Invoke-WebRequest -Uri "http://localhost:5000/api/auth/register" `
            -Method Post `
            -Headers @{"Content-Type" = "application/json"} `
            -Body $testPayload `
            -ErrorAction SilentlyContinue

        if ($registerResp.StatusCode -eq 200 -or $registerResp.StatusCode -eq 201) {
            Write-Host "  ✓ User registration successful" -ForegroundColor Green
        }
    } catch {
        Write-Host "  ✗ Test failed: $_" -ForegroundColor Red
    }
}

# Main execution
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ATHENA Docker Deployment Helper      ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan

Check-Docker
Check-Env
See README.md for endpoint list" -ForegroundColor Yellow
    }
    "down" {
        Stop-Services
    }
    "logs" {
        Show-Logs
    }
    "test" {
        Run-Tests
    }
    "status" {
        Show-Status
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Write-Host "Usage: $($MyInvocation.MyCommand.Name) {up|down|logs|test|status}" -ForegroundColor Yellow
        exit 1
    "logs" {
        Show-Logs
    }
    "test" {
        Run-Tests
    }
    "status" {
        Show-Status
    }
}

Write-Host ""
