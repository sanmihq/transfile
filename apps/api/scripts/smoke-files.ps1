$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
$origin = @{ Origin = "http://localhost:5173" }
$failed = $false

function Write-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  if ($Ok) {
    Write-Output "PASS $Name"
  } else {
    Write-Output "FAIL $Name $Detail"
    $script:failed = $true
  }
}

function Test-DirectStorageUrl {
  param([string]$Uri)
  $target = [Uri]$Uri
  $api = [Uri]$base
  return $target.Host -ne $api.Host
}

function Get-UploadHeaders {
  param($Upload)
  $headers = @{}
  if ($null -eq $Upload -or $null -eq $Upload.headers) { return $headers }
  foreach ($property in $Upload.headers.PSObject.Properties) {
    $headers[$property.Name] = [string]$property.Value
  }
  return $headers
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
    [switch]$Direct
  )
  $headers = @{}
  if (-not $Direct) {
    $headers["Origin"] = "http://localhost:5173"
  }
  if ($null -ne $ExtraHeaders) {
    foreach ($key in @($ExtraHeaders.Keys)) {
      $headers[$key] = [string]$ExtraHeaders[$key]
    }
  }
  $params = @{
    Method = $Method
    Uri = $Uri
  }
  if ($headers.Count -gt 0) { $params.Headers = $headers }
  if ($null -ne $Session -and -not $Direct) { $params.WebSession = $Session }
  if ($Body -ne "") {
    $params.ContentType = "application/json"
    $params.Body = $Body
  }
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
    $status = [int]$http.StatusCode
    $stream = $http.GetResponseStream()
    $content = ""
    if ($null -ne $stream) {
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
      $reader.Dispose()
    }
    return @{ Status = $status; Content = $content }
  }
}

function Register-User {
  param([string]$Email, [string]$Name)
  $body = (@{ email = $Email; password = "password1234"; name = $Name } | ConvertTo-Json -Compress)
  $response = Invoke-WebRequest -Method POST -Uri "$base/api/auth/sign-up/email" -ContentType "application/json" -Headers $origin -Body $body -SessionVariable captured
  if ([int]$response.StatusCode -ne 200) {
    throw "sign-up failed for $Email status=$($response.StatusCode) body=$($response.Content)"
  }
  return $captured
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-smoke-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "test-file.bin"
$downloaded = Join-Path $dir "downloaded.bin"
$tooBig = Join-Path $dir "too-big.bin"

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] (1MB)
$rng.GetBytes($bytes)
[System.IO.File]::WriteAllBytes($source, $bytes)
$small = New-Object byte[] 2000
$rng.GetBytes($small)
[System.IO.File]::WriteAllBytes($tooBig, $small)

$sessionA = Register-User -Email "file-a-$stamp@example.com" -Name "User A"
$sessionB = Register-User -Email "file-b-$stamp@example.com" -Name "User B"

$usage = Get-Response -Uri "$base/api/usage" -Session $sessionA
$usageBody = $usage.Content | ConvertFrom-Json
Write-Check "A usage starts at 0" ($usage.Status -eq 200 -and $usageBody.used -eq 0) "status=$($usage.Status) body=$($usage.Content)"

$size = (Get-Item $source).Length
$uploadBody = (@{ name = "test file.bin"; size = $size } | ConvertTo-Json -Compress)
$created = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body $uploadBody
if ($created.Status -ne 201) {
  Write-Check "A upload-url" $false "status=$($created.Status) body=$($created.Content)"
  exit 1
}
$createdJson = $created.Content | ConvertFrom-Json
$uploadDirect = Test-DirectStorageUrl $createdJson.upload.url
$uploadHeaders = Get-UploadHeaders $createdJson.upload
if ($uploadDirect) {
  $put = Get-Response -Method PUT -Uri $createdJson.upload.url -InFile $source -ExtraHeaders $uploadHeaders -Direct
} else {
  $put = Get-Response -Method PUT -Uri $createdJson.upload.url -Session $sessionA -InFile $source
}
$complete = Get-Response -Method POST -Uri "$base/api/files/$($createdJson.file.id)/complete" -Session $sessionA
Write-Check "A upload put and complete" ($put.Status -eq 204 -and $complete.Status -eq 200) "put=$($put.Status) complete=$($complete.Status) $($complete.Content)"

$list = Get-Response -Uri "$base/api/files?folderId=root" -Session $sessionA
$listJson = @($list.Content | ConvertFrom-Json)
$listed = $list.Status -eq 200 -and ($listJson | Where-Object { $_.id -eq $createdJson.file.id -and $_.name -eq "test file.bin" })
Write-Check "A list shows the file" ([bool]$listed) "status=$($list.Status) body=$($list.Content)"

