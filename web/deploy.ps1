# HIT! 소개 웹을 Cloudflare에 배포합니다.
# web 폴더에서: powershell -ExecutionPolicy Bypass -File deploy.ps1
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

npm install
npx wrangler whoami *> $null
if ($LASTEXITCODE -ne 0) { npx wrangler login }

# 이미 있는 hit-db 를 찾는다. 없으면 새로 만든다.
function Get-DbId {
  $raw = (npx wrangler d1 list --json 2>$null | Out-String)
  $start = $raw.IndexOf('[')
  if ($start -lt 0) { return $null }
  $db = ($raw.Substring($start) | ConvertFrom-Json) | Where-Object { $_.name -eq 'hit-db' } | Select-Object -First 1
  if ($db) { return $db.uuid } else { return $null }
}

$id = Get-DbId
if (-not $id) {
  npx wrangler d1 create hit-db
  $id = Get-DbId
}
if (-not $id) {
  Write-Host "hit-db 데이터베이스 ID를 찾지 못했어요. 'npx wrangler d1 list' 결과를 알려주세요." -ForegroundColor Red
  exit 1
}
Write-Host "D1 hit-db: $id" -ForegroundColor Green

# wrangler.toml 의 database_id 를 이 ID로 맞춘다(처음이든 다시 실행이든).
$toml = Get-Content wrangler.toml -Raw -Encoding UTF8
$toml = $toml -replace 'database_id = "[^"]*"', ('database_id = "' + $id + '"')
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'wrangler.toml'), $toml, (New-Object System.Text.UTF8Encoding $false))

npx wrangler d1 execute hit-db --remote --file=schema.sql
if ($LASTEXITCODE -ne 0) { Write-Host "테이블 만들기에 실패했어요." -ForegroundColor Red; exit 1 }

npx wrangler deploy
