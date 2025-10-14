param(
  [string]$ApiUrl = "http://localhost:8080",
  [switch]$Build
)

Write-Host "Setting NEXT_PUBLIC_REFEREE_URL=$ApiUrl" -ForegroundColor Cyan
$env:NEXT_PUBLIC_REFEREE_URL = $ApiUrl

if ($Build) {
  Write-Host "Building @arena/web..." -ForegroundColor Yellow
  pnpm --filter @arena/web build
  Write-Host "Starting @arena/web (production)..." -ForegroundColor Green
  pnpm --filter @arena/web start
} else {
  Write-Host "Starting @arena/web (dev) with API: $ApiUrl" -ForegroundColor Green
  pnpm --filter @arena/web dev
}

