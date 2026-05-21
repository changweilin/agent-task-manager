[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('ui', 'discover', 'start', 'stop', 'restart', 'status', 'urls', 'logs', 'firewall', 'firewall-lan')]
    [string]$Command = 'status',

    [string[]]$Roots = @(),
    [string[]]$Project = @(),
    [string]$Config = '',
    [int]$BasePort = 5173,
    [int]$UiPort = 8787,
    [int]$PortCount = 100,
    [int]$LogLines = 120
)

$ErrorActionPreference = 'Stop'

$ScriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ScriptRoot = (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($Config)) {
    $Config = Join-Path $ScriptRoot 'dev-projects.json'
}

$ManagerDir = Join-Path $ScriptRoot '.dev-manager'
$LogDir = Join-Path $ManagerDir 'logs'
$StatePath = Join-Path $ManagerDir 'state.json'
$IgnoredDirs = @('node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.turbo', 'dist', 'build', 'coverage', 'out', '.output')

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Get-ObjectValue {
    param(
        [object]$Object,
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $content = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    return $content | ConvertFrom-Json
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value
    )

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        Ensure-Directory $parent
    }

    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Test-IgnoredPath {
    param([string]$Path)

    $segments = $Path -split '[\\/]+'
    foreach ($segment in $segments) {
        if ($IgnoredDirs -contains $segment) {
            return $true
        }
    }

    return $false
}

