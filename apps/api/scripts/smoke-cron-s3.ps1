$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
$origin = "http://localhost:5173"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo

function Redact([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $clean = [regex]::Replace($Text, "https?://\S+", "[redacted-url]")
  $clean = [regex]::Replace($clean, '"accessToken"\s*:\s*"[^"]*"', '"accessToken":"[redacted]"')
  $clean = [regex]::Replace($clean, '"url"\s*:\s*"[^"]*"', '"url":"[redacted]"')
  $clean = [regex]::Replace($clean, "[A-Za-z0-9_-]{8,}/[A-Za-z0-9_-]{8,}", "[redacted-key]")
  return $clean
}

function Write-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  if ($Ok) {
    Write-Output "PASS $Name"
  } else {
    Write-Output "FAIL $Name $(Redact $Detail)"
    exit 1
  }
}

function Assert-SafeId([string]$Id) {
  if ($Id -notmatch '^[A-Za-z0-9_-]{8,80}$') { throw "unexpected id" }
}

function Get-Response {
  param(
    [string]$Method = "GET",
    [Parameter(Mandatory = $true)][string]$Uri,
    $Session,
    [string]$Body,
    [string]$InFile,
    [hashtable]$ExtraHeaders,
    [switch]$Public,
    [switch]$Direct
  )
  $headers = @{}
  if (-not $Direct) { $headers["Origin"] = $origin }
  if ($null -ne $ExtraHeaders) {
    foreach ($key in @($ExtraHeaders.Keys)) { $headers[$key] = [string]$ExtraHeaders[$key] }
  }
  $params = @{ Method = $Method; Uri = $Uri }
  if ($headers.Count -gt 0) { $params.Headers = $headers }
  if ($null -ne $Session -and -not $Public -and -not $Direct) { $params.WebSession = $Session }
  if ($Body -ne "") { $params.ContentType = "application/json"; $params.Body = $Body }
  if ($InFile -ne "") { $params.InFile = $InFile }
  try {
    $response = Invoke-WebRequest @params
    $content = ""
    if ($null -ne $response.Content) { $content = [string]$response.Content }
    return @{ Status = [int]$response.StatusCode; Content = $content }
  } catch [System.Net.WebException] {
    $http = $_.Exception.Response
    if ($null -eq $http) { throw }
    $content = ""
    if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message) { $content = [string]$_.ErrorDetails.Message }
    if ($content -eq "") {
      $stream = $http.GetResponseStream()
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
        $reader.Dispose()
      }
    }
    return @{ Status = [int]$http.StatusCode; Content = $content }
  }
}

function Register-User {
  param([string]$Email, [string]$Name)
  $body = (@{ email = $Email; password = "password1234"; name = $Name } | ConvertTo-Json -Compress)
  $response = Invoke-WebRequest -Method POST -Uri "$base/api/auth/sign-up/email" -ContentType "application/json" -Headers @{ Origin = $origin } -Body $body -SessionVariable captured
  if ([int]$response.StatusCode -ne 200) { throw "sign-up failed" }
  return $captured
}

function Invoke-D1 {
  param([string]$Sql)
  $output = & pnpm --filter api exec wrangler d1 execute transfile-db --local --command $Sql --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "d1 execute failed $(Redact (($output | Out-String)))" }
  $text = ($output | Out-String).Trim()
  $start = $text.IndexOf("[")
  if ($start -lt 0) { $start = $text.IndexOf("{") }
  if ($start -lt 0) { throw "d1 output was not json" }
  return $text.Substring($start) | ConvertFrom-Json
}

function Get-D1Count {
  param([string]$Sql)
  $parsed = Invoke-D1 $Sql
  $entry = $parsed
  if ($parsed -is [System.Array]) { $entry = $parsed[0] }
  $rows = @($entry.results)
  if ($rows.Count -eq 0) { return 0 }
  return [int]$rows[0].n
}

function Get-D1Value {
  param([string]$Sql, [string]$Column)
  $parsed = Invoke-D1 $Sql
  $entry = $parsed
  if ($parsed -is [System.Array]) { $entry = $parsed[0] }
  $rows = @($entry.results)
  if ($rows.Count -eq 0) { return $null }
  return $rows[0].$Column
}

