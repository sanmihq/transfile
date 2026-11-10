$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
$origin = @{ Origin = "http://localhost:5173" }

function Write-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail)
  if ($Ok) {
    Write-Output "PASS $Name"
  } else {
    Write-Output "FAIL $Name $Detail"
    exit 1
  }
}

function Get-Response {
  param(
    [string]$Method = "GET",
    [Parameter(Mandatory = $true)][string]$Uri,
    $Session,
    [string]$Body,
    [string]$InFile
  )
  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $origin
  }
  if ($null -ne $Session) { $params.WebSession = $Session }
  if ($Body -ne "") {
    $params.ContentType = "application/json"
    $params.Body = $Body
  }
  if ($InFile -ne "") { $params.InFile = $InFile }
  try {
    $response = Invoke-WebRequest @params
    $content = ""
    if ($null -ne $response.Content) { $content = [string]$response.Content }
    return @{ Status = [int]$response.StatusCode; Content = $content }
  } catch [System.Net.WebException] {
    $http = $_.Exception.Response
    if ($null -eq $http) { throw }
    $status = [int]$http.StatusCode
    $content = ""
    if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message) {
      $content = [string]$_.ErrorDetails.Message
    }
    if ($content -eq "") {
      $stream = $http.GetResponseStream()
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
        $reader.Dispose()
      }
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

function New-Folder {
  param($Session, [string]$Name, [string]$ParentId)
  $payload = @{ name = $Name }
  if ($ParentId -ne "") { $payload.parentId = $ParentId }
  $body = $payload | ConvertTo-Json -Compress
  return Get-Response -Method POST -Uri "$base/api/folders" -Session $Session -Body $body
}