function Resolve-RootPaths {
    param(
        [string[]]$RootList,
        [object]$ConfigObject
    )

    if ($RootList -and $RootList.Count -gt 0) {
        return @($RootList | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
    }

    $defaultRoots = Get-ObjectValue $ConfigObject 'defaultRoots'
    if ($defaultRoots) {
        return @($defaultRoots | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
    }

    return @((Get-Location).Path)
}

function Has-PackageDependency {
    param(
        [object]$PackageJson,
        [string]$Name
    )

    foreach ($sectionName in @('dependencies', 'devDependencies', 'peerDependencies')) {
        $section = Get-ObjectValue $PackageJson $sectionName
        if ($null -ne (Get-ObjectValue $section $Name)) {
            return $true
        }
    }

    return $false
}

function Get-ProjectFramework {
    param(
        [object]$PackageJson,
        [string]$DevScript
    )

    if ((Has-PackageDependency $PackageJson 'next') -or $DevScript -match '(^|\s)next\s+dev(\s|$)') {
        return 'next'
    }
    if ((Has-PackageDependency $PackageJson 'astro') -or $DevScript -match '(^|\s)astro\s+dev(\s|$)') {
        return 'astro'
    }
    if ((Has-PackageDependency $PackageJson 'nuxt') -or (Has-PackageDependency $PackageJson 'nuxi') -or $DevScript -match '(^|\s)(nuxt|nuxi)\s+dev(\s|$)') {
        return 'nuxt'
    }
    if ((Has-PackageDependency $PackageJson 'vite') -or $DevScript -match '(^|\s)vite(\s|$)') {
        return 'vite'
    }

    return 'generic'
}

function ConvertTo-SafeName {
    param([string]$Name)

    $safe = $Name -replace '^@', ''
    $safe = $safe -replace '[\\/]', '-'
    $safe = $safe -replace '[^\w.-]', '-'
    $safe = $safe.Trim('-')

    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'project'
    }

    return $safe
}

function Find-DevProjects {
    param([string[]]$RootPaths)

    $found = @()
    foreach ($root in $RootPaths) {
        if (-not (Test-Path -LiteralPath $root)) {
            Write-Warning "Root not found: $root"
            continue
        }

        $packageFiles = Get-ChildItem -LiteralPath $root -Filter package.json -File -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object { -not (Test-IgnoredPath $_.FullName) }

        foreach ($packageFile in $packageFiles) {
            try {
                $packageJson = Get-Content -LiteralPath $packageFile.FullName -Raw | ConvertFrom-Json
            }
            catch {
                Write-Warning "Skipped invalid package.json: $($packageFile.FullName)"
                continue
            }

            $scripts = Get-ObjectValue $packageJson 'scripts'
            $devScript = [string](Get-ObjectValue $scripts 'dev')
            if ([string]::IsNullOrWhiteSpace($devScript)) {
                continue
            }

            $projectPath = Split-Path -Parent $packageFile.FullName
            $packageName = [string](Get-ObjectValue $packageJson 'name')
            if ([string]::IsNullOrWhiteSpace($packageName)) {
                $packageName = Split-Path -Leaf $projectPath
            }

            $found += [pscustomobject]@{
                name      = ConvertTo-SafeName $packageName
                path      = $projectPath
                framework = Get-ProjectFramework $packageJson $devScript
                devScript = $devScript
                port      = $null
            }
        }
    }

    return @($found | Sort-Object path)
}

function Set-UniqueNamesAndPorts {
    param(
        [object[]]$Projects,
        [int]$StartPort
    )

    $Projects = @($Projects | Where-Object { $null -ne $_ })
    $seenNames = @{}
    $usedPorts = @{}
    $nextPort = $StartPort
    $normalized = @()

    foreach ($project in @($Projects | Sort-Object path)) {
        $baseName = [string](Get-ObjectValue $project 'name')
        if ([string]::IsNullOrWhiteSpace($baseName)) {
            $baseName = Split-Path -Leaf ([string](Get-ObjectValue $project 'path'))
        }
        $baseName = ConvertTo-SafeName $baseName

        if ($seenNames.ContainsKey($baseName)) {
            $seenNames[$baseName] += 1
            $name = "$baseName-$($seenNames[$baseName])"
        }
        else {
            $seenNames[$baseName] = 1
            $name = $baseName
        }

        $configuredPort = Get-ObjectValue $project 'port'
        if ($configuredPort) {
            $port = [int]$configuredPort
        }
        else {
            while ($usedPorts.ContainsKey($nextPort)) {
                $nextPort += 1
            }
            $port = $nextPort
            $nextPort += 1
        }
        $usedPorts[$port] = $true

        $projectPath = [string](Get-ObjectValue $project 'path')
        $resolvedPath = (Resolve-Path -LiteralPath $projectPath).Path
        $framework = [string](Get-ObjectValue $project 'framework')
        if ([string]::IsNullOrWhiteSpace($framework)) {
            $framework = 'generic'
        }

        $normalized += [pscustomobject]@{
            name      = $name
            path      = $resolvedPath
            framework = $framework
            devScript = [string](Get-ObjectValue $project 'devScript')
            port      = $port
        }
    }

    return @($normalized)
}

function Read-ConfigProjects {
    param(
        [string]$ConfigPath,
        [string[]]$RootList,
        [int]$StartPort
    )

    $configObject = Read-JsonFile $ConfigPath
    if ($configObject -and (-not $RootList -or $RootList.Count -eq 0)) {
        $projects = @((Get-ObjectValue $configObject 'projects') | Where-Object { $null -ne $_ })
        return Set-UniqueNamesAndPorts $projects $StartPort
    }

    $roots = Resolve-RootPaths $RootList $configObject
    $projects = Find-DevProjects $roots
    return Set-UniqueNamesAndPorts $projects $StartPort
}

function Read-State {
    $state = Read-JsonFile $StatePath
    if (-not $state) {
        return [pscustomobject]@{
            updatedAt = (Get-Date).ToString('o')
            projects  = @()
        }
    }

    return [pscustomobject]@{
        updatedAt = [string](Get-ObjectValue $state 'updatedAt')
        projects  = @((Get-ObjectValue $state 'projects') | Where-Object { $null -ne $_ })
    }
}

function Write-State {
    param([object]$State)

    $State.updatedAt = (Get-Date).ToString('o')
    Write-JsonFile $StatePath $State
}

function Test-ProcessIsRunning {
    param([int]$TargetProcessId)

    if ($TargetProcessId -le 0) {
        return $false
    }

    try {
        $null = Get-Process -Id $TargetProcessId -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Get-StateEntryByPath {
    param(
        [object]$State,
        [string]$Path
    )

    return @($State.projects) | Where-Object { [string]$_.path -eq $Path } | Select-Object -First 1
}

function Set-StateEntry {
    param(
        [object]$State,
        [object]$Entry
    )

    $State.projects = @(@($State.projects) | Where-Object { [string]$_.path -ne [string]$Entry.path })
    $State.projects += $Entry
}

function Remove-StateEntry {
    param(
        [object]$State,
        [string]$Path
    )

    $State.projects = @(@($State.projects) | Where-Object { [string]$_.path -ne $Path })
}

function Test-TailscaleIpv4 {
    param([string]$IpAddress)

    $parts = $IpAddress -split '\.'
    if ($parts.Count -ne 4) {
        return $false
    }

    try {
        $first = [int]$parts[0]
        $second = [int]$parts[1]
    }
    catch {
        return $false
    }

    return ($first -eq 100 -and $second -ge 64 -and $second -le 127)
}

function Get-TailscaleIp {
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) {
        $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    }
    if (-not $tailscale) {
        return $null
    }

    try {
        $ips = & $tailscale.Source ip -4 2>$null
        return @($ips | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)
    }
    catch {
        return $null
    }
}

function Start-TailscaleIfNeeded {
    $currentIp = Get-TailscaleIp
    if ($currentIp) {
        return $currentIp
    }

    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) {
        $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
    }
    if (-not $tailscale) {
        Write-Warning "Tailscale CLI not found. Install or start Tailscale, then refresh the UI."
        return $null
    }

    try {
        & $tailscale.Source up *> $null
    }
    catch {
        Write-Warning "Could not start Tailscale automatically: $($_.Exception.Message)"
    }

    return Get-TailscaleIp
}

function Get-LocalIp {
    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' -and -not (Test-TailscaleIpv4 $_.IPAddress) } |
            Sort-Object InterfaceMetric
        return @($addresses | Select-Object -ExpandProperty IPAddress -First 1)
    }
    catch {
        return $null
    }
}

