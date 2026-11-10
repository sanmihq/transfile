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
    [switch]$Public
  )
  $headers = @{ Origin = $origin }
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers }
  if ($null -ne $Session -and -not $Public) { $params.WebSession = $Session }
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

function Convert-JsonList([string]$Json) {
  if ([string]::IsNullOrEmpty($Json)) { return }
  $parsed = $Json | ConvertFrom-Json
  foreach ($item in $parsed) { $item }
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

function Invoke-Cron {
  $offset = [int64]0
  $path = $env:TRANSFILE_CRON_LOG
  if (-not [string]::IsNullOrEmpty($path) -and (Test-Path $path)) {
    $offset = (Get-Item $path).Length
  }
  $candidates = @("$base/__scheduled", "$base/cdn-cgi/handler/scheduled")
  if ($script:CronUrl -ne "") { $candidates = @($script:CronUrl) }
  $response = $null
  foreach ($url in $candidates) {
    $response = Get-Response -Method GET -Uri $url -Public
    if ($response.Status -ne 404) {
      $script:CronUrl = $url
      break
    }
  }
  if ($null -eq $response) { return @{ Ok = $false; Status = 0; Report = $null; Log = "" } }
  $deadline = (Get-Date).AddSeconds(20)
  $log = ""
  $report = $null
  do {
    Start-Sleep -Milliseconds 400
    $log = Read-NewLog $offset
    $found = [regex]::Matches($log, '\{[^{}]*"expiredFiles"[^{}]*\}')
    if ($found.Count -gt 0) {
      $report = $found[$found.Count - 1].Value | ConvertFrom-Json
      break
    }
    if ($response.Content -match '"expiredFiles"') {
      $bodyMatch = [regex]::Match($response.Content, '\{[^{}]*"expiredFiles"[^{}]*\}')
      if ($bodyMatch.Success) {
        $report = $bodyMatch.Value | ConvertFrom-Json
        break
      }
    }
  } while ((Get-Date) -lt $deadline)
  return @{ Ok = ($response.Status -lt 400); Status = $response.Status; Report = $report; Log = $log }
}

function Test-R2Object {
  param([string]$Key)
  $out = Join-Path $env:TEMP "transfile-r2-out.bin"
  $err = Join-Path $env:TEMP "transfile-r2-err.txt"
  if (Test-Path $out) { Remove-Item $out -Force }
  if (Test-Path $err) { Remove-Item $err -Force }
  $pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"
  $proc = Start-Process -FilePath $pnpm -ArgumentList @(
    "--filter", "api", "exec", "wrangler", "r2", "object", "get", "transfile-files/$Key", "--local", "--pipe"
  ) -WorkingDirectory $repo -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
  $message = ""
  if (Test-Path $err) { $message = Get-Content -Raw $err }
  return @{ Code = $proc.ExitCode; Message = (Redact $message) }
}

function Send-ReadyFile {
  param($Session, [string]$Path, [int]$ExpiresInHours = -1)
  $size = (Get-Item $Path).Length
  $payload = @{ name = "notes.bin"; size = $size }
  if ($ExpiresInHours -ge 0) { $payload.expiresInHours = $ExpiresInHours }
  $created = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $Session -Body ($payload | ConvertTo-Json -Compress)
  if ($created.Status -ne 201) { return @{ Ok = $false; Detail = "upload-url $($created.Status)" } }
  $json = $created.Content | ConvertFrom-Json
  $put = Get-Response -Method PUT -Uri $json.upload.url -Session $Session -InFile $Path
  $complete = Get-Response -Method POST -Uri "$base/api/files/$($json.file.id)/complete" -Session $Session
  $putOk = $put.Status -eq 204 -or $put.Status -eq 200
  return @{
    Ok = ($putOk -and $complete.Status -eq 200)
    FileId = [string]$json.file.id
    ExpiresAt = $json.file.expiresAt
    Size = $size
    Detail = "put=$($put.Status) complete=$($complete.Status)"
  }
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-cron-smoke-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "notes.bin"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 64
$rng.GetBytes($bytes)
[System.IO.File]::WriteAllBytes($source, $bytes)

$health = Get-Response -Uri "$base/health" -Public
Write-Check "api health" ($health.Status -eq 200) "status=$($health.Status)"

$emailA = "cron-a-$stamp@example.com"
$emailB = "cron-b-$stamp@example.com"
$sessionA = Register-User $emailA "Cron A"
$sessionB = Register-User $emailB "Cron B"
$meB = Get-Response -Uri "$base/api/me" -Session $sessionB
Write-Check "user B session" ($meB.Status -eq 200) "status=$($meB.Status)"
$meA = Get-Response -Uri "$base/api/me" -Session $sessionA
$meJson = $meA.Content | ConvertFrom-Json
$userId = [string]$meJson.id
Assert-SafeId $userId

$uploaded = Send-ReadyFile -Session $sessionA -Path $source -ExpiresInHours 1
Write-Check "upload with expiresInHours 1" $uploaded.Ok $uploaded.Detail
$fileId = $uploaded.FileId
Assert-SafeId $fileId
$expires = [DateTime]::Parse([string]$uploaded.ExpiresAt).ToUniversalTime()
$hours = ($expires - [DateTime]::UtcNow).TotalHours
$list = Get-Response -Uri "$base/api/files?folderId=root" -Session $sessionA
$listed = $null
foreach ($item in (Convert-JsonList $list.Content)) { if ($item.id -eq $fileId) { $listed = $item } }
$folder = Get-Response -Uri "$base/api/folders?parentId=root" -Session $sessionA
$folderJson = $folder.Content | ConvertFrom-Json
$folderListed = $null
foreach ($item in @($folderJson.files)) { if ($item.id -eq $fileId) { $folderListed = $item } }
$listHours = 0
if ($null -ne $listed -and $null -ne $listed.expiresAt) {
  $listHours = ([DateTime]::Parse([string]$listed.expiresAt).ToUniversalTime() - [DateTime]::UtcNow).TotalHours
}
$badHigh = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body (@{ name = "notes.bin"; size = 64; expiresInHours = 73 } | ConvertTo-Json -Compress)
$badZero = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body (@{ name = "notes.bin"; size = 64; expiresInHours = 0 } | ConvertTo-Json -Compress)
Write-Check "expiresAt is about 1h and invalid hours are rejected" (
  $list.Status -eq 200 -and $null -ne $listed -and $hours -gt 0.8 -and $hours -lt 1.2 -and
  $null -ne $folderListed -and $listHours -gt 0.8 -and $listHours -lt 1.2 -and
  $badHigh.Status -eq 400 -and $badZero.Status -eq 400
) "list=$($list.Status) hours=$hours folderHours=$listHours high=$($badHigh.Status) zero=$($badZero.Status)"

$patchLonger = Get-Response -Method PATCH -Uri "$base/api/files/$fileId" -Session $sessionA -Body (@{ expiresInHours = 2 } | ConvertTo-Json -Compress)
$longerJson = $patchLonger.Content | ConvertFrom-Json
$longerHours = 0
if ($patchLonger.Status -eq 200 -and $null -ne $longerJson.expiresAt) {
  $longerHours = ([DateTime]::Parse([string]$longerJson.expiresAt).ToUniversalTime() - [DateTime]::UtcNow).TotalHours
}
$patchClear = Get-Response -Method PATCH -Uri "$base/api/files/$fileId" -Session $sessionA -Body (@{ expiresInHours = $null } | ConvertTo-Json -Compress)
$afterClear = Get-Response -Uri "$base/api/files?folderId=root" -Session $sessionA
$stillSet = $false
foreach ($item in (Convert-JsonList $afterClear.Content)) {
  if ($item.id -eq $fileId -and $null -ne $item.expiresAt) { $stillSet = $true }
}
Write-Check "patch expiry then reject clearing it" (
  $longerHours -gt 1.5 -and $longerHours -lt 2.5 -and $patchClear.Status -eq 400 -and $stillSet
) "longer=$longerHours clear=$($patchClear.Status) stillSet=$stillSet"

$share = Get-Response -Method POST -Uri "$base/api/shares" -Session $sessionA -Body (@{ fileId = $fileId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$shareJson = $share.Content | ConvertFrom-Json
$shareId = ""
$token = ""
if ($share.Status -eq 201) {
  $shareId = [string]$shareJson.share.id
  $token = [Uri]::UnescapeDataString(([Uri][string]$shareJson.url).Segments[-1])
  Assert-SafeId $shareId
}
$usageBefore = Get-Response -Uri "$base/api/usage" -Session $sessionA
$usageBeforeJson = $usageBefore.Content | ConvertFrom-Json
Invoke-D1 "UPDATE files SET expires_at = 1 WHERE id = '$fileId'" | Out-Null
$listAfter = Get-Response -Uri "$base/api/files?folderId=root" -Session $sessionA
$stillListed = $false
foreach ($item in (Convert-JsonList $listAfter.Content)) { if ($item.id -eq $fileId) { $stillListed = $true } }
$download = Get-Response -Uri "$base/api/files/$fileId/download-url" -Session $sessionA
$public = Get-Response -Uri "$base/api/s/$token" -Public
$usageAfter = Get-Response -Uri "$base/api/usage" -Session $sessionA
$usageAfterJson = $usageAfter.Content | ConvertFrom-Json
$usageDrop = ([int]$usageBeforeJson.used - [int]$usageAfterJson.used) -eq [int]$uploaded.Size
$countDrop = ([int]$usageBeforeJson.fileCount - [int]$usageAfterJson.fileCount) -eq 1
Write-Check "expired file is hidden before cron" (
  $share.Status -eq 201 -and -not $stillListed -and $download.Status -eq 404 -and
  $public.Status -eq 410 -and $usageDrop -and $countDrop
) "share=$($share.Status) listed=$stillListed download=$($download.Status) public=$($public.Status) usageDrop=$usageDrop countDrop=$countDrop"

$cron = Invoke-Cron
$deletedAt = Get-D1Value "SELECT deleted_at AS deleted_at FROM files WHERE id = '$fileId'" "deleted_at"
$object = Test-R2Object "$userId/$fileId"
$expiredCount = 0
if ($null -ne $cron.Report) { $expiredCount = [int]$cron.Report.expiredFiles }
Write-Check "cron soft-deletes the expired file and keeps the object" (
  $cron.Ok -and $null -ne $deletedAt -and "$deletedAt" -ne "" -and $object.Code -eq 0 -and $expiredCount -ge 1
) "cron=$($cron.Status) deletedAtSet=$($null -ne $deletedAt) object=$($object.Code) expiredFiles=$expiredCount objectError=$($object.Message)"
if ($script:CronUrl -ne "") { Write-Output "CRON_URL $script:CronUrl" }

$fileOldSeconds = [DateTimeOffset]::UtcNow.AddDays(-2).ToUnixTimeSeconds()
$oldSeconds = [DateTimeOffset]::UtcNow.AddDays(-8).ToUnixTimeSeconds()
Invoke-D1 "UPDATE files SET deleted_at = $fileOldSeconds WHERE id = '$fileId'" | Out-Null
$cron = Invoke-Cron
$fileLeft = Get-D1Count "SELECT count(*) AS n FROM files WHERE id = '$fileId'"
$shareLeft = Get-D1Count "SELECT count(*) AS n FROM shares WHERE id = '$shareId'"
$object = Test-R2Object "$userId/$fileId"
$missing = $object.Code -ne 0 -and $object.Message -match "not found|does not exist|404"
Write-Check "retention purge removes the row, share, and object" (
  $cron.Ok -and $fileLeft -eq 0 -and $shareLeft -eq 0 -and $missing
) "cron=$($cron.Status) files=$fileLeft shares=$shareLeft object=$($object.Code) $($object.Message)"

$pending = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body (@{ name = "notes.bin"; size = 64 } | ConvertTo-Json -Compress)
$pendingJson = $pending.Content | ConvertFrom-Json
$pendingId = ""
if ($pending.Status -eq 201) {
  $pendingId = [string]$pendingJson.file.id
  Assert-SafeId $pendingId
}
$stale = [DateTimeOffset]::UtcNow.AddHours(-3).ToUnixTimeSeconds()
Invoke-D1 "UPDATE files SET created_at = $stale WHERE id = '$pendingId'" | Out-Null
$cron = Invoke-Cron
$pendingLeft = Get-D1Count "SELECT count(*) AS n FROM files WHERE id = '$pendingId'"
Write-Check "stale pending upload is removed" ($pending.Status -eq 201 -and $cron.Ok -and $pendingLeft -eq 0) "upload=$($pending.Status) left=$pendingLeft"

$ready = Send-ReadyFile -Session $sessionA -Path $source
Write-Check "file for share retention" $ready.Ok $ready.Detail
$readyId = $ready.FileId
Assert-SafeId $readyId
function New-ShareId {
  param($Session, [string]$TargetId)
  $created = Get-Response -Method POST -Uri "$base/api/shares" -Session $Session -Body (@{ fileId = $TargetId; expiresInHours = 48 } | ConvertTo-Json -Compress)
  if ($created.Status -ne 201) { return "" }
  $createdJson = $created.Content | ConvertFrom-Json
  return [string]$createdJson.share.id
}
$revokedId = New-ShareId $sessionA $readyId
$endedId = New-ShareId $sessionA $readyId
$activeId = New-ShareId $sessionA $readyId
Assert-SafeId $revokedId
Assert-SafeId $endedId
Assert-SafeId $activeId
$revoked = Get-Response -Method DELETE -Uri "$base/api/shares/$revokedId" -Session $sessionA
Invoke-D1 "UPDATE shares SET revoked_at = $oldSeconds WHERE id = '$revokedId'" | Out-Null
Invoke-D1 "UPDATE shares SET expires_at = $oldSeconds WHERE id = '$endedId'" | Out-Null
$cron = Invoke-Cron
$revokedLeft = Get-D1Count "SELECT count(*) AS n FROM shares WHERE id = '$revokedId'"
$endedLeft = Get-D1Count "SELECT count(*) AS n FROM shares WHERE id = '$endedId'"
$activeLeft = Get-D1Count "SELECT count(*) AS n FROM shares WHERE id = '$activeId'"
Write-Check "ended shares are removed and an active share stays" (
  $revoked.Status -eq 204 -and $cron.Ok -and $revokedLeft -eq 0 -and $endedLeft -eq 0 -and $activeLeft -eq 1
) "delete=$($revoked.Status) revoked=$revokedLeft ended=$endedLeft active=$activeLeft"

$sessionRowId = [guid]::NewGuid().ToString()
$sessionToken = [guid]::NewGuid().ToString()
Invoke-D1 "INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('$sessionRowId', 1, '$sessionToken', 1, 1, '$userId')" | Out-Null
$cron = Invoke-Cron
$sessionLeft = Get-D1Count "SELECT count(*) AS n FROM session WHERE id = '$sessionRowId'"
$meAfter = Get-Response -Uri "$base/api/me" -Session $sessionA
Write-Check "expired session row is removed and the live session works" (
  $cron.Ok -and $sessionLeft -eq 0 -and $meAfter.Status -eq 200
) "left=$sessionLeft me=$($meAfter.Status)"

$stubFile = Join-Path $dir "stub-out.txt"
cmd /c "pnpm --filter api exec tsx ./scripts/test-cleanup-stub.ts > `"$stubFile`" 2>&1"
$stubCode = $LASTEXITCODE
$stubText = ""
if (Test-Path $stubFile) { $stubText = Redact (Get-Content -Raw $stubFile) }
Write-Check "storage delete failure keeps the row" ($stubCode -eq 0 -and $stubText -match "PASS storage failure keeps the row") $stubText

$first = Invoke-Cron
$second = Invoke-Cron
$zero = $false
if ($null -ne $second.Report) {
  $zero = (
    [int]$second.Report.expiredFiles -eq 0 -and
    [int]$second.Report.purgedFiles -eq 0 -and
    [int]$second.Report.purgedPending -eq 0 -and
    [int]$second.Report.deletedShares -eq 0 -and
    [int]$second.Report.deletedSessions -eq 0 -and
    [int]$second.Report.deletedVerifications -eq 0 -and
    [int]$second.Report.storageDeleteFailures -eq 0 -and
    $second.Report.moreWork -eq $false
  )
}
$secondFailed = $second.Log -match "cleanup phase .+ failed"
Write-Check "second cron run reports zero work" ($first.Ok -and $second.Ok -and $zero -and -not $secondFailed) "first=$($first.Status) second=$($second.Status) zero=$zero"

$ids = @()
for ($batch = 0; $batch -lt 3; $batch++) {
  $values = @()
  for ($index = 0; $index -lt 15; $index++) {
    $id = [guid]::NewGuid().ToString()
    $ids += $id
    $values += "('$id', '$userId', NULL, 'f', '$userId/$id', 1, 'application/octet-stream', 'ready', 1, 1, NULL)"
  }
  $sql = "INSERT INTO files (id, user_id, folder_id, name, r2_key, size, mime, status, created_at, deleted_at, expires_at) VALUES " + ($values -join ", ")
  Invoke-D1 $sql | Out-Null
}
$idList = ($ids | ForEach-Object { "'$_'" }) -join ", "
$beforeBudget = Get-D1Count "SELECT count(*) AS n FROM files WHERE id IN ($idList)"
$cron = Invoke-Cron
$afterFirst = Get-D1Count "SELECT count(*) AS n FROM files WHERE id IN ($idList)"
$purged = $beforeBudget - $afterFirst
$more = $false
if ($null -ne $cron.Report) { $more = [bool]$cron.Report.moreWork }
Write-Check "storage budget purges at most 40 and reports more work" (
  $beforeBudget -eq 45 -and $purged -le 40 -and $afterFirst -ge 5 -and $more -and $purged -eq 40
) "before=$beforeBudget purged=$purged left=$afterFirst moreWork=$more"
$cron = Invoke-Cron
$afterSecond = Get-D1Count "SELECT count(*) AS n FROM files WHERE id IN ($idList)"
Write-Check "a later cron purges the remaining backdated files" ($cron.Ok -and $afterSecond -eq 0) "left=$afterSecond"
