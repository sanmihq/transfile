$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
$origin = "http://localhost:5173"
$apiDir = Split-Path -Parent $PSScriptRoot

function Redact([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return "" }
  $clean = [regex]::Replace($Text, "https?://\S+", "[redacted-url]")
  $clean = [regex]::Replace($clean, '"accessToken"\s*:\s*"[^"]*"', '"accessToken":"[redacted]"')
  $clean = [regex]::Replace($clean, '"url"\s*:\s*"[^"]*"', '"url":"[redacted]"')
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

function Get-Response {
  param(
    [string]$Method = "GET",
    [Parameter(Mandatory = $true)][string]$Uri,
    $Session,
    [string]$Body,
    [string]$InFile,
    [string]$OutFile,
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
  if ($OutFile -ne "") { $params.OutFile = $OutFile }
  try {
    $response = Invoke-WebRequest @params
    $content = ""
    if ($OutFile -eq "" -and $null -ne $response.Content) { $content = [string]$response.Content }
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
  if ([int]$response.StatusCode -ne 200) { throw "sign-up failed status=$($response.StatusCode)" }
  return $captured
}

function Send-ReadyFile {
  param($Session, [string]$Name, [string]$FolderId, [string]$Path)
  $size = (Get-Item $Path).Length
  $payload = @{ name = $Name; size = $size }
  if ($FolderId -ne "") { $payload.folderId = $FolderId }
  $created = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $Session -Body ($payload | ConvertTo-Json -Compress)
  if ($created.Status -ne 201) { return @{ Ok = $false; Detail = "upload-url $($created.Status) $(Redact $created.Content)" } }
  $json = $created.Content | ConvertFrom-Json
  $direct = ([Uri]$json.upload.url).Host -ne ([Uri]$base).Host
  if ($direct) {
    $uploadHeaders = @{}
    if ($null -ne $json.upload.headers) {
      foreach ($property in $json.upload.headers.PSObject.Properties) {
        $uploadHeaders[$property.Name] = [string]$property.Value
      }
    }
    $put = Get-Response -Method PUT -Uri $json.upload.url -InFile $Path -ExtraHeaders $uploadHeaders -Direct
  } else {
    $put = Get-Response -Method PUT -Uri $json.upload.url -Session $Session -InFile $Path
  }
  $putOk = $put.Status -eq 204 -or ($direct -and $put.Status -eq 200)
  $complete = Get-Response -Method POST -Uri "$base/api/files/$($json.file.id)/complete" -Session $Session
  return @{ Ok = ($putOk -and $complete.Status -eq 200); FileId = [string]$json.file.id; Detail = "put=$($put.Status) complete=$($complete.Status)" }
}

function New-Folder {
  param($Session, [string]$Name, [string]$ParentId)
  $payload = @{ name = $Name }
  if ($ParentId -ne "") { $payload.parentId = $ParentId }
  return Get-Response -Method POST -Uri "$base/api/folders" -Session $Session -Body ($payload | ConvertTo-Json -Compress)
}

function New-Share {
  param($Session, [string]$Body)
  return Get-Response -Method POST -Uri "$base/api/shares" -Session $Session -Body $Body
}

function Get-Token([string]$Url) {
  return [Uri]::UnescapeDataString(([Uri]$Url).Segments[-1])
}

function Convert-JsonList([string]$Json) {
  if ([string]::IsNullOrEmpty($Json)) { return }
  $parsed = $Json | ConvertFrom-Json
  foreach ($item in $parsed) { $item }
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-share-smoke-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "source.bin"
$downloaded = Join-Path $dir "downloaded.bin"
$bytes = New-Object byte[] 256
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[System.IO.File]::WriteAllBytes($source, $bytes)
$size = $bytes.Length

$sessionA = Register-User -Email "share-a-$stamp@example.com" -Name "User A"
$sessionB = Register-User -Email "share-b-$stamp@example.com" -Name "User B"

$openFile = Send-ReadyFile -Session $sessionA -Name "open.bin" -FolderId "" -Path $source
if (-not $openFile.Ok) { Write-Check "prepare open file" $false $openFile.Detail }
$created = New-Share -Session $sessionA -Body (@{ fileId = $openFile.FileId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$createdJson = $null
if ($created.Status -eq 201) { $createdJson = $created.Content | ConvertFrom-Json }
$openToken = ""
if ($null -ne $createdJson -and $createdJson.url) { $openToken = Get-Token $createdJson.url }
Write-Check "create file share" ($created.Status -eq 201 -and $createdJson.url -match "/s/.+" -and $created.Content -notmatch "passwordHash") "status=$($created.Status)"

$meta = Get-Response -Uri "$base/api/s/$openToken" -Public
$metaJson = $null
if ($meta.Status -eq 200) { $metaJson = $meta.Content | ConvertFrom-Json }
Write-Check "public metadata" ($meta.Status -eq 200 -and $metaJson.type -eq "file" -and $metaJson.name -eq "open.bin" -and [int]$metaJson.size -eq $size) "status=$($meta.Status)"

$downloadMeta = Get-Response -Uri "$base/api/s/$openToken/download-url" -Public
$saved = $false
$hashOk = $false
if ($downloadMeta.Status -eq 200) {
  $downloadUrl = [string]($downloadMeta.Content | ConvertFrom-Json).url
  $downloadUri = [Uri]$downloadUrl
  $crossHost = $downloadUri.Host -ne ([Uri]$base).Host
  if ($crossHost) {
    $tokenInPath = $downloadUri.AbsolutePath.Contains($openToken)
    Write-Check "share download url is presigned on another host" (-not $tokenInPath) "pathHasToken=$tokenInPath"
    Get-Response -Uri $downloadUrl -OutFile $downloaded -Direct | Out-Null
  } else {
    Get-Response -Uri $downloadUrl -OutFile $downloaded -Public | Out-Null
  }
  if (Test-Path $downloaded) {
    $saved = $true
    $hashOk = (Get-FileHash -Algorithm SHA256 -Path $source).Hash -eq (Get-FileHash -Algorithm SHA256 -Path $downloaded).Hash
  }
}
Write-Check "public download hash matches" ($downloadMeta.Status -eq 200 -and $saved -and $hashOk) "status=$($downloadMeta.Status)"

$secretFile = Send-ReadyFile -Session $sessionA -Name "secret.bin" -FolderId "" -Path $source
if (-not $secretFile.Ok) { Write-Check "prepare secret file" $false $secretFile.Detail }
$passwordShare = New-Share -Session $sessionA -Body (@{ fileId = $secretFile.FileId; password = "secret1"; expiresInHours = 24 } | ConvertTo-Json -Compress)
$passwordJson = $passwordShare.Content | ConvertFrom-Json
$passwordToken = Get-Token $passwordJson.url
$lockedMeta = Get-Response -Uri "$base/api/s/$passwordToken" -Public
$lockedJson = $lockedMeta.Content | ConvertFrom-Json
$hidden = $null -eq $lockedJson.PSObject.Properties["name"] -and $null -eq $lockedJson.PSObject.Properties["size"]
$noHeader = Get-Response -Uri "$base/api/s/$passwordToken/download-url" -Public
$wrong = Get-Response -Method POST -Uri "$base/api/s/$passwordToken/unlock" -Public -Body '{"password":"wrong-password"}'
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$right = Get-Response -Method POST -Uri "$base/api/s/$passwordToken/unlock" -Public -Body '{"password":"secret1"}'
$timer.Stop()
Write-Output "UNLOCK_MS $($timer.ElapsedMilliseconds)"
$accessToken = ""
if ($right.Status -eq 200) { $accessToken = [string]($right.Content | ConvertFrom-Json).accessToken }
$withHeader = Get-Response -Uri "$base/api/s/$passwordToken/download-url" -Public -ExtraHeaders @{ "X-Share-Access" = $accessToken }
Write-Check "password share gates downloads" ($lockedMeta.Status -eq 200 -and $lockedJson.requiresPassword -eq $true -and $hidden -and $noHeader.Status -eq 401 -and $wrong.Status -eq 401 -and $right.Status -eq 200 -and $accessToken -ne "" -and $withHeader.Status -eq 200) "meta=$($lockedMeta.Status) hidden=$hidden noHeader=$($noHeader.Status) wrong=$($wrong.Status) right=$($right.Status) download=$($withHeader.Status)"

$otherShare = New-Share -Session $sessionA -Body (@{ fileId = $secretFile.FileId; password = "secret2"; expiresInHours = 24 } | ConvertTo-Json -Compress)
$otherToken = Get-Token ($otherShare.Content | ConvertFrom-Json).url
$crossed = Get-Response -Uri "$base/api/s/$otherToken/download-url" -Public -ExtraHeaders @{ "X-Share-Access" = $accessToken }
Write-Check "access token does not cross shares" ($crossed.Status -eq 401) "status=$($crossed.Status)"

$lockShare = New-Share -Session $sessionA -Body (@{ fileId = $secretFile.FileId; password = "lockpass"; expiresInHours = 24 } | ConvertTo-Json -Compress)
$lockToken = Get-Token ($lockShare.Content | ConvertFrom-Json).url
$wrongStatuses = @()
for ($attempt = 0; $attempt -lt 5; $attempt++) {
  $attemptResponse = Get-Response -Method POST -Uri "$base/api/s/$lockToken/unlock" -Public -Body '{"password":"nope"}'
  $wrongStatuses += $attemptResponse.Status
}
$lockedOut = Get-Response -Method POST -Uri "$base/api/s/$lockToken/unlock" -Public -Body '{"password":"lockpass"}'
$fiveWrong = @($wrongStatuses | Where-Object { $_ -eq 401 }).Count -eq 5
Write-Check "five failures lock the share" ($fiveWrong -and $lockedOut.Status -eq 429) "wrongs=$($wrongStatuses -join ',') correct=$($lockedOut.Status)"

$limitFile = Send-ReadyFile -Session $sessionA -Name "limit.bin" -FolderId "" -Path $source
if (-not $limitFile.Ok) { Write-Check "prepare limit file" $false $limitFile.Detail }
$oneShare = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; expiresInHours = 24; maxDownloads = 1 } | ConvertTo-Json -Compress)
$oneToken = Get-Token ($oneShare.Content | ConvertFrom-Json).url
$firstDownload = Get-Response -Uri "$base/api/s/$oneToken/download-url" -Public
$secondDownload = Get-Response -Uri "$base/api/s/$oneToken/download-url" -Public
$raceShare = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; expiresInHours = 24; maxDownloads = 2 } | ConvertTo-Json -Compress)
$raceToken = Get-Token ($raceShare.Content | ConvertFrom-Json).url
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
[void]$client.DefaultRequestHeaders.TryAddWithoutValidation("Origin", $origin)
$tasks = @()
for ($i = 0; $i -lt 5; $i++) { $tasks += $client.GetAsync("$base/api/s/$raceToken/download-url") }
[System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$tasks)
$raceCodes = @()
foreach ($task in $tasks) {
  $raceCodes += [int]$task.Result.StatusCode
  $task.Result.Dispose()
}
$client.Dispose()
$raceSuccess = @($raceCodes | Where-Object { $_ -eq 200 }).Count
Write-Check "download limit is atomic" ($firstDownload.Status -eq 200 -and $secondDownload.Status -eq 410 -and $raceSuccess -eq 2) "first=$($firstDownload.Status) second=$($secondDownload.Status) race=$($raceCodes -join ',')"

$expireShare = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$expireJson = $expireShare.Content | ConvertFrom-Json
$expireToken = Get-Token $expireJson.url
if ($expireJson.share.id -notmatch '^[0-9a-fA-F-]{36}$') { throw "unexpected share id" }
pnpm --dir $apiDir exec wrangler d1 execute transfile-db --local --command "UPDATE shares SET expires_at = 1 WHERE id = '$($expireJson.share.id)'" | Out-Null
$expired = Get-Response -Uri "$base/api/s/$expireToken" -Public
Write-Check "expired share is unavailable" ($expired.Status -eq 410) "status=$($expired.Status)"

$revokeShare = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$revokeJson = $revokeShare.Content | ConvertFrom-Json
$revokeToken = Get-Token $revokeJson.url
$revoked = Get-Response -Method DELETE -Uri "$base/api/shares/$($revokeJson.share.id)" -Session $sessionA
$afterRevoke = Get-Response -Uri "$base/api/s/$revokeToken" -Public
$ownerList = Get-Response -Uri "$base/api/shares" -Session $sessionA
$revokedStatus = ""
if ($ownerList.Status -eq 200) {
  $items = @(Convert-JsonList $ownerList.Content)
  $match = @($items | Where-Object { $_.id -eq $revokeJson.share.id })
  if ($match.Count -eq 1) { $revokedStatus = [string]$match[0].status }
}
Write-Check "owner revoke hides the link" ($revoked.Status -eq 204 -and $afterRevoke.Status -eq 410 -and $revokedStatus -eq "revoked") "delete=$($revoked.Status) public=$($afterRevoke.Status) status=$revokedStatus"

$patchShare = New-Share -Session $sessionA -Body (@{ fileId = $secretFile.FileId; password = "before1"; expiresInHours = 24; maxDownloads = 4 } | ConvertTo-Json -Compress)
$patchJson = $patchShare.Content | ConvertFrom-Json
$patchToken = Get-Token $patchJson.url
$oldUnlock = Get-Response -Method POST -Uri "$base/api/s/$patchToken/unlock" -Public -Body '{"password":"before1"}'
$oldAccess = ""
if ($oldUnlock.Status -eq 200) { $oldAccess = [string]($oldUnlock.Content | ConvertFrom-Json).accessToken }
$patched = Get-Response -Method PATCH -Uri "$base/api/shares/$($patchJson.share.id)" -Session $sessionA -Body '{"expiresInHours":48,"maxDownloads":9,"password":"afterpass"}'
$patchedJson = $null
if ($patched.Status -eq 200) { $patchedJson = $patched.Content | ConvertFrom-Json }
$oldRejected = Get-Response -Uri "$base/api/s/$patchToken/download-url" -Public -ExtraHeaders @{ "X-Share-Access" = $oldAccess }
$extended = $false
if ($null -ne $patchedJson) {
  $extended = [int]$patchedJson.maxDownloads -eq 9 -and ([datetime]$patchedJson.expiresAt) -gt ([datetime]$patchJson.share.expiresAt)
}
Write-Check "patch extends the share and invalidates the token" ($patched.Status -eq 200 -and $extended -and $oldRejected.Status -eq 401) "status=$($patched.Status) extended=$extended old=$($oldRejected.Status)"

$docs = New-Folder -Session $sessionA -Name "Docs" -ParentId ""
$docsId = ($docs.Content | ConvertFrom-Json).id
$sub = New-Folder -Session $sessionA -Name "Sub" -ParentId $docsId
$subId = ($sub.Content | ConvertFrom-Json).id
$docsFile = Send-ReadyFile -Session $sessionA -Name "docs.bin" -FolderId $docsId -Path $source
$subFile = Send-ReadyFile -Session $sessionA -Name "sub.bin" -FolderId $subId -Path $source
$outside = Send-ReadyFile -Session $sessionA -Name "outside.bin" -FolderId "" -Path $source
if (-not ($docs.Status -eq 201 -and $sub.Status -eq 201 -and $docsFile.Ok -and $subFile.Ok -and $outside.Ok)) {
  Write-Check "prepare folder tree" $false "docs=$($docs.Status) sub=$($sub.Status) $($docsFile.Detail) $($subFile.Detail) $($outside.Detail)"
}
$folderShare = New-Share -Session $sessionA -Body (@{ folderId = $docsId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$folderToken = Get-Token ($folderShare.Content | ConvertFrom-Json).url
$rootContents = Get-Response -Uri "$base/api/s/$folderToken/contents" -Public
$rootJson = $rootContents.Content | ConvertFrom-Json
$hasSub = [bool]@($rootJson.folders | Where-Object { $_.id -eq $subId })
$hasDocsFile = [bool]@($rootJson.files | Where-Object { $_.id -eq $docsFile.FileId })
$subContents = Get-Response -Uri "$base/api/s/$folderToken/contents?folderId=$subId" -Public
$subJson = $subContents.Content | ConvertFrom-Json
$hasSubFile = [bool]@($subJson.files | Where-Object { $_.id -eq $subFile.FileId })
$subDownload = Get-Response -Uri "$base/api/s/$folderToken/download-url?fileId=$($subFile.FileId)" -Public
$outsideDownload = Get-Response -Uri "$base/api/s/$folderToken/download-url?fileId=$($outside.FileId)" -Public
$bFolder = New-Folder -Session $sessionB -Name "BFolder" -ParentId ""
$bFolderId = ($bFolder.Content | ConvertFrom-Json).id
$foreignContents = Get-Response -Uri "$base/api/s/$folderToken/contents?folderId=$bFolderId" -Public
Write-Check "folder share stays inside its subtree" ($rootContents.Status -eq 200 -and $hasSub -and $hasDocsFile -and $subContents.Status -eq 200 -and $hasSubFile -and $subDownload.Status -eq 200 -and $outsideDownload.Status -eq 404 -and $foreignContents.Status -eq 404) "root=$($rootContents.Status) sub=$($subContents.Status) download=$($subDownload.Status) outside=$($outsideDownload.Status) foreign=$($foreignContents.Status)"

$deletedFile = Get-Response -Method DELETE -Uri "$base/api/files/$($openFile.FileId)" -Session $sessionA
$afterDelete = Get-Response -Uri "$base/api/s/$openToken" -Public
Write-Check "deleted file closes the link" ($deletedFile.Status -eq 204 -and $afterDelete.Status -eq 410) "delete=$($deletedFile.Status) public=$($afterDelete.Status)"

$unknown = Get-Response -Uri "$base/api/s/not-a-real-share-token" -Public
Write-Check "unknown token is 404" ($unknown.Status -eq 404) "status=$($unknown.Status)"

$both = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; folderId = $docsId } | ConvertTo-Json -Compress)
$neither = New-Share -Session $sessionA -Body "{}"
$tooLong = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; expiresInHours = 721 } | ConvertTo-Json -Compress)
$zeroDownloads = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; maxDownloads = 0 } | ConvertTo-Json -Compress)
$shortPassword = New-Share -Session $sessionA -Body (@{ fileId = $limitFile.FileId; password = "abc" } | ConvertTo-Json -Compress)
Write-Check "invalid share bodies are rejected" ($both.Status -eq 400 -and $neither.Status -eq 400 -and $tooLong.Status -eq 400 -and $zeroDownloads.Status -eq 400 -and $shortPassword.Status -eq 400) "both=$($both.Status) neither=$($neither.Status) hours=$($tooLong.Status) downloads=$($zeroDownloads.Status) password=$($shortPassword.Status)"