$downloadMeta = Get-Response -Uri "$base/api/files/$($createdJson.file.id)/download-url" -Session $sessionA
$downloadUrl = ""
if ($downloadMeta.Status -eq 200) {
  $downloadUrl = ($downloadMeta.Content | ConvertFrom-Json).url
  if (Test-DirectStorageUrl $downloadUrl) {
    Get-Response -Uri $downloadUrl -OutFile $downloaded -Direct | Out-Null
  } else {
    Get-Response -Uri $downloadUrl -Session $sessionA -OutFile $downloaded | Out-Null
  }
}
$hashOk = $false
if (Test-Path $downloaded) {
  $originalHash = (Get-FileHash -Algorithm SHA256 -Path $source).Hash
  $downloadedHash = (Get-FileHash -Algorithm SHA256 -Path $downloaded).Hash
  $hashOk = $originalHash -eq $downloadedHash
}
Write-Check "A download hash matches" ($downloadMeta.Status -eq 200 -and $hashOk) "status=$($downloadMeta.Status)"

$renamed = Get-Response -Method PATCH -Uri "$base/api/files/$($createdJson.file.id)" -Session $sessionA -Body '{"name":"renamed file.bin"}'
$renamedOk = $false
if ($renamed.Status -eq 200) {
  $renamedOk = ($renamed.Content | ConvertFrom-Json).name -eq "renamed file.bin"
}
Write-Check "A rename" $renamedOk "status=$($renamed.Status) body=$($renamed.Content)"

$deleted = Get-Response -Method DELETE -Uri "$base/api/files/$($createdJson.file.id)" -Session $sessionA
$afterDelete = Get-Response -Uri "$base/api/files" -Session $sessionA
$stillListed = $false
if ($afterDelete.Status -eq 200 -and $afterDelete.Content -ne "") {
  $stillListed = [bool]@($afterDelete.Content | ConvertFrom-Json | Where-Object { $_.id -eq $createdJson.file.id })
}
$downloadAfterDelete = Get-Response -Uri "$base/api/files/$($createdJson.file.id)/download-url" -Session $sessionA
Write-Check "A delete hides the file" ($deleted.Status -eq 204 -and -not $stillListed -and $downloadAfterDelete.Status -eq 404) "delete=$($deleted.Status) listed=$stillListed download=$($downloadAfterDelete.Status) $($downloadAfterDelete.Content)"

$second = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body '{"name":"owned.bin","size":1000}'
if ($second.Status -ne 201) {
  Write-Check "A second upload" $false "status=$($second.Status) body=$($second.Content)"
  exit 1
}
$ownedId = ($second.Content | ConvertFrom-Json).file.id
$bComplete = Get-Response -Method POST -Uri "$base/api/files/$ownedId/complete" -Session $sessionB
$bDownload = Get-Response -Uri "$base/api/files/$ownedId/download-url" -Session $sessionB
$bPatch = Get-Response -Method PATCH -Uri "$base/api/files/$ownedId" -Session $sessionB -Body '{"name":"stolen.bin"}'
$bDelete = Get-Response -Method DELETE -Uri "$base/api/files/$ownedId" -Session $sessionB
Write-Check "B cannot complete A's file" ($bComplete.Status -eq 404) "status=$($bComplete.Status) body=$($bComplete.Content)"
Write-Check "B cannot download A's file" ($bDownload.Status -eq 404) "status=$($bDownload.Status) body=$($bDownload.Content)"
Write-Check "B cannot rename A's file" ($bPatch.Status -eq 404) "status=$($bPatch.Status) body=$($bPatch.Content)"
Write-Check "B cannot delete A's file" ($bDelete.Status -eq 404) "status=$($bDelete.Status) body=$($bDelete.Content)"

$overMax = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body '{"name":"huge.bin","size":104857601}'
Write-Check "size above 100 MB is rejected" ($overMax.Status -eq 400) "status=$($overMax.Status) body=$($overMax.Content)"

$short = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body '{"name":"short.bin","size":1000}'
$shortRejected = $false
if ($short.Status -eq 201) {
  $shortJson = $short.Content | ConvertFrom-Json
  $shortUrl = $shortJson.upload.url
  $shortHeaders = Get-UploadHeaders $shortJson.upload
  if (Test-DirectStorageUrl $shortUrl) {
    $shortPut = Get-Response -Method PUT -Uri $shortUrl -InFile $tooBig -ExtraHeaders $shortHeaders -Direct
  } else {
    $shortPut = Get-Response -Method PUT -Uri $shortUrl -Session $sessionA -InFile $tooBig
  }
  $shortRejected = $shortPut.Status -eq 413 -or $shortPut.Status -eq 400
  if (-not $shortRejected -and $shortPut.Status -ge 200 -and $shortPut.Status -lt 300) {
    $shortComplete = Get-Response -Method POST -Uri "$base/api/files/$($shortJson.file.id)/complete" -Session $sessionA
    $shortRejected = $shortComplete.Status -eq 400
  }
  Write-Check "PUT larger than declared size is rejected" $shortRejected "status=$($shortPut.Status) body=$($shortPut.Content)"
} else {
  Write-Check "PUT larger than declared size is rejected" $false "upload-url status=$($short.Status) body=$($short.Content)"
}

$anon = Get-Response -Uri "$base/api/files"
Write-Check "unauthenticated list is 401" ($anon.Status -eq 401) "status=$($anon.Status) body=$($anon.Content)"

if ($failed) { exit 1 }
exit 0
