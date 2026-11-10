$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
$origin = "http://localhost:5173"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
$failed = $false

function Redact([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $clean = [regex]::Replace($Text, "https?://\S+", "[redacted-url]")
  $clean = [regex]::Replace($clean, '"accessToken"\s*:\s*"[^"]*"', '"accessToken":"[redacted]"')
  $clean = [regex]::Replace($clean, '"url"\s*:\s*"[^"]*"', '"url":"[redacted]"')
  $clean = [regex]::Replace($clean, '"password"\s*:\s*"[^"]*"', '"password":"[redacted]"')
  $clean = [regex]::Replace($clean, '"body"\s*:\s*"[^"]*"', '"body":"[redacted]"')
  $clean = [regex]::Replace($clean, '"message"\s*:\s*"[^"]*"', '"message":"[redacted]"')
  $clean = [regex]::Replace($clean, "[A-Za-z0-9_-]{8,}/[A-Za-z0-9_-]{8,}", "[redacted-key]")
  return $clean
}

function Write-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  if ($Ok) {
    Write-Output "PASS $Name"
  } else {
    Write-Output "FAIL $Name $(Redact $Detail)"
    $script:failed = $true
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
    [switch]$Public
  )
  $headers = @{ Origin = $origin }
  if ($null -ne $ExtraHeaders) {
    foreach ($key in @($ExtraHeaders.Keys)) { $headers[$key] = [string]$ExtraHeaders[$key] }
  }
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
  param([string]$Email, [string]$Name, $Session)
  $body = (@{ email = $Email; password = "password1234"; name = $Name } | ConvertTo-Json -Compress)
  if ($null -eq $Session) {
    $response = Invoke-WebRequest -Method POST -Uri "$base/api/auth/sign-up/email" -ContentType "application/json" -Headers @{ Origin = $origin } -Body $body -SessionVariable captured
    if ([int]$response.StatusCode -ne 200) { throw "sign-up failed" }
    return $captured
  }
  $response = Get-Response -Method POST -Uri "$base/api/auth/sign-up/email" -Session $Session -Body $body
  return $response
}

function Start-Guest {
  param([string]$ApiBase = $base)
  $response = Invoke-WebRequest -Method POST -Uri "$ApiBase/api/auth/sign-in/anonymous" -ContentType "application/json" -Headers @{ Origin = $origin } -Body "{}" -SessionVariable captured
  return @{ Status = [int]$response.StatusCode; Session = $captured }
}