$script:CronUrl = ""

function Read-NewLog([int64]$Offset) {
  $path = $env:TRANSFILE_CRON_LOG
  if ([string]::IsNullOrEmpty($path) -or -not (Test-Path $path)) { return "" }
  $stream = New-Object System.IO.FileStream($path, 'Open', 'Read', 'ReadWrite')
  try {
    if ($Offset -gt $stream.Length) { $Offset = 0 }
    [void]$stream.Seek($Offset, 'Begin')
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } finally {
    $stream.Dispose()
  }
}

function Write-CronReport($Report) {
  if ($null -eq $Report) {
    Write-Output "CRON missing"
    return
  }
  $line = @{
    expiredFiles = [int]$Report.expiredFiles
    purgedFiles = [int]$Report.purgedFiles
    purgedPending = [int]$Report.purgedPending
    deletedShares = [int]$Report.deletedShares
    deletedSessions = [int]$Report.deletedSessions
    deletedVerifications = [int]$Report.deletedVerifications
    storageDeleteFailures = [int]$Report.storageDeleteFailures
    moreWork = [bool]$Report.moreWork
  } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine("CRON $line")
}

function Invoke-Cron {
  $offset = [int64]0
  $path = $env:TRANSFILE_CRON_LOG
  if (-not [string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
    $offset = (Get-Item $path).Length
  }
  $candidates = @("$base/__scheduled")
  if ($script:CronUrl -ne "") { $candidates = @($script:CronUrl) }
  $response = $null
  foreach ($url in $candidates) {
    $response = Get-Response -Method GET -Uri $url -Public
    if ($response.Status -ne 404) { $script:CronUrl = $url; break }
  }
  if ($null -eq $response) { return @{ Ok = $false; Status = 0; Report = $null } }
  $deadline = (Get-Date).AddSeconds(20)
  $report = $null
  do {
    Start-Sleep -Milliseconds 400
    $log = Read-NewLog $offset
    $found = [regex]::Matches($log, '\{[^{}]*"expiredFiles"[^{}]*\}')
    if ($found.Count -gt 0) {
      $report = $found[$found.Count - 1].Value | ConvertFrom-Json
      break
    }
  } while ((Get-Date) -lt $deadline)
  Write-CronReport $report
  return @{ Ok = ($response.Status -lt 400); Status = $response.Status; Report = $report }
}

function Get-S3Status {
  param([string]$Key)
  $node = (Get-Command node).Source
  $script = Join-Path $PSScriptRoot "s3-head.mjs"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & $node $script $Key 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  $text = Redact $output
  $status = ""
  if ($text -match '(?m)^\s*(\d{3})\s*$') { $status = $Matches[1] }
  $errorText = ""
  if ($status -eq "") { $errorText = $text }
  return @{ Code = $code; Status = $status; Error = $errorText }
}

function Zero-Work($Report) {
  if ($null -eq $Report) { return $false }
  return (
    [int]$Report.expiredFiles -eq 0 -and
    [int]$Report.purgedFiles -eq 0 -and
    [int]$Report.purgedPending -eq 0 -and
    [int]$Report.deletedShares -eq 0 -and
    [int]$Report.deletedSessions -eq 0 -and
    [int]$Report.deletedVerifications -eq 0 -and
    [int]$Report.storageDeleteFailures -eq 0 -and
    $Report.moreWork -eq $false
  )
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-cron-s3-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "notes.bin"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 64
$rng.GetBytes($bytes)
[System.IO.File]::WriteAllBytes($source, $bytes)

$health = Get-Response -Uri "$base/health" -Public
Write-Check "api health" ($health.Status -eq 200) "status=$($health.Status)"

$sessionA = Register-User -Email "s3-cron-a-$stamp@example.com" -Name "Cron A"
$sessionB = Register-User -Email "s3-cron-b-$stamp@example.com" -Name "Cron B"
$meB = Get-Response -Uri "$base/api/me" -Session $sessionB
Write-Check "user B session" ($meB.Status -eq 200) "status=$($meB.Status)"
$meA = Get-Response -Uri "$base/api/me" -Session $sessionA
$userId = [string]($meA.Content | ConvertFrom-Json).id
Assert-SafeId $userId

$size = (Get-Item $source).Length
$created = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body (@{ name = "notes.bin"; size = $size } | ConvertTo-Json -Compress)
$createdJson = $null
if ($created.Status -eq 201) { $createdJson = $created.Content | ConvertFrom-Json }
$putStatus = 0
$completeStatus = 0
$fileId = ""
if ($null -ne $createdJson) {
  $fileId = [string]$createdJson.file.id
  Assert-SafeId $fileId
  $uploadHeaders = @{}
  if ($null -ne $createdJson.upload.headers) {
    foreach ($property in $createdJson.upload.headers.PSObject.Properties) {
      $uploadHeaders[$property.Name] = [string]$property.Value
    }
  }
  $direct = ([Uri]$createdJson.upload.url).Host -ne ([Uri]$base).Host
  if ($direct) {
    $put = Get-Response -Method PUT -Uri $createdJson.upload.url -InFile $source -ExtraHeaders $uploadHeaders -Direct
  } else {
    $put = Get-Response -Method PUT -Uri $createdJson.upload.url -Session $sessionA -InFile $source
  }
  $putStatus = $put.Status
  $complete = Get-Response -Method POST -Uri "$base/api/files/$fileId/complete" -Session $sessionA
  $completeStatus = $complete.Status
}
$head = Get-S3Status "$userId/$fileId"
Write-Check "uploaded object exists in B2" (
  $created.Status -eq 201 -and ($putStatus -eq 200 -or $putStatus -eq 204) -and $completeStatus -eq 200 -and $head.Status -eq "200"
) "upload=$($created.Status) put=$putStatus complete=$completeStatus head=$($head.Status) $($head.Error)"

Invoke-D1 "UPDATE files SET expires_at = 1 WHERE id = '$fileId'" | Out-Null
$cron = Invoke-Cron
$deletedAt = Get-D1Value "SELECT deleted_at AS deleted_at FROM files WHERE id = '$fileId'" "deleted_at"
$head = Get-S3Status "$userId/$fileId"
Write-Check "expired file is soft-deleted and the object remains" (
  $cron.Ok -and $null -ne $deletedAt -and "$deletedAt" -ne "" -and $head.Status -eq "200"
) "cron=$($cron.Status) deletedAtSet=$($null -ne $deletedAt) head=$($head.Status) $($head.Error)"

$fileOldSeconds = [DateTimeOffset]::UtcNow.AddDays(-2).ToUnixTimeSeconds()
Invoke-D1 "UPDATE files SET deleted_at = $fileOldSeconds WHERE id = '$fileId'" | Out-Null
$cron = Invoke-Cron
$left = Get-D1Count "SELECT count(*) AS n FROM files WHERE id = '$fileId'"
$head = Get-S3Status "$userId/$fileId"
Write-Check "retention purge removes the row and the B2 object" (
  $cron.Ok -and $left -eq 0 -and $head.Status -eq "404"
) "cron=$($cron.Status) left=$left head=$($head.Status) $($head.Error)"

$pending = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body (@{ name = "pending.bin"; size = 64 } | ConvertTo-Json -Compress)
$pendingId = ""
if ($pending.Status -eq 201) {
  $pendingId = [string](($pending.Content | ConvertFrom-Json).file.id)
  Assert-SafeId $pendingId
}
$stale = [DateTimeOffset]::UtcNow.AddHours(-3).ToUnixTimeSeconds()
Invoke-D1 "UPDATE files SET created_at = $stale WHERE id = '$pendingId'" | Out-Null
$cron = Invoke-Cron
$pendingLeft = Get-D1Count "SELECT count(*) AS n FROM files WHERE id = '$pendingId'"
$failures = -1
if ($null -ne $cron.Report) { $failures = [int]$cron.Report.storageDeleteFailures }
Write-Check "stale pending upload is removed without storage failures" (
  $pending.Status -eq 201 -and $cron.Ok -and $pendingLeft -eq 0 -and $failures -eq 0
) "upload=$($pending.Status) left=$pendingLeft failures=$failures"

$first = Invoke-Cron
$second = Invoke-Cron
Write-Check "second cron run reports zero work" ($first.Ok -and $second.Ok -and (Zero-Work $second.Report)) "first=$($first.Status) second=$($second.Status)"