function Get-ProjectUrl {
    param(
        [object]$Project,
        [string]$HostName
    )

    if ([string]::IsNullOrWhiteSpace($HostName)) {
        return ''
    }

    return "http://$HostName`:$([int](Get-ObjectValue $Project 'port'))"
}

function Get-NpmCommand {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction Stop
    }

    return $npm.Source
}

function Get-NpmDevArguments {
    param(
        [string]$Framework,
        [int]$Port
    )

    $arguments = @('run', 'dev')
    $extra = @()

    switch ($Framework) {
        'next' {
            $extra = @('-H', '0.0.0.0', '-p', [string]$Port)
        }
        { $_ -in @('vite', 'astro', 'nuxt') } {
            $extra = @('--host', '0.0.0.0', '--port', [string]$Port)
        }
        default {
            $extra = @()
        }
    }

    if ($extra.Count -gt 0) {
        $arguments += '--'
        $arguments += $extra
    }

    return $arguments
}

function Join-CommandForDisplay {
    param(
        [string]$Executable,
        [string[]]$Arguments
    )

    return "$Executable $($Arguments -join ' ')"
}

function Set-DevEnvironment {
    param([int]$Port)

    $names = @('HOST', 'HOSTNAME', 'PORT', 'BROWSER', 'NEXT_TELEMETRY_DISABLED', 'VITE_HOST', 'npm_config_host')
    $oldValues = @{}
    foreach ($name in $names) {
        $oldValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }

    [Environment]::SetEnvironmentVariable('HOST', '0.0.0.0', 'Process')
    [Environment]::SetEnvironmentVariable('HOSTNAME', '0.0.0.0', 'Process')
    [Environment]::SetEnvironmentVariable('PORT', [string]$Port, 'Process')
    [Environment]::SetEnvironmentVariable('BROWSER', 'none', 'Process')
    [Environment]::SetEnvironmentVariable('NEXT_TELEMETRY_DISABLED', '1', 'Process')
    [Environment]::SetEnvironmentVariable('VITE_HOST', '0.0.0.0', 'Process')
    [Environment]::SetEnvironmentVariable('npm_config_host', '0.0.0.0', 'Process')

    return $oldValues
}

function Restore-Environment {
    param([hashtable]$OldValues)

    foreach ($name in $OldValues.Keys) {
        [Environment]::SetEnvironmentVariable($name, $OldValues[$name], 'Process')
    }
}

