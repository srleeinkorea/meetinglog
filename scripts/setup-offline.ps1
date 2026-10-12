param([string]$SummaryModel = 'qwen2.5:3b')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Get-Download([string]$Uri, [string]$Target) {
    if (Test-Path -LiteralPath $Target) { return }
    Write-Output ('Downloading: ' + [IO.Path]::GetFileName($Target))
    & curl.exe --silent --show-error --fail --location --retry 3 --continue-at - --output ($Target + '.part') $Uri
    if ($LASTEXITCODE -ne 0) { throw ('Download failed: ' + [IO.Path]::GetFileName($Target)) }
    Move-Item -LiteralPath ($Target + '.part') -Destination $Target
}

$ollamaRoot = Join-Path $runtimeRoot 'ollama'
if (-not (Test-Path -LiteralPath (Join-Path $ollamaRoot 'ollama.exe'))) {
    $archive = Join-Path $runtimeRoot 'ollama.zip'
    Get-Download 'https://github.com/ollama/ollama/releases/download/v0.40.3/ollama-windows-amd64.zip' $archive
    # The CPU package avoids extracting large NVIDIA libraries on PCs without NVIDIA GPUs.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $destinationRoot = [IO.Path]::GetFullPath($ollamaRoot) + [IO.Path]::DirectorySeparatorChar
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -match '^lib/ollama/(cuda|rocm|vulkan|mlx)' -or $entry.FullName.EndsWith('/')) { continue }
            $target = [IO.Path]::GetFullPath((Join-Path $ollamaRoot $entry.FullName))
            if (-not $target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }
}
$whisperRoot = Join-Path $runtimeRoot 'whisper'
if (-not (Test-Path -LiteralPath (Join-Path $whisperRoot 'whisper-cli.exe'))) {
    $archive = Join-Path $runtimeRoot 'whisper.zip'
    Get-Download 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip' $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $whisperRoot -Force
}
$env:OLLAMA_MODELS = Join-Path $runtimeRoot 'models'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_VULKAN = 'false'
$env:CUDA_VISIBLE_DEVICES = '-1'
$env:HIP_VISIBLE_DEVICES = '-1'
$ollamaExe = Join-Path $ollamaRoot 'ollama.exe'
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 }
catch {
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WorkingDirectory $ollamaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'ollama.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'ollama.stderr.log') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; $ready = $true; break } catch {}
    }
    if (-not $ready) { throw 'Ollama server did not start. Check runtime/ollama.stderr.log.' }
}
Write-Output ('Downloading summary model: ' + $SummaryModel)
$pullProcess = Start-Process -FilePath $ollamaExe -ArgumentList @('pull', $SummaryModel) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'model-pull.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'model-pull.stderr.log')
$ffmpegRoot = Join-Path $runtimeRoot 'ffmpeg'
$ffmpegExe = Get-ChildItem -LiteralPath $ffmpegRoot -Filter 'ffmpeg.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpegExe) {
    $archive = Join-Path $runtimeRoot 'ffmpeg.zip'
    Get-Download 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $ffmpegRoot -Force
}
$whisperModel = Join-Path $runtimeRoot 'ggml-small.bin'
Get-Download 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' $whisperModel
$whisperExe = Get-ChildItem -LiteralPath $whisperRoot -Filter 'whisper-cli.exe' -Recurse | Select-Object -First 1
$ffmpegExe = Get-ChildItem -LiteralPath $ffmpegRoot -Filter 'ffmpeg.exe' -Recurse | Select-Object -First 1
if (-not $whisperExe -or -not $ffmpegExe) { throw 'Offline executable not found after extraction.' }
$pullProcess.WaitForExit()
if ($pullProcess.ExitCode -ne 0) { throw 'Ollama model download failed. See runtime/model-pull.stderr.log.' }
$envFile = Join-Path $projectRoot '.env'
$existing = if (Test-Path -LiteralPath $envFile) { [IO.File]::ReadAllLines($envFile) } else { @() }
$updates = [ordered]@{AI_PROVIDER='local'; WHISPER_BIN=$whisperExe.FullName.Replace('\','/'); WHISPER_MODEL=$whisperModel.Replace('\','/'); FFMPEG_BIN=$ffmpegExe.FullName.Replace('\','/'); OLLAMA_URL='http://127.0.0.1:11434'; OLLAMA_MODEL=$SummaryModel}
$retained = @($existing | Where-Object { $lineKey = ($_ -split '=',2)[0]; -not $updates.Contains($lineKey) })
$outputLines = $retained + @($updates.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value })
[IO.File]::WriteAllLines($envFile, $outputLines, [Text.UTF8Encoding]::new($false))
Write-Output 'Offline setup complete. Run scripts/start-offline.ps1 to start the app.'