function Invoke-D1 {
  param([string]$Sql)
  $output = & pnpm --filter api exec wrangler d1 execute transfile-db --local --command $Sql --json 2>&1
  if ($LASTEXITCODE -ne 0) { throw "d1 execute failed $(Redact (($output | Out-String)))" }
  $text = ($output | Out-String).Trim()
  $start = $text.IndexOf("[")
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

function Send-ReadyFile {
  param($Session, [string]$Path, [string]$FolderId, [string]$Name = "notes.bin", [string]$Mime = "application/octet-stream", [string]$ApiBase = $base)
  $size = (Get-Item $Path).Length
  $payload = @{ name = $Name; size = $size; mime = $Mime }
  if ($FolderId -ne "") { $payload.folderId = $FolderId }
  $created = Get-Response -Method POST -Uri "$ApiBase/api/files/upload-url" -Session $Session -Body ($payload | ConvertTo-Json -Compress)
  if ($created.Status -ne 201) { return @{ Ok = $false; Status = $created.Status; Detail = "upload-url $($created.Status)" } }
  $json = $created.Content | ConvertFrom-Json
  $put = Get-Response -Method PUT -Uri $json.upload.url -Session $Session -InFile $Path
  $complete = Get-Response -Method POST -Uri "$ApiBase/api/files/$($json.file.id)/complete" -Session $Session
  $putOk = $put.Status -eq 204 -or $put.Status -eq 200
  return @{
    Ok = ($putOk -and $complete.Status -eq 200)
    FileId = [string]$json.file.id
    ExpiresAt = $json.file.expiresAt
    Status = $complete.Status
    Detail = "put=$($put.Status) complete=$($complete.Status)"
  }
}

function Share-Token([string]$Url) {
  return [Uri]::UnescapeDataString(([Uri]$Url).Segments[-1])
}

function Invoke-Cron {
  $response = Get-Response -Method GET -Uri "$base/__scheduled" -Public
  Start-Sleep -Seconds 3
  return $response
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-v2-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "notes.bin"
[System.IO.File]::WriteAllBytes($source, [Text.Encoding]::UTF8.GetBytes("hello v2"))
$pngPath = Join-Path $dir "dot.png"
[System.IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))
$pdfPath = Join-Path $dir "note.pdf"
[System.IO.File]::WriteAllBytes($pdfPath, [Text.Encoding]::ASCII.GetBytes("%PDF-1.1 tiny"))
$svgPath = Join-Path $dir "icon.svg"
[System.IO.File]::WriteAllBytes($svgPath, [Text.Encoding]::UTF8.GetBytes("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))

$health = Get-Response -Uri "$base/health" -Public
Write-Check "api health" ($health.Status -eq 200) "status=$($health.Status)"

$member = Register-User -Email "v2-member-$stamp@example.com" -Name "Member"
$other = Register-User -Email "v2-other-$stamp@example.com" -Name "Other"
$me = Get-Response -Uri "$base/api/me" -Session $member
$memberId = [string]($me.Content | ConvertFrom-Json).id
Assert-SafeId $memberId

$tooBig = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $member -Body (@{ name = "big.bin"; size = 104857601 } | ConvertTo-Json -Compress)
$zeroHours = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $member -Body (@{ name = "a.bin"; size = 4; expiresInHours = 0 } | ConvertTo-Json -Compress)
$highHours = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $member -Body (@{ name = "a.bin"; size = 4; expiresInHours = 73 } | ConvertTo-Json -Compress)
Write-Check "100MB + 1 byte and expiry hours 0 or 73 are rejected" (
  $tooBig.Status -eq 400 -and $zeroHours.Status -eq 400 -and $highHours.Status -eq 400
) "size=$($tooBig.Status) zero=$($zeroHours.Status) high=$($highHours.Status)"

$full = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $member -Body (@{ name = "full.bin"; size = 104857600 } | ConvertTo-Json -Compress)
$over = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $member -Body (@{ name = "more.bin"; size = 1 } | ConvertTo-Json -Compress)
Write-Check "account quota is 100MB" ($full.Status -eq 201 -and $over.Status -eq 413) "full=$($full.Status) over=$($over.Status)"
if ($full.Status -eq 201) {
  $fullId = [string](($full.Content | ConvertFrom-Json).file.id)
  Assert-SafeId $fullId
  $removed = Get-Response -Method DELETE -Uri "$base/api/files/$fullId" -Session $member
  Write-Check "quota placeholder removed" ($removed.Status -eq 204) "status=$($removed.Status)"
}

$guestStart = Start-Guest
$guest = $guestStart.Session
Write-Check "guest sign-in" ($guestStart.Status -eq 200) "status=$($guestStart.Status)"
$guestMe = Get-Response -Uri "$base/api/me" -Session $guest
$guestId = ""
if ($guestMe.Status -eq 200) { $guestId = [string]($guestMe.Content | ConvertFrom-Json).id }
$guestFiles = Get-Response -Uri "$base/api/files" -Session $guest
$guestFolders = Get-Response -Uri "$base/api/folders" -Session $guest
$guestShares = Get-Response -Uri "$base/api/shares" -Session $guest
$guestNotes = Get-Response -Uri "$base/api/notifications" -Session $guest
Write-Check "guest cannot list files, folders, shares, or notifications" (
  $guestFiles.Status -eq 403 -and $guestFolders.Status -eq 403 -and $guestShares.Status -eq 403 -and $guestNotes.Status -eq 403
) "files=$($guestFiles.Status) folders=$($guestFolders.Status) shares=$($guestShares.Status) notes=$($guestNotes.Status)"

$transfer = Get-Response -Method POST -Uri "$base/api/transfers" -Session $guest -Body (@{ title = "Guest send" } | ConvertTo-Json -Compress)
$transferId = ""
if ($transfer.Status -eq 201) { $transferId = [string]($transfer.Content | ConvertFrom-Json).id }
Assert-SafeId $transferId
$first = Send-ReadyFile -Session $guest -Path $source -FolderId $transferId -Name "one.txt"
$second = Send-ReadyFile -Session $guest -Path $source -FolderId $transferId -Name "two.txt"
$shareBody = @{ folderId = $transferId; password = "sharepass1"; expiresInHours = 24 } | ConvertTo-Json -Compress
$share = Get-Response -Method POST -Uri "$base/api/shares" -Session $guest -Body $shareBody
$shareId = ""
$token = ""
if ($share.Status -eq 201) {
  $shareJson = $share.Content | ConvertFrom-Json
  $shareId = [string]$shareJson.share.id
  $token = Share-Token $shareJson.url
  Assert-SafeId $shareId
}
$unlock = Get-Response -Method POST -Uri "$base/api/s/$token/unlock" -Public -Body (@{ password = "sharepass1" } | ConvertTo-Json -Compress)
$access = ""
if ($unlock.Status -eq 200) { $access = [string]($unlock.Content | ConvertFrom-Json).accessToken }
$download = Get-Response -Uri "$base/api/s/$token/download-url?fileId=$($first.FileId)" -Public -ExtraHeaders @{ "X-Share-Access" = $access }
$fetched = @{ Status = 0 }
if ($download.Status -eq 200) {
  $fileUrl = [string]($download.Content | ConvertFrom-Json).url
  $fetched = Get-Response -Uri $fileUrl -Public
}
Write-Check "guest uploads two files and a public download works" (
  $first.Ok -and $second.Ok -and $share.Status -eq 201 -and $unlock.Status -eq 200 -and $download.Status -eq 200 -and $fetched.Status -eq 200
) "files=$($first.Detail),$($second.Detail) share=$($share.Status) unlock=$($unlock.Status) download=$($download.Status) bytes=$($fetched.Status)"

$emptyTransfer = Get-Response -Method POST -Uri "$base/api/transfers" -Session $member -Body "{}"
$emptyId = ""
if ($emptyTransfer.Status -eq 201) { $emptyId = [string]($emptyTransfer.Content | ConvertFrom-Json).id }
$emptyShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ folderId = $emptyId } | ConvertTo-Json -Compress)
$folderList = Get-Response -Uri "$base/api/folders?parentId=root" -Session $member
$allFolders = Get-Response -Uri "$base/api/folders/all" -Session $member
$seen = ($folderList.Content + $allFolders.Content).Contains($transferId) -or ($folderList.Content + $allFolders.Content).Contains($emptyId)
Write-Check "transfer folders stay hidden and an empty transfer cannot be shared" (
  $emptyTransfer.Status -eq 201 -and $emptyShare.Status -eq 400 -and -not $seen
) "create=$($emptyTransfer.Status) share=$($emptyShare.Status) seen=$seen"

$cappedFile = Send-ReadyFile -Session $member -Path $source -Name "cap.txt"
Assert-SafeId $cappedFile.FileId
$past = [DateTimeOffset]::UtcNow.AddHours(-70).ToUnixTimeSeconds()
Invoke-D1 "UPDATE files SET created_at = $past WHERE id = '$($cappedFile.FileId)'" | Out-Null
$patchFile = Get-Response -Method PATCH -Uri "$base/api/files/$($cappedFile.FileId)" -Session $member -Body (@{ expiresInHours = 72 } | ConvertTo-Json -Compress)
$fileJson = $patchFile.Content | ConvertFrom-Json
$fileGap = 0
$fileAhead = 99
if ($patchFile.Status -eq 200) {
  $fileExpiry = [DateTime]::Parse([string]$fileJson.expiresAt).ToUniversalTime()
  $fileCreated = [DateTime]::Parse([string]$fileJson.createdAt).ToUniversalTime()
  $fileGap = ($fileExpiry - $fileCreated).TotalHours
  $fileAhead = ($fileExpiry - [DateTime]::UtcNow).TotalHours
}
$fileShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $cappedFile.FileId; expiresInHours = 2 } | ConvertTo-Json -Compress)
$fileShareId = ""
if ($fileShare.Status -eq 201) { $fileShareId = [string]($fileShare.Content | ConvertFrom-Json).share.id }
Invoke-D1 "UPDATE shares SET created_at = $past WHERE id = '$fileShareId'" | Out-Null
$patchShare = Get-Response -Method PATCH -Uri "$base/api/shares/$fileShareId" -Session $member -Body (@{ expiresInHours = 72 } | ConvertTo-Json -Compress)
$shareGap = 0
$shareAhead = 99
if ($patchShare.Status -eq 200) {
  $shareJson = $patchShare.Content | ConvertFrom-Json
  $shareExpiry = [DateTime]::Parse([string]$shareJson.expiresAt).ToUniversalTime()
  $shareCreated = [DateTime]::Parse([string]$shareJson.createdAt).ToUniversalTime()
  $shareGap = ($shareExpiry - $shareCreated).TotalHours
  $shareAhead = ($shareExpiry - [DateTime]::UtcNow).TotalHours
}
Write-Check "expiry cannot pass createdAt plus 72 hours" (
  $patchFile.Status -eq 200 -and $fileGap -gt 71 -and $fileGap -lt 73 -and $fileAhead -lt 3 -and
  $patchShare.Status -eq 200 -and $shareGap -gt 71 -and $shareGap -lt 73 -and $shareAhead -lt 3
) "file=$($patchFile.Status) fileGap=$fileGap fileAhead=$fileAhead share=$($patchShare.Status) shareGap=$shareGap shareAhead=$shareAhead"

$commentShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $cappedFile.FileId; expiresInHours = 24; message = "hello" } | ConvertTo-Json -Compress)
$commentShareId = ""
$commentToken = ""
if ($commentShare.Status -eq 201) {
  $commentJson = $commentShare.Content | ConvertFrom-Json
  $commentShareId = [string]$commentJson.share.id
  $commentToken = Share-Token $commentJson.url
}
$posted = Get-Response -Method POST -Uri "$base/api/s/$commentToken/comments" -Public -Body (@{ message = "note one"; name = "Ada" } | ConvertTo-Json -Compress)
$publicRead = Get-Response -Uri "$base/api/s/$commentToken/comments" -Public
$ownerComments = Get-Response -Uri "$base/api/comments?shareId=$commentShareId" -Session $member
$ownerCount = 0
$ownerSaw = $false
if ($ownerComments.Status -eq 200) {
  $ownerItems = @(($ownerComments.Content | ConvertFrom-Json).items)
  $ownerCount = $ownerItems.Count
  $ownerSaw = ($ownerCount -ge 1 -and [string]$ownerItems[0].body -eq "note one")
}
$otherComments = Get-Response -Uri "$base/api/comments?shareId=$commentShareId" -Session $other
$honeypot = Get-Response -Method POST -Uri "$base/api/s/$commentToken/comments" -Public -Body (@{ message = "spam"; website = "https://example.invalid" } | ConvertTo-Json -Compress)
$afterHoney = Get-D1Count "SELECT count(*) AS n FROM share_comments WHERE share_id = '$commentShareId'"
$extraStatuses = @()
for ($i = 0; $i -lt 4; $i++) {
  $extra = Get-Response -Method POST -Uri "$base/api/s/$commentToken/comments" -Public -Body (@{ message = "note extra" } | ConvertTo-Json -Compress)
  $extraStatuses += $extra.Status
}
$extraOk = $extraStatuses.Count -eq 4
foreach ($status in $extraStatuses) { if ($status -ne 201) { $extraOk = $false } }
$limited = Get-Response -Method POST -Uri "$base/api/s/$commentToken/comments" -Public -Body (@{ message = "note extra" } | ConvertTo-Json -Compress)
$closed = Get-Response -Method PATCH -Uri "$base/api/shares/$commentShareId" -Session $member -Body (@{ allowComments = $false } | ConvertTo-Json -Compress)
$closedPost = Get-Response -Method POST -Uri "$base/api/s/$commentToken/comments" -Public -Body (@{ message = "nope" } | ConvertTo-Json -Compress)
$guestComment = Get-Response -Method POST -Uri "$base/api/s/$token/comments" -Public -ExtraHeaders @{ "X-Share-Access" = $access } -Body (@{ message = "guest note" } | ConvertTo-Json -Compress)
Write-Check "comments are private, rate-limited, and off when disabled" (
  $posted.Status -eq 201 -and ($publicRead.Status -eq 404 -or $publicRead.Status -eq 405) -and $ownerSaw -and
  $otherComments.Status -eq 404 -and $honeypot.Status -eq 201 -and $afterHoney -eq 1 -and
  $extraOk -and $limited.Status -eq 429 -and
  $closed.Status -eq 200 -and $closedPost.Status -eq 403 -and $guestComment.Status -eq 403
) "post=$($posted.Status) public=$($publicRead.Status) owner=$ownerSaw other=$($otherComments.Status) honey=$($honeypot.Status) stored=$afterHoney extras=$($extraStatuses -join ',') limited=$($limited.Status) closed=$($closedPost.Status) guest=$($guestComment.Status)"