$bFile = New-Share -Session $sessionB -Body (@{ fileId = $limitFile.FileId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$bFolderShare = New-Share -Session $sessionB -Body (@{ folderId = $docsId; expiresInHours = 24 } | ConvertTo-Json -Compress)
$bList = Get-Response -Uri "$base/api/shares" -Session $sessionB
$seesA = $false
if ($bList.Status -eq 200 -and $bList.Content -ne "") {
  $ids = @(Convert-JsonList $bList.Content | ForEach-Object { $_.id })
  $seesA = $ids -contains ($folderShare.Content | ConvertFrom-Json).share.id
}
$bPatch = Get-Response -Method PATCH -Uri "$base/api/shares/$($revokeJson.share.id)" -Session $sessionB -Body '{"expiresInHours":48}'
$bDelete = Get-Response -Method DELETE -Uri "$base/api/shares/$($revokeJson.share.id)" -Session $sessionB
Write-Check "B cannot use A's shares" ($bFile.Status -eq 404 -and $bFolderShare.Status -eq 404 -and -not $seesA -and $bPatch.Status -eq 404 -and $bDelete.Status -eq 404) "file=$($bFile.Status) folder=$($bFolderShare.Status) listed=$seesA patch=$($bPatch.Status) delete=$($bDelete.Status)"

$anonGet = Get-Response -Uri "$base/api/shares" -Public
$anonPost = Get-Response -Method POST -Uri "$base/api/shares" -Public -Body (@{ fileId = $limitFile.FileId } | ConvertTo-Json -Compress)
Write-Check "unauthenticated owner routes are 401" ($anonGet.Status -eq 401 -and $anonPost.Status -eq 401) "get=$($anonGet.Status) post=$($anonPost.Status)"

exit 0
