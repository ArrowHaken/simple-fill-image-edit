param(
  [string]$Output = "release/catsco-image-edit-workbench-0.1.0.zip"
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$out = Join-Path $repo $Output
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("catsco-artifact-" + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
  $include = @('app', 'artifact', 'docs/XIAOBA_ARTIFACT.md', 'third_party', 'run.py', 'requirements.txt', '.env.example', 'pyproject.toml', 'Dockerfile')
  foreach ($relative in $include) {
    $source = Join-Path $repo $relative
    if (-not (Test-Path $source)) { continue }
    $destination = Join-Path $stage $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
  }
  $manifest = Get-Content (Join-Path $repo 'artifact/manifest.json') -Raw | ConvertFrom-Json
  $build = [ordered]@{
    commit = (git -C $repo rev-parse HEAD).Trim()
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $manifest | Add-Member -NotePropertyName build -NotePropertyValue $build
  $manifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $stage 'artifact/manifest.json') -Encoding utf8
  New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
  if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$out.sha256" -Value "$hash  $(Split-Path $out -Leaf)" -Encoding ascii
  Write-Output "artifact=$out"
  Write-Output "sha256=$hash"
}
finally {
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