$beforeNotes = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId'"
$opened = Get-Response -Uri "$base/api/s/$commentToken" -Public
$openedAgain = Get-Response -Uri "$base/api/s/$commentToken" -Public
$downloaded = Get-Response -Uri "$base/api/s/$commentToken/download-url" -Public
$downloadedAgain = Get-Response -Uri "$base/api/s/$commentToken/download-url" -Public
$lockShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $cappedFile.FileId; password = "sharepass1"; expiresInHours = 24 } | ConvertTo-Json -Compress)
$lockToken = ""
if ($lockShare.Status -eq 201) { $lockToken = Share-Token ($lockShare.Content | ConvertFrom-Json).url }
$wrong = 0
for ($i = 0; $i -lt 5; $i++) {
  $attempt = Get-Response -Method POST -Uri "$base/api/s/$lockToken/unlock" -Public -Body (@{ password = "not-the-password" } | ConvertTo-Json -Compress)
  if ($attempt.Status -eq 401) { $wrong += 1 }
}
$noteList = Get-Response -Uri "$base/api/notifications?limit=50" -Session $member
$noteJson = $noteList.Content | ConvertFrom-Json
$types = @($noteJson.items | ForEach-Object { [string]$_.type })
$openCount = @($types | Where-Object { $_ -eq "share_opened" }).Count
$downloadCount = @($types | Where-Object { $_ -eq "file_downloaded" }).Count
$lockCount = @($types | Where-Object { $_ -eq "share_locked" }).Count
$commentCount = @($types | Where-Object { $_ -eq "comment_received" }).Count
$unread = Get-Response -Uri "$base/api/notifications/unread-count" -Session $member
$unreadCount = 0
if ($unread.Status -eq 200) { $unreadCount = [int]($unread.Content | ConvertFrom-Json).count }
$oneId = ""
if (@($noteJson.items).Count -gt 0) { $oneId = [string]$noteJson.items[0].id }
$readOne = Get-Response -Method POST -Uri "$base/api/notifications/read" -Session $member -Body (@{ ids = @($oneId) } | ConvertTo-Json -Compress)
$afterOne = Get-Response -Uri "$base/api/notifications/unread-count" -Session $member
$afterOneCount = [int]($afterOne.Content | ConvertFrom-Json).count
$readAll = Get-Response -Method POST -Uri "$base/api/notifications/read" -Session $member -Body "{}"
$afterAll = Get-Response -Uri "$base/api/notifications/unread-count" -Session $member
$afterAllCount = [int]($afterAll.Content | ConvertFrom-Json).count
$otherList = Get-Response -Uri "$base/api/notifications" -Session $other
$otherHas = $otherList.Content.Contains($oneId)
$otherDelete = Get-Response -Method DELETE -Uri "$base/api/notifications/$oneId" -Session $other
$deletedOne = Get-Response -Method DELETE -Uri "$base/api/notifications/$oneId" -Session $member
$deletedAll = Get-Response -Method DELETE -Uri "$base/api/notifications" -Session $member
$leftNotes = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId' AND id = '$oneId'"
Write-Check "notifications dedupe, mark read, and stay private" (
  $opened.Status -eq 200 -and $openedAgain.Status -eq 200 -and $downloaded.Status -eq 200 -and $wrong -eq 5 -and
  $openCount -eq 1 -and $downloadCount -eq 1 -and $lockCount -eq 1 -and $commentCount -ge 1 -and
  $unreadCount -ge 4 -and $readOne.Status -eq 200 -and $afterOneCount -eq ($unreadCount - 1) -and
  $readAll.Status -eq 200 -and $afterAllCount -eq 0 -and -not $otherHas -and $otherDelete.Status -eq 404 -and
  $deletedOne.Status -eq 204 -and $deletedAll.Status -eq 204 -and $leftNotes -eq 0
) "open=$openCount download=$downloadCount lock=$lockCount comment=$commentCount unread=$unreadCount afterOne=$afterOneCount afterAll=$afterAllCount otherDelete=$($otherDelete.Status) wrong=$wrong before=$beforeNotes"