function As-List($value) {
  if ($null -eq $value) { return @() }
  return @($value)
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$dir = Join-Path $env:TEMP "transfile-folder-smoke-$stamp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Join-Path $dir "invoice.bin"
$bytes = New-Object byte[] 128
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[System.IO.File]::WriteAllBytes($source, $bytes)

$sessionA = Register-User -Email "folder-a-$stamp@example.com" -Name "User A"
$sessionB = Register-User -Email "folder-b-$stamp@example.com" -Name "User B"

$projects = New-Folder -Session $sessionA -Name "Projects" -ParentId ""
if ($projects.Status -ne 201) {
  Write-Check "create Projects" $false "status=$($projects.Status) body=$($projects.Content)"
}
$projectsId = ($projects.Content | ConvertFrom-Json).id
$year = New-Folder -Session $sessionA -Name "2026" -ParentId $projectsId
if ($year.Status -ne 201) {
  Write-Check "create 2026" $false "status=$($year.Status) body=$($year.Content)"
}
$yearId = ($year.Content | ConvertFrom-Json).id
$invoices = New-Folder -Session $sessionA -Name "Invoices" -ParentId $yearId
if ($invoices.Status -ne 201) {
  Write-Check "create Invoices" $false "status=$($invoices.Status) body=$($invoices.Content)"
}
$invoicesId = ($invoices.Content | ConvertFrom-Json).id

$crumbResponse = Get-Response -Uri "$base/api/folders?parentId=$invoicesId" -Session $sessionA
$crumbNames = ""
if ($crumbResponse.Status -eq 200) {
  $crumbNames = ((As-List (($crumbResponse.Content | ConvertFrom-Json).breadcrumbs)) | ForEach-Object { $_.name }) -join ","
}
Write-Check "breadcrumbs are Projects, 2026, Invoices" ($crumbResponse.Status -eq 200 -and $crumbNames -eq "Projects,2026,Invoices") "status=$($crumbResponse.Status) breadcrumbs=$crumbNames body=$($crumbResponse.Content)"

$size = (Get-Item $source).Length
$uploadBody = (@{ name = "invoice.bin"; size = $size; folderId = $invoicesId } | ConvertTo-Json -Compress)
$created = Get-Response -Method POST -Uri "$base/api/files/upload-url" -Session $sessionA -Body $uploadBody
if ($created.Status -ne 201) {
  Write-Check "upload into Invoices" $false "upload-url status=$($created.Status) body=$($created.Content)"
}
$createdJson = $created.Content | ConvertFrom-Json
$put = Get-Response -Method PUT -Uri $createdJson.upload.url -Session $sessionA -InFile $source
$complete = Get-Response -Method POST -Uri "$base/api/files/$($createdJson.file.id)/complete" -Session $sessionA
$fileId = $createdJson.file.id
$putOk = $put.Status -eq 204 -or ((([Uri]$createdJson.upload.url).Host -ne ([Uri]$base).Host) -and $put.Status -eq 200)
$inFolder = Get-Response -Uri "$base/api/folders?parentId=$invoicesId" -Session $sessionA
$atRoot = Get-Response -Uri "$base/api/folders?parentId=root" -Session $sessionA
$inFolderHit = $false
$atRootHit = $false
if ($inFolder.Status -eq 200) {
  $inFolderHit = [bool](As-List (($inFolder.Content | ConvertFrom-Json).files) | Where-Object { $_.id -eq $fileId })
}
if ($atRoot.Status -eq 200) {
  $atRootHit = [bool](As-List (($atRoot.Content | ConvertFrom-Json).files) | Where-Object { $_.id -eq $fileId })
}
Write-Check "file is in Invoices and not at root" ($putOk -and $complete.Status -eq 200 -and $inFolderHit -and -not $atRootHit) "put=$($put.Status) complete=$($complete.Status) inFolder=$inFolderHit atRoot=$atRootHit"

$duplicate = New-Folder -Session $sessionA -Name "Projects" -ParentId ""
$caseDuplicate = New-Folder -Session $sessionA -Name "projects" -ParentId ""
Write-Check "duplicate sibling name is 409" ($duplicate.Status -eq 409 -and $caseDuplicate.Status -eq 409) "exact=$($duplicate.Status) $($duplicate.Content) case=$($caseDuplicate.Status) $($caseDuplicate.Content)"

$renamed = Get-Response -Method PATCH -Uri "$base/api/folders/$yearId" -Session $sessionA -Body '{"name":"Archive"}'
$renamedName = ""
if ($renamed.Status -eq 200) { $renamedName = ($renamed.Content | ConvertFrom-Json).name }
Write-Check "rename 2026 to Archive" ($renamed.Status -eq 200 -and $renamedName -eq "Archive") "status=$($renamed.Status) body=$($renamed.Content)"

$intoDescendant = Get-Response -Method PATCH -Uri "$base/api/folders/$projectsId" -Session $sessionA -Body (@{ parentId = $invoicesId } | ConvertTo-Json -Compress)
Write-Check "cannot move a folder into its descendant" ($intoDescendant.Status -eq 400 -and $intoDescendant.Content -match "Cannot move a folder into itself") "status=$($intoDescendant.Status) body=$($intoDescendant.Content)"

$intoSelf = Get-Response -Method PATCH -Uri "$base/api/folders/$projectsId" -Session $sessionA -Body (@{ parentId = $projectsId } | ConvertTo-Json -Compress)
Write-Check "cannot move a folder into itself" ($intoSelf.Status -eq 400 -and $intoSelf.Content -match "Cannot move a folder into itself") "status=$($intoSelf.Status) body=$($intoSelf.Content)"

$toRoot = Get-Response -Method PATCH -Uri "$base/api/folders/$invoicesId" -Session $sessionA -Body '{"parentId":null}'
$movedListing = Get-Response -Uri "$base/api/folders?parentId=$invoicesId" -Session $sessionA
$movedNames = ""
$movedParent = "missing"
if ($toRoot.Status -eq 200) { $movedParent = [string]($toRoot.Content | ConvertFrom-Json).parentId }
if ($movedListing.Status -eq 200) {
  $movedNames = ((As-List (($movedListing.Content | ConvertFrom-Json).breadcrumbs)) | ForEach-Object { $_.name }) -join ","
}
Write-Check "move Invoices to root updates breadcrumbs" ($toRoot.Status -eq 200 -and $movedParent -eq "" -and $movedNames -eq "Invoices") "status=$($toRoot.Status) parent=$movedParent breadcrumbs=$movedNames body=$($movedListing.Content)"

$depthParent = ""
$depthOk = $true
$depthDetail = ""
for ($level = 1; $level -le 20; $level++) {
  $createdDepth = New-Folder -Session $sessionA -Name "depth-$level" -ParentId $depthParent
  if ($createdDepth.Status -ne 201) {
    $depthOk = $false
    $depthDetail = "level=$level status=$($createdDepth.Status) body=$($createdDepth.Content)"
    break
  }
  $depthParent = ($createdDepth.Content | ConvertFrom-Json).id
}
$tooDeep = New-Folder -Session $sessionA -Name "depth-21" -ParentId $depthParent
Write-Check "folder depth stops at 20" ($depthOk -and $tooDeep.Status -eq 400 -and $tooDeep.Content -match "Folder nesting too deep") "$depthDetail extra=$($tooDeep.Status) $($tooDeep.Content)"

$all = Get-Response -Uri "$base/api/folders/all" -Session $sessionA
$allIds = @()
if ($all.Status -eq 200) {
  $allIds = As-List ($all.Content | ConvertFrom-Json) | ForEach-Object { $_.id }
}
$hasTree = ($allIds -contains $projectsId) -and ($allIds -contains $yearId) -and ($allIds -contains $invoicesId)
Write-Check "flat folder list includes the tree" ($all.Status -eq 200 -and $hasTree) "status=$($all.Status) count=$($allIds.Count)"

$bGet = Get-Response -Uri "$base/api/folders?parentId=$projectsId" -Session $sessionB
$bPatch = Get-Response -Method PATCH -Uri "$base/api/folders/$projectsId" -Session $sessionB -Body '{"name":"Stolen"}'
$bDelete = Get-Response -Method DELETE -Uri "$base/api/folders/$projectsId" -Session $sessionB
$bCreate = New-Folder -Session $sessionB -Name "Nope" -ParentId $projectsId
Write-Check "B cannot read A's folder" ($bGet.Status -eq 404) "status=$($bGet.Status) body=$($bGet.Content)"
Write-Check "B cannot rename A's folder" ($bPatch.Status -eq 404) "status=$($bPatch.Status) body=$($bPatch.Content)"
Write-Check "B cannot delete A's folder" ($bDelete.Status -eq 404) "status=$($bDelete.Status) body=$($bDelete.Content)"
Write-Check "B cannot create inside A's folder" ($bCreate.Status -eq 404) "status=$($bCreate.Status) body=$($bCreate.Content)"

$back = Get-Response -Method PATCH -Uri "$base/api/folders/$invoicesId" -Session $sessionA -Body (@{ parentId = $yearId } | ConvertTo-Json -Compress)
$deleted = Get-Response -Method DELETE -Uri "$base/api/folders/$projectsId" -Session $sessionA
$afterAll = Get-Response -Uri "$base/api/folders/all" -Session $sessionA
$remaining = @()
if ($afterAll.Status -eq 200) {
  $remaining = As-List ($afterAll.Content | ConvertFrom-Json) | ForEach-Object { $_.id }
}
$treeGone = -not ($remaining -contains $projectsId -or $remaining -contains $yearId -or $remaining -contains $invoicesId)
$fileList = Get-Response -Uri "$base/api/files" -Session $sessionA
$fileStillListed = $false
if ($fileList.Status -eq 200 -and $fileList.Content -ne "") {
  $fileStillListed = [bool](As-List ($fileList.Content | ConvertFrom-Json) | Where-Object { $_.id -eq $fileId })
}
$download = Get-Response -Uri "$base/api/files/$fileId/download-url" -Session $sessionA
$usage = Get-Response -Uri "$base/api/usage" -Session $sessionA
$used = -1
if ($usage.Status -eq 200) { $used = [int]($usage.Content | ConvertFrom-Json).used }
Write-Check "deleting the parent removes the folder and file" ($back.Status -eq 200 -and $deleted.Status -eq 204 -and $treeGone -and -not $fileStillListed -and $download.Status -eq 404 -and $used -eq 0) "moveBack=$($back.Status) $($back.Content) delete=$($deleted.Status) treeGone=$treeGone listed=$fileStillListed download=$($download.Status) used=$used"

$anon = Get-Response -Uri "$base/api/folders"
Write-Check "unauthenticated list is 401" ($anon.Status -eq 401) "status=$($anon.Status) body=$($anon.Content)"

exit 0
