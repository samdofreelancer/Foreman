$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Starting the distro runs its /usr/local/sbin/docker-boot hook and starts dockerd.
& wsl.exe -d Ubuntu -e sh -lc "true" | Out-Null

$wslIp = (& wsl.exe -d Ubuntu -e sh -lc "hostname -I | awk '{print `$1}'").Trim()
if (-not $wslIp -or $wslIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw "Could not determine the Ubuntu WSL IPv4 address."
}
$windowsHost = (& wsl.exe -d Ubuntu -e sh -lc "ip -4 route show default | awk '{print `$3}'").Trim()
if (-not $windowsHost -or $windowsHost -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
  throw "Could not determine the Windows host gateway from WSL."
}

$trustedOriginLine = Get-Content -LiteralPath '.env' -ErrorAction SilentlyContinue |
  Where-Object { $_ -match '^FOREMAN_TRUSTED_HTTPS_ORIGIN=' } | Select-Object -First 1
if (-not $trustedOriginLine) { throw "FOREMAN_TRUSTED_HTTPS_ORIGIN is missing from .env." }
$hostAgentTokenLine = Get-Content -LiteralPath '.env' -ErrorAction SilentlyContinue |
  Where-Object { $_ -match '^FOREMAN_HOST_AGENT_TOKEN=' } | Select-Object -First 1
$hostAgentToken = if ($hostAgentTokenLine) { $hostAgentTokenLine.Substring('FOREMAN_HOST_AGENT_TOKEN='.Length) } else { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
if ($hostAgentToken.Length -lt 64) { throw "FOREMAN_HOST_AGENT_TOKEN must contain at least 64 hexadecimal characters." }
@(
  $trustedOriginLine
  'FOREMAN_PORT=4318'
  "FOREMAN_BIND_ADDRESS=$wslIp"
  "FOREMAN_WINDOWS_HOST=$windowsHost"
  "FOREMAN_HOST_AGENT_TOKEN=$hostAgentToken"
) | Set-Content -LiteralPath '.env' -Encoding ascii

# The Windows host agent owns the OpenCode Desktop CLI and exposes its managed
# server only on the private WSL gateway address (never on the LAN interface).
$env:FOREMAN_HOST_AGENT_TOKEN = $hostAgentToken
$agentListeners = Get-NetTCPConnection -LocalPort 4320 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $agentListeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  if ($process -and $process.CommandLine -like '*scripts/opencode-host-agent.mjs*') {
    Stop-Process -Id $listener.OwningProcess -Force
  } else {
    throw "Port 4320 is already used by another process (PID $($listener.OwningProcess))."
  }
}
$agent = Start-Process -FilePath "node" -ArgumentList @(
  "scripts/opencode-host-agent.mjs", $windowsHost
) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
try {
  $agentHealth = Invoke-WebRequest -Uri "http://${windowsHost}:4320/health" -Headers @{ Authorization = "Bearer $hostAgentToken" } -UseBasicParsing -TimeoutSec 5
  if ($agentHealth.StatusCode -ne 200) { throw "OpenCode host agent health check returned HTTP $($agentHealth.StatusCode)." }
} catch {
  Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue
  throw
}

$engineReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  & docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -eq 0) { $engineReady = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $engineReady) { throw "Docker Engine did not become ready within five minutes." }

& docker compose up -d --no-build --pull never
if ($LASTEXITCODE -ne 0) { throw "Could not start the Foreman Compose application." }

# Tailscale runs on Windows; Docker Engine runs inside WSL2. A tiny TCP relay
# preserves the original HTTPS Host/Origin headers while bridging that boundary.
$proxyPort = 4319
$listeners = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  if ($process -and $process.CommandLine -like '*scripts/tcp-proxy.mjs*') {
    Stop-Process -Id $listener.OwningProcess -Force
  } else {
    throw "Port $proxyPort is already used by another process (PID $($listener.OwningProcess))."
  }
}

$proxy = Start-Process -FilePath "node" -ArgumentList @(
  "scripts/tcp-proxy.mjs", "127.0.0.1", "$proxyPort", $wslIp, "4318"
) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$proxyPort/api/health" -Headers @{ Host = "127.0.0.1:4318" } -UseBasicParsing -TimeoutSec 5
  if ($health.StatusCode -ne 200) { throw "Foreman proxy health check returned HTTP $($health.StatusCode)." }
} catch {
  Stop-Process -Id $proxy.Id -Force -ErrorAction SilentlyContinue
  throw
}

& tailscale serve --bg --https=8443 "http://127.0.0.1:$proxyPort"
if ($LASTEXITCODE -ne 0) { throw "Could not configure Tailscale Serve for Foreman." }