$activity = Get-Response -Uri "$base/api/shares/$commentShareId/activity?limit=50" -Session $member
$activityJson = $activity.Content | ConvertFrom-Json
$ordered = $true
$previous = $null
foreach ($item in @($activityJson.items)) {
  $at = [DateTime]::Parse([string]$item.createdAt).ToUniversalTime()
  if ($null -ne $previous -and $at -gt $previous) { $ordered = $false }
  $previous = $at
}
$activityText = $activity.Content
$hasIp = $activityText -match '"ip"' -or $activityText -match "visitorHash"
Write-Check "activity is newest first and has no ip" (
  $activity.Status -eq 200 -and @($activityJson.items).Count -ge 2 -and $ordered -and -not $hasIp
) "status=$($activity.Status) count=$(@($activityJson.items).Count) ordered=$ordered ip=$hasIp"

$image = Send-ReadyFile -Session $member -Path $pngPath -Name "dot.png" -Mime "image/png"
$pdf = Send-ReadyFile -Session $member -Path $pdfPath -Name "note.pdf" -Mime "application/pdf"
$svg = Send-ReadyFile -Session $member -Path $svgPath -Name "icon.svg" -Mime "image/svg+xml"
$imageShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $image.FileId } | ConvertTo-Json -Compress)
$imageToken = ""
$imageShareId = ""
if ($imageShare.Status -eq 201) {
  $imageJson = $imageShare.Content | ConvertFrom-Json
  $imageToken = Share-Token $imageJson.url
  $imageShareId = [string]$imageJson.share.id
}
$beforePreview = Get-D1Count "SELECT download_count AS n FROM shares WHERE id = '$imageShareId'"
$memberPreview = Get-Response -Uri "$base/api/files/$($image.FileId)/preview-url" -Session $member
$memberPreviewGet = @{ Status = 0 }
if ($memberPreview.Status -eq 200) {
  $memberPreviewGet = Get-Response -Uri ([string]($memberPreview.Content | ConvertFrom-Json).url) -Session $member
}
$publicPreview = Get-Response -Uri "$base/api/s/$imageToken/preview-url" -Public
$publicPreviewGet = @{ Status = 0 }
if ($publicPreview.Status -eq 200) {
  $publicPreviewGet = Get-Response -Uri ([string]($publicPreview.Content | ConvertFrom-Json).url) -Public
}
$pdfPreview = Get-Response -Uri "$base/api/files/$($pdf.FileId)/preview-url" -Session $member
$svgPreview = Get-Response -Uri "$base/api/files/$($svg.FileId)/preview-url" -Session $member
$afterPreview = Get-D1Count "SELECT download_count AS n FROM shares WHERE id = '$imageShareId'"
Write-Check "image previews work and do not count as downloads" (
  $image.Ok -and $memberPreview.Status -eq 200 -and $memberPreviewGet.Status -eq 200 -and
  $publicPreview.Status -eq 200 -and $publicPreviewGet.Status -eq 200 -and
  $pdfPreview.Status -eq 404 -and $svgPreview.Status -eq 404 -and $beforePreview -eq $afterPreview
) "member=$($memberPreview.Status)/$($memberPreviewGet.Status) public=$($publicPreview.Status)/$($publicPreviewGet.Status) pdf=$($pdfPreview.Status) svg=$($svgPreview.Status) before=$beforePreview after=$afterPreview"

