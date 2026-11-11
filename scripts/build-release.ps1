# Spore - Local Windows Release Packaging Script
# Builds the production web frontend and compiles the Tauri v2 desktop installer.

$ErrorActionPreference = "Stop"

Write-Host "🍄 [Spore] Starting Windows Release Build..." -ForegroundColor Cyan

# 1. Check prerequisites
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm is not installed or not in PATH."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Cargo/Rust is not installed or not in PATH."
}

# 2. Build Frontend Dist
Write-Host "📦 [1/4] Compiling frontend assets..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Frontend compilation failed."
}

# 3. Compile Tauri Desktop Bundle
Write-Host "🦀 [2/4] Compiling Tauri v2 Rust desktop bundle..." -ForegroundColor Yellow
npx tauri build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri release compilation failed."
}

# 4. Collect Release Installers
$ReleaseDir = Join-Path $PSScriptRoot "..\release"
if (-not (Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
}

$BundleDir = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle"
$Artifacts = @()

# Collect NSIS .exe installers
$NsisFiles = Get-ChildItem -Path (Join-Path $BundleDir "nsis\*.exe") -ErrorAction SilentlyContinue
foreach ($f in $NsisFiles) {
    Copy-Item $f.FullName -Destination $ReleaseDir -Force
    $Artifacts += (Join-Path $ReleaseDir $f.Name)
}

# Collect MSI installers
$MsiFiles = Get-ChildItem -Path (Join-Path $BundleDir "msi\*.msi") -ErrorAction SilentlyContinue
foreach ($f in $MsiFiles) {
    Copy-Item $f.FullName -Destination $ReleaseDir -Force
    $Artifacts += (Join-Path $ReleaseDir $f.Name)
}

# 5. Generate Checksums
Write-Host "🔒 [3/4] Generating SHA256 checksums..." -ForegroundColor Yellow
$ChecksumFile = Join-Path $ReleaseDir "SHA256SUMS.txt"
$Checksums = @()

foreach ($art in $Artifacts) {
    $hash = (Get-FileHash -Path $art -Algorithm SHA256).Hash.ToLower()
    $name = [System.IO.Path]::GetFileName($art)
    $Checksums += "$hash  $name"
}

$Checksums | Out-File -FilePath $ChecksumFile -Encoding utf8

# 6. Summary
Write-Host "✅ [4/4] Release build completed successfully!" -ForegroundColor Green
Write-Host "📁 Output directory: $ReleaseDir" -ForegroundColor Cyan
foreach ($art in $Artifacts) {
    $sizeMb = [math]::Round(((Get-Item $art).Length / 1MB), 2)
    Write-Host "   - $([System.IO.Path]::GetFileName($art)) ($sizeMb MB)" -ForegroundColor White
}
Write-Host "   - SHA256SUMS.txt" -ForegroundColor Gray
