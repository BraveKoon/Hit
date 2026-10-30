# HIT 소개 웹을 Cloudflare에 배포합니다. web 폴더에서: powershell -ExecutionPolicy Bypass -File deploy.ps1
Set-Location $PSScriptRoot
npm install
npx wrangler login

$toml = Get-Content wrangler.toml -Raw
if ($toml -match 'REPLACE_WITH_DATABASE_ID') {
  $out = npx wrangler d1 create hit-db 2>&1 | Out-String
  Write-Host $out
  if ($out -match 'database_id\s*=\s*"([0-9a-f-]{36})"') {
    $toml -replace 'REPLACE_WITH_DATABASE_ID', $Matches[1] | Set-Content wrangler.toml -NoNewline
  } else {
    Write-Host "database_id를 찾지 못했어요. 위 출력의 database_id를 wrangler.toml에 직접 넣고 다시 실행하세요."
    exit 1
  }
}

npm run db:init:remote
npm run deploy