$linked = Register-User -Email "v2-linked-$stamp@example.com" -Name "Linked" -Session $guest
$linkedShares = Get-Response -Uri "$base/api/shares" -Session $guest
$linkedSeen = $linkedShares.Status -eq 200 -and $linkedShares.Content.Contains($shareId)
$orphanedShares = 1
$orphanedFiles = 1
if ($guestId -ne "") {
  $orphanedShares = Get-D1Count "SELECT count(*) AS n FROM shares WHERE user_id = '$guestId'"
  $orphanedFiles = Get-D1Count "SELECT count(*) AS n FROM files WHERE user_id = '$guestId'"
}
Write-Check "signing up keeps the guest transfer on the new account" (
  $linked.Status -eq 200 -and $linkedSeen -and $orphanedShares -eq 0 -and $orphanedFiles -eq 0
) "signup=$($linked.Status) seen=$linkedSeen shares=$orphanedShares files=$orphanedFiles"

$anonFiles = Get-Response -Uri "$base/api/files" -Public
$anonFolders = Get-Response -Uri "$base/api/folders" -Public
$anonShares = Get-Response -Uri "$base/api/shares" -Public
$anonNotes = Get-Response -Uri "$base/api/notifications" -Public
$anonUnread = Get-Response -Uri "$base/api/notifications/unread-count" -Public
$anonRead = Get-Response -Method POST -Uri "$base/api/notifications/read" -Public -Body "{}"
$anonComments = Get-Response -Uri "$base/api/comments" -Public
$anonActivity = Get-Response -Uri "$base/api/shares/$commentShareId/activity" -Public
$anonPreview = Get-Response -Uri "$base/api/files/$($image.FileId)/preview-url" -Public
$anonTransfer = Get-Response -Method POST -Uri "$base/api/transfers" -Public -Body "{}"
$otherActivity = Get-Response -Uri "$base/api/shares/$commentShareId/activity" -Session $other
$otherTransfer = Get-Response -Method DELETE -Uri "$base/api/transfers/$emptyId" -Session $other
$otherComment = Get-Response -Method DELETE -Uri "$base/api/comments/missing-comment" -Session $other
Write-Check "new routes require auth and hide other owners" (
  $anonFiles.Status -eq 401 -and $anonFolders.Status -eq 401 -and $anonShares.Status -eq 401 -and
  $anonNotes.Status -eq 401 -and $anonUnread.Status -eq 401 -and $anonRead.Status -eq 401 -and
  $anonComments.Status -eq 401 -and $anonActivity.Status -eq 401 -and $anonPreview.Status -eq 401 -and
  $anonTransfer.Status -eq 401 -and $otherActivity.Status -eq 404 -and $otherTransfer.Status -eq 404 -and
  $otherComment.Status -eq 404
) "anon=$($anonFiles.Status),$($anonFolders.Status),$($anonShares.Status),$($anonNotes.Status),$($anonUnread.Status),$($anonRead.Status),$($anonComments.Status),$($anonActivity.Status),$($anonPreview.Status),$($anonTransfer.Status) other=$($otherActivity.Status),$($otherTransfer.Status),$($otherComment.Status)"