function Get-SafeLogPrefix {
    param([object]$Project)

    $name = [string](Get-ObjectValue $Project 'name')
    $hashInput = [string](Get-ObjectValue $Project 'path')
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($hashInput)
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').Substring(0, 8).ToLowerInvariant()
    return "$(ConvertTo-SafeName $name)-$hash"
}

function Start-DevProject {
    param([object]$Project)

    Ensure-Directory $LogDir

    $npm = Get-NpmCommand
    $port = [int](Get-ObjectValue $Project 'port')
    $framework = [string](Get-ObjectValue $Project 'framework')
    $arguments = Get-NpmDevArguments $framework $port
    $logPrefix = Get-SafeLogPrefix $Project
    $stdoutLog = Join-Path $LogDir "$logPrefix.out.log"
    $stderrLog = Join-Path $LogDir "$logPrefix.err.log"
    $oldEnvironment = Set-DevEnvironment $port

    try {
        $process = Start-Process `
            -FilePath $npm `
            -ArgumentList $arguments `
            -WorkingDirectory ([string](Get-ObjectValue $Project 'path')) `
            -WindowStyle Hidden `
            -PassThru `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog
    }
    finally {
        Restore-Environment $oldEnvironment
    }

    return [pscustomobject]@{
        name      = [string](Get-ObjectValue $Project 'name')
        path      = [string](Get-ObjectValue $Project 'path')
        framework = $framework
        port      = $port
        pid       = $process.Id
        startedAt = (Get-Date).ToString('o')
        command   = Join-CommandForDisplay 'npm' $arguments
        stdout    = $stdoutLog
        stderr    = $stderrLog
        healthFailures = 0
        lastHealthAt = $null
        lastHealthOk = $null
        lastHealthError = ''
        lastRestartAt = $null
        restartCount = 0
    }
}

function Get-ChildProcessIds {
    param([int]$TargetProcessId)

    try {
        return @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $TargetProcessId" -ErrorAction Stop | Select-Object -ExpandProperty ProcessId)
    }
    catch {
        return @()
    }
}

