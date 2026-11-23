$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectName = Split-Path $projectRoot -Leaf
$destination = Join-Path (Split-Path $projectRoot -Parent) ($projectName + '.zip')
$files = @('README.md','server.cjs','package-lock.json','package.json','.gitignore')
$files += Get-ChildItem -LiteralPath (Join-Path $projectRoot 'backend'),(Join-Path $projectRoot 'config'),(Join-Path $projectRoot 'dist'),(Join-Path $projectRoot 'docs'),(Join-Path $projectRoot 'scripts') -Recurse -File | ForEach-Object { $_.FullName.Substring($projectRoot.Length+1) }
$stream = [System.IO.File]::Open($destination,[System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($stream,[System.IO.Compression.ZipArchiveMode]::Create)
try { foreach ($relative in $files) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $projectRoot $relative),$projectName+'/'+$relative.Replace('\','/')) | Out-Null } } finally { $zip.Dispose();$stream.Dispose() }
$verify=[System.IO.Compression.ZipFile]::OpenRead($destination)
try { if($verify.Entries.FullName | Where-Object {$_ -match '(^|/)(data|\.git|standalone|node_modules|\.test-results)(/|$)|(^|/)\.env$|\.sqlite($|-)|mock-data\.js$'}) { throw 'Unexpected private or legacy file in package' };foreach($entry in $verify.Entries){if(-not $entry.FullName.StartsWith($projectName+'/')){throw 'Archive must contain exactly one root folder'}};Write-Output "Verified package: $($verify.Entries.Count) files in $projectName/" } finally { $verify.Dispose() }
Write-Output $destination