$poolBase = "http://127.0.0.1:8799"
$poolLog = Join-Path $dir "pool-wrangler.txt"
$poolErr = Join-Path $dir "pool-wrangler.err"
$poolProc = Start-Process -FilePath (Join-Path $env:APPDATA "npm\pnpm.cmd") -ArgumentList @(
  "--filter", "api", "exec", "wrangler", "dev", "--port", "8799", "--test-scheduled", "--var", "GUEST_POOL_BYTES:10"
) -WorkingDirectory $repo -RedirectStandardOutput $poolLog -RedirectStandardError $poolErr -PassThru -WindowStyle Hidden
$poolReady = $false
$poolDeadline = (Get-Date).AddSeconds(40)
do {
  Start-Sleep -Milliseconds 500
  try {
    $poolHealth = Invoke-WebRequest -Uri "$poolBase/health" -UseBasicParsing
    if ([int]$poolHealth.StatusCode -eq 200) { $poolReady = $true }
  } catch {
    $poolReady = $false
  }
} while (-not $poolReady -and (Get-Date) -lt $poolDeadline)
$poolStatus = 0
if ($poolReady) {
  $poolGuest = Start-Guest -ApiBase $poolBase
  $poolTransfer = Get-Response -Method POST -Uri "$poolBase/api/transfers" -Session $poolGuest.Session -Body "{}"
  $poolFolder = ""
  if ($poolTransfer.Status -eq 201) { $poolFolder = [string]($poolTransfer.Content | ConvertFrom-Json).id }
  $poolUpload = Get-Response -Method POST -Uri "$poolBase/api/files/upload-url" -Session $poolGuest.Session -Body (@{ name = "busy.bin"; size = 11; folderId = $poolFolder } | ConvertTo-Json -Compress)
  $poolStatus = $poolUpload.Status
}
if ($null -ne $poolProc -and -not $poolProc.HasExited) {
  Stop-Process -Id $poolProc.Id -Force -ErrorAction SilentlyContinue
}
Write-Check "guest pool cap returns 503" ($poolReady -and $poolStatus -eq 503) "ready=$poolReady status=$poolStatus"

$soonShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $cappedFile.FileId; expiresInHours = 1 } | ConvertTo-Json -Compress)
$soonId = ""
if ($soonShare.Status -eq 201) { $soonId = [string]($soonShare.Content | ConvertFrom-Json).share.id }
$endedShare = Get-Response -Method POST -Uri "$base/api/shares" -Session $member -Body (@{ fileId = $cappedFile.FileId; expiresInHours = 2 } | ConvertTo-Json -Compress)
$endedId = ""
if ($endedShare.Status -eq 201) { $endedId = [string]($endedShare.Content | ConvertFrom-Json).share.id }
$endedAt = [DateTimeOffset]::UtcNow.AddMinutes(-30).ToUnixTimeSeconds()
Invoke-D1 "UPDATE shares SET expires_at = $endedAt WHERE id = '$endedId'" | Out-Null
$oldNoteId = [guid]::NewGuid().ToString()
$oldEventId = [guid]::NewGuid().ToString()
$oldSeconds = [DateTimeOffset]::UtcNow.AddDays(-31).ToUnixTimeSeconds()
Invoke-D1 "INSERT INTO notifications (id, user_id, type, title, created_at) VALUES ('$oldNoteId', '$memberId', 'share_opened', 'old', $oldSeconds)" | Out-Null
Invoke-D1 "INSERT INTO share_events (id, share_id, type, created_at) VALUES ('$oldEventId', '$commentShareId', 'opened', $oldSeconds)" | Out-Null
$staleTransferId = [guid]::NewGuid().ToString()
$freshTransferId = [guid]::NewGuid().ToString()
$staleCreated = [DateTimeOffset]::UtcNow.AddHours(-3).ToUnixTimeSeconds()
$freshCreated = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Invoke-D1 "INSERT INTO folders (id, user_id, parent_id, name, created_at, kind) VALUES ('$staleTransferId', '$memberId', NULL, 'Old transfer', $staleCreated, 'transfer')" | Out-Null
Invoke-D1 "INSERT INTO folders (id, user_id, parent_id, name, created_at, kind) VALUES ('$freshTransferId', '$memberId', NULL, 'New transfer', $freshCreated, 'transfer')" | Out-Null
$oldGuest = [guid]::NewGuid().ToString()
$keptGuest = [guid]::NewGuid().ToString()
$oldGuestMs = [DateTimeOffset]::UtcNow.AddDays(-15).ToUnixTimeMilliseconds()
$keptFile = [guid]::NewGuid().ToString()
$future = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeSeconds()
Invoke-D1 "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES ('$oldGuest', 'Guest', 'old-$stamp@guest.transfile.invalid', 0, $oldGuestMs, $oldGuestMs, 1)" | Out-Null
Invoke-D1 "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, is_anonymous) VALUES ('$keptGuest', 'Guest', 'kept-$stamp@guest.transfile.invalid', 0, $oldGuestMs, $oldGuestMs, 1)" | Out-Null
Invoke-D1 "INSERT INTO files (id, user_id, folder_id, name, r2_key, size, mime, status, created_at, deleted_at, expires_at) VALUES ('$keptFile', '$keptGuest', NULL, 'keep.bin', '$keptGuest/$keptFile', 4, 'application/octet-stream', 'ready', $freshCreated, NULL, $future)" | Out-Null
$cron = Invoke-Cron
$expiring = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId' AND type = 'share_expiring' AND share_id = '$soonId'"
$expired = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId' AND type = 'share_expired' AND share_id = '$endedId'"
Invoke-Cron | Out-Null
$expiringAgain = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId' AND type = 'share_expiring' AND share_id = '$soonId'"
$expiredAgain = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE user_id = '$memberId' AND type = 'share_expired' AND share_id = '$endedId'"
$oldNoteLeft = Get-D1Count "SELECT count(*) AS n FROM notifications WHERE id = '$oldNoteId'"
$oldEventLeft = Get-D1Count "SELECT count(*) AS n FROM share_events WHERE id = '$oldEventId'"
$staleLeft = Get-D1Count "SELECT count(*) AS n FROM folders WHERE id = '$staleTransferId'"
$freshLeft = Get-D1Count "SELECT count(*) AS n FROM folders WHERE id = '$freshTransferId'"
$oldGuestLeft = Get-D1Count "SELECT count(*) AS n FROM user WHERE id = '$oldGuest'"
$keptGuestLeft = Get-D1Count "SELECT count(*) AS n FROM user WHERE id = '$keptGuest'"
Write-Check "cron notifies, purges, and deletes empty transfers and old guests" (
  $cron.Status -lt 400 -and $expiring -eq 1 -and $expired -eq 1 -and $expiringAgain -eq 1 -and $expiredAgain -eq 1 -and
  $oldNoteLeft -eq 0 -and $oldEventLeft -eq 0 -and $staleLeft -eq 0 -and $freshLeft -eq 1 -and
  $oldGuestLeft -eq 0 -and $keptGuestLeft -eq 1
) "cron=$($cron.Status) expiring=$expiring/$expiringAgain expired=$expired/$expiredAgain note=$oldNoteLeft event=$oldEventLeft stale=$staleLeft fresh=$freshLeft oldGuest=$oldGuestLeft keptGuest=$keptGuestLeft"

if ($failed) { exit 1 }
exit 0
