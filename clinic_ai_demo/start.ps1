Set-Location $PSScriptRoot
Start-Process "http://localhost:5500"
python -m http.server 5500