function Stop-ProcessTree {
    param([int]$TargetProcessId)

    foreach ($childId in Get-ChildProcessIds $TargetProcessId) {
        Stop-ProcessTree ([int]$childId)
    }

    if (Test-ProcessIsRunning $TargetProcessId) {
        Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Test-ProjectSelected {
    param(
        [object]$ProjectObject,
        [string[]]$Selections
    )

    if (-not $Selections -or $Selections.Count -eq 0) {
        return $true
    }

    $name = [string](Get-ObjectValue $ProjectObject 'name')
    $path = [string](Get-ObjectValue $ProjectObject 'path')

    return ($Selections -contains $name) -or ($Selections -contains $path)
}

function Invoke-Discover {
    $configObject = Read-JsonFile $Config
    $roots = Resolve-RootPaths $Roots $configObject
    $projects = Set-UniqueNamesAndPorts (Find-DevProjects $roots) $BasePort
    $autoRestoreOnStartup = $true
    $configuredAutoRestore = Get-ObjectValue $configObject 'autoRestoreOnStartup'
    if ($null -ne $configuredAutoRestore) {
        $autoRestoreOnStartup = [bool]$configuredAutoRestore
    }

    $configValue = [pscustomobject]@{
        defaultRoots          = @($roots)
        basePort              = $BasePort
        autoRestoreOnStartup  = $autoRestoreOnStartup
        health                = Get-ObjectValue $configObject 'health'
        profiles              = @((Get-ObjectValue $configObject 'profiles') | Where-Object { $null -ne $_ })
        projects              = @($projects)
    }

    Write-JsonFile $Config $configValue

    if ($projects.Count -eq 0) {
        Write-Host "No projects with scripts.dev were found."
        Write-Host "Config saved: $Config"
        return
    }

    Write-Host "Discovered $($projects.Count) project(s). Config saved: $Config"
    $projects | Select-Object name, framework, port, path | Format-Table -AutoSize
}

function Invoke-Start {
    $projects = Read-ConfigProjects $Config $Roots $BasePort
    if ($projects.Count -eq 0) {
        Write-Host "No configured projects. Run: .\dev-manager.ps1 discover -Roots C:\path\to\projects"
        return
    }

    $state = Read-State
    foreach ($project in $projects) {
        if (-not (Test-ProjectSelected $project $Project)) {
            continue
        }

        $existing = Get-StateEntryByPath $state ([string](Get-ObjectValue $project 'path'))
        if ($existing -and (Test-ProcessIsRunning ([int](Get-ObjectValue $existing 'pid'))) ) {
            Write-Host "Already running: $($project.name) PID $($existing.pid)"
            continue
        }

        if ($existing) {
            Remove-StateEntry $state ([string](Get-ObjectValue $project 'path'))
        }

        $entry = Start-DevProject $project
        Set-StateEntry $state $entry
        Write-Host "Started: $($entry.name) PID $($entry.pid) http://127.0.0.1:$($entry.port)"
    }

    Write-State $state
    Invoke-Status
}

function Invoke-Stop {
    $state = Read-State
    $entries = @($state.projects)
    if ($entries.Count -eq 0) {
        Write-Host "No running projects recorded."
        return
    }

    foreach ($entry in $entries) {
        if (-not (Test-ProjectSelected $entry $Project)) {
            continue
        }

        $pidValue = [int](Get-ObjectValue $entry 'pid')
        if (Test-ProcessIsRunning $pidValue) {
            Stop-ProcessTree $pidValue
            Write-Host "Stopped: $($entry.name) PID $pidValue"
        }
        else {
            Write-Host "Not running: $($entry.name) PID $pidValue"
        }

        Remove-StateEntry $state ([string](Get-ObjectValue $entry 'path'))
    }

    Write-State $state
}

function Invoke-Status {
    $projects = Read-ConfigProjects $Config $Roots $BasePort
    $state = Read-State
    $tailscaleIp = Get-TailscaleIp
    $localIp = Get-LocalIp
    $rows = @()

    foreach ($project in $projects) {
        $entry = Get-StateEntryByPath $state ([string](Get-ObjectValue $project 'path'))
        $pidValue = 0
        $status = 'stopped'
        $commandText = ''
        if ($entry) {
            $pidValue = [int](Get-ObjectValue $entry 'pid')
            if (Test-ProcessIsRunning $pidValue) {
                $status = 'running'
            }
            else {
                $status = 'stale'
            }
            $commandText = [string](Get-ObjectValue $entry 'command')
        }

        $rows += [pscustomobject]@{
            name      = [string](Get-ObjectValue $project 'name')
            status    = $status
            pid       = if ($pidValue -gt 0) { $pidValue } else { '' }
            framework = [string](Get-ObjectValue $project 'framework')
            port      = [int](Get-ObjectValue $project 'port')
            local     = Get-ProjectUrl $project '127.0.0.1'
            lan       = Get-ProjectUrl $project $localIp
            tailscale = Get-ProjectUrl $project $tailscaleIp
            command   = $commandText
        }
    }

    if ($rows.Count -eq 0) {
        Write-Host "No configured projects. Run: .\dev-manager.ps1 discover -Roots C:\path\to\projects"
        return
    }

    $rows | Format-Table name, status, pid, framework, port, local, tailscale -AutoSize

    if ($tailscaleIp) {
        Write-Host "Phone URL format: http://$tailscaleIp`:PORT"
    }
    else {
        Write-Warning "Tailscale IP not found. Make sure Tailscale is installed, logged in, and connected."
    }
}

function Invoke-Urls {
    $projects = Read-ConfigProjects $Config $Roots $BasePort
    $tailscaleIp = Get-TailscaleIp
    if (-not $tailscaleIp) {
        Write-Warning "Tailscale IP not found. Make sure Tailscale is running."
        return
    }

    foreach ($project in $projects) {
        if (Test-ProjectSelected $project $Project) {
            Write-Host "$($project.name)  http://$tailscaleIp`:$($project.port)"
        }
    }
}

function Invoke-Logs {
    $state = Read-State
    $entries = @($state.projects) | Where-Object { Test-ProjectSelected $_ $Project }

    if ($entries.Count -eq 0) {
        Write-Host "No matching running projects recorded."
        return
    }

    foreach ($entry in $entries) {
        Write-Host ""
        Write-Host "== $($entry.name) stdout =="
        $stdout = [string](Get-ObjectValue $entry 'stdout')
        if (Test-Path -LiteralPath $stdout) {
            Get-Content -LiteralPath $stdout -Tail $LogLines
        }
        else {
            Write-Host "(stdout log not found)"
        }

        Write-Host ""
        Write-Host "== $($entry.name) stderr =="
        $stderr = [string](Get-ObjectValue $entry 'stderr')
        if (Test-Path -LiteralPath $stderr) {
            Get-Content -LiteralPath $stderr -Tail $LogLines
        }
        else {
            Write-Host "(stderr log not found)"
        }
    }
}

function Invoke-Firewall {
    $endPort = $BasePort + $PortCount - 1
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "Firewall changes need an elevated PowerShell window. Re-run this command as Administrator:"
        Write-Host ".\dev-manager.ps1 firewall -BasePort $BasePort -PortCount $PortCount"
        return
    }

    if (-not (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) {
        Write-Warning "New-NetFirewallRule is not available on this system."
        return
    }

    $displayName = "npm dev via Tailscale ($BasePort-$endPort)"
    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Firewall rule already exists: $displayName"
        return
    }

    New-NetFirewallRule `
        -DisplayName $displayName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort "$BasePort-$endPort" `
        -RemoteAddress '100.64.0.0/10' `
        -Profile Any | Out-Null

    Write-Host "Added firewall rule: $displayName"
    Write-Host "Allowed remote address range: 100.64.0.0/10 (Tailscale IPv4)"
}

function Invoke-FirewallLan {
    $endPort = $BasePort + $PortCount - 1
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warning "LAN firewall changes need an elevated PowerShell window. Re-run this command as Administrator:"
        Write-Host ".\dev-manager.ps1 firewall-lan -BasePort $BasePort -PortCount $PortCount"
        return
    }

    if (-not (Get-Command New-NetFirewallRule -ErrorAction SilentlyContinue)) {
        Write-Warning "New-NetFirewallRule is not available on this system."
        return
    }

    $displayName = "npm dev via LAN ($BasePort-$endPort)"
    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Firewall rule already exists: $displayName"
        return
    }

    New-NetFirewallRule `
        -DisplayName $displayName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort "$BasePort-$endPort" `
        -RemoteAddress LocalSubnet `
        -Profile Private | Out-Null

    Write-Host "Added firewall rule: $displayName"
    Write-Host "Allowed remote address: LocalSubnet on Private network profile"
}

function Invoke-Ui {
    $npm = Get-NpmCommand
    Write-Host "Starting Dev Dock UI with npm run dev..."
    Write-Host "Local URL: http://127.0.0.1:$UiPort"

    $lanIp = Get-LocalIp
    if ($lanIp) {
        Write-Host "LAN URL: http://$lanIp`:$UiPort"
    }
    else {
        Write-Warning "LAN IP not found yet. Connect to Wi-Fi or Ethernet, then refresh the UI."
    }

    $tailscaleIp = Start-TailscaleIfNeeded
    if ($tailscaleIp) {
        Write-Host "Tailscale URL: http://$tailscaleIp`:$UiPort"
    }
    else {
        Write-Warning "Tailscale IP not found yet. Dev Dock tried to start Tailscale; connect or sign in, then refresh the UI."
    }

    Push-Location $ScriptRoot
    try {
        & $npm 'run' 'dev' '--' '--host' '0.0.0.0' '--port' ([string]$UiPort)
    }
    finally {
        Pop-Location
    }
}

Ensure-Directory $ManagerDir
Ensure-Directory $LogDir

switch ($Command) {
    'ui' { Invoke-Ui }
    'discover' { Invoke-Discover }
    'start' { Invoke-Start }
    'stop' { Invoke-Stop }
    'restart' {
        Invoke-Stop
        Invoke-Start
    }
    'status' { Invoke-Status }
    'urls' { Invoke-Urls }
    'logs' { Invoke-Logs }
    'firewall' { Invoke-Firewall }
    'firewall-lan' { Invoke-FirewallLan }
}
