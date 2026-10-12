$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'runtime'
$ollamaExe = Join-Path $runtimeRoot 'ollama/ollama.exe'
if (-not (Test-Path -LiteralPath $ollamaExe)) { throw 'Run scripts/setup-offline.ps1 once while connected to the internet.' }
$env:OLLAMA_MODELS = Join-Path $runtimeRoot 'models'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_VULKAN = 'false'
$env:CUDA_VISIBLE_DEVICES = '-1'
$env:HIP_VISIBLE_DEVICES = '-1'
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 }
catch { Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WorkingDirectory (Split-Path $ollamaExe) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'ollama.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'ollama.stderr.log') | Out-Null; Start-Sleep -Seconds 3 }
Set-Location -LiteralPath $projectRoot
$env:AI_PROVIDER = 'local'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeExe = $nodeCommand.Source }
else {
    $nodeExe = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Install Node.js 22 or newer before starting Meetinglog.' }
}
& $nodeExe --env-file-if-exists=.env server.mjs
