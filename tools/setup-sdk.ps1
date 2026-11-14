$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$sdkDir = Join-Path $projectDir '.android-sdk'
$downloadsDir = Join-Path $sdkDir 'downloads'
New-Item -ItemType Directory -Force $sdkDir, $downloadsDir | Out-Null
$repository = [xml](Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml' -UseBasicParsing -TimeoutSec 60).Content
foreach ($packagePath in @('platforms;android-37.0', 'build-tools;35.0.0')) {
    $package = $repository.SelectNodes('//*[local-name()="remotePackage"]') | Where-Object { $_.path -eq $packagePath }
    if (!$package) { throw "SDK package missing: $packagePath" }
    $archive = @($package.archives.archive) | Where-Object { !$_.'host-os' -or $_.'host-os' -eq 'windows' } | Select-Object -First 1
    $zip = Join-Path $downloadsDir $archive.complete.url
    if (!(Test-Path -LiteralPath $zip)) {
        Write-Output "Downloading $packagePath"
        Invoke-WebRequest ('https://dl.google.com/android/repository/' + $archive.complete.url) -UseBasicParsing -OutFile $zip -TimeoutSec 300
    }
    if ((Get-Item -LiteralPath $zip).Length -ne [long]$archive.complete.size) { throw "Archive size mismatch: $zip" }
    $expected = [string]$archive.complete.checksum.'#text'
    if (!$expected) { $expected = [string]$archive.complete.checksum }
    $algorithm = if ($expected.Length -eq 40) { 'SHA1' } else { 'SHA256' }
    if ((Get-FileHash -LiteralPath $zip -Algorithm $algorithm).Hash.ToLower() -ne $expected.ToLower()) { throw 'SDK archive checksum mismatch' }
    $stage = Join-Path $downloadsDir ($packagePath.Replace(';','-') + '-extracted')
    if (!(Test-Path -LiteralPath $stage)) { Expand-Archive -LiteralPath $zip -DestinationPath $stage }
    $top = Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
    $dest = Join-Path $sdkDir ($packagePath.Replace(';', '\'))
    if (!(Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null; Copy-Item -LiteralPath $top.FullName -Destination $dest -Recurse }
    Write-Output "Installed $packagePath"
}
