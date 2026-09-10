param(
  [int]$Port = 7862
)

$ErrorActionPreference = 'Stop'
$env:CATSCO_INPAINT_PORT = $Port
if (-not $env:WAVESPEED_API_KEY) {
  throw 'WAVESPEED_API_KEY must be injected by the runtime; it is never stored in the Artifact.'
}
if (-not $env:CATSCO_MASKED_IMAGE2_API_KEY -and -not $env:CATSCO_MASKED_IMAGE2_API_KEY_FILE) {
  throw 'Configure CatsCo Image2 gateway authentication at runtime.'
}
python run.py
