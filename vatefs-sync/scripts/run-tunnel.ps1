# Expose local vatefs-sync via Cloudflare quick tunnel.
# Prerequisites: cloudflared on PATH, `npm start` already running on PORT (default 17880).

param(
    [int]$Port = 17880
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    Write-Host "Or: winget install Cloudflare.cloudflared"
    exit 1
}

Write-Host "Tunneling http://127.0.0.1:$Port ..."
Write-Host "Paste the https://*.trycloudflare.com URL into VatEFS Settings → VatEFS Sync server"
cloudflared tunnel --url "http://127.0.0.1:$Port"
