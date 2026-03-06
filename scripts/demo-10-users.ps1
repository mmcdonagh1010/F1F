$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root 'backend'
$base = 'http://localhost:4000/api'
$bootstrapKey = 'local-bootstrap-key'
$adminEmail = 'demo.admin10@example.com'
$adminPass = 'Password123!'
$userPass = 'Password123!'
$year = [DateTime]::UtcNow.Year

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    ContentType = 'application/json'
  }

  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }

  return Invoke-RestMethod @params
}

function Register-Or-Login {
  param([string]$Name, [string]$Email, [string]$Password)

  try {
    return Invoke-Api -Method 'Post' -Uri "$base/auth/register" -Body @{
      name = $Name
      email = $Email
      password = $Password
    }
  }
  catch {
    return Invoke-Api -Method 'Post' -Uri "$base/auth/login" -Body @{
      email = $Email
      password = $Password
    }
  }
}

function Ensure-BackendHealthy {
  $health = Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/health'
  if (-not $health.ok) {
    throw 'Backend is not healthy.'
  }
}

function Reset-Database {
  $resetScriptPath = Join-Path $backendDir '.tmp-reset-db.mjs'
  $resetScript = @"
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('TRUNCATE TABLE notifications, scores, results, picks, race_drivers, pick_categories, race_leagues, races, league_members, leagues, users, app_settings RESTART IDENTITY CASCADE;');
const counts = await client.query("SELECT (SELECT COUNT(*)::int FROM users) AS users_count, (SELECT COUNT(*)::int FROM leagues) AS leagues_count, (SELECT COUNT(*)::int FROM races) AS races_count;");
await client.end();
console.log('Database cleared', counts.rows[0]);
"@

  Push-Location $backendDir
  try {
    Set-Content -Path $resetScriptPath -Value $resetScript -Encoding utf8
    & 'C:\Program Files\nodejs\node.exe' $resetScriptPath
    if ($LASTEXITCODE -ne 0) {
      throw 'Database reset command failed.'
    }

    & 'C:\Program Files\nodejs\node.exe' .\src\sql\run-schema.js
    if ($LASTEXITCODE -ne 0) {
      throw 'Schema apply command failed.'
    }
  }
  finally {
    if (Test-Path $resetScriptPath) {
      Remove-Item $resetScriptPath -Force
    }
    Pop-Location
  }
}

function Build-Drivers {
  return @(
    @{ name = 'Max Verstappen'; teamName = 'Red Bull' },
    @{ name = 'Sergio Perez'; teamName = 'Red Bull' },
    @{ name = 'Lando Norris'; teamName = 'McLaren' },
    @{ name = 'Oscar Piastri'; teamName = 'McLaren' },
    @{ name = 'Charles Leclerc'; teamName = 'Ferrari' },
    @{ name = 'Carlos Sainz'; teamName = 'Ferrari' },
    @{ name = 'George Russell'; teamName = 'Mercedes' },
    @{ name = 'Lewis Hamilton'; teamName = 'Mercedes' },
    @{ name = 'Fernando Alonso'; teamName = 'Aston Martin' },
    @{ name = 'Lance Stroll'; teamName = 'Aston Martin' }
  )
}

function New-PicksForUserRace {
  param(
    [array]$Categories,
    [array]$Drivers,
    [int]$UserIndex,
    [int]$RaceIndex
  )

  $driverNames = $Drivers | ForEach-Object { $_.name }
  $picks = @()

  for ($i = 0; $i -lt $Categories.Count; $i += 1) {
    $cat = $Categories[$i]
    $driverPick = $driverNames[($UserIndex + $RaceIndex + $i) % $driverNames.Count]
    $picks += @{
      categoryId = $cat.id
      valueText = $driverPick
    }
  }

  return $picks
}

function New-ResultsForRace {
  param(
    [array]$Categories,
    [array]$Drivers,
    [int]$RaceIndex
  )

  $driverNames = $Drivers | ForEach-Object { $_.name }
  $results = @()

  for ($i = 0; $i -lt $Categories.Count; $i += 1) {
    $results += @{
      categoryId = $Categories[$i].id
      valueText = $driverNames[($RaceIndex + $i) % $driverNames.Count]
    }
  }

  return $results
}

Ensure-BackendHealthy
Reset-Database
Ensure-BackendHealthy

$adminAuth = Register-Or-Login -Name 'Demo Admin 10' -Email $adminEmail -Password $adminPass
$null = Invoke-Api -Method 'Post' -Uri "$base/admin/bootstrap/promote-admin" -Body @{
  email = $adminEmail
  bootstrapKey = $bootstrapKey
}
$adminLogin = Invoke-Api -Method 'Post' -Uri "$base/auth/login" -Body @{
  email = $adminEmail
  password = $adminPass
}
$adminHeaders = @{ Authorization = "Bearer $($adminLogin.token)" }

$league = Invoke-Api -Method 'Post' -Uri "$base/admin/leagues" -Headers $adminHeaders -Body @{
  name = "Demo League 10 Users $(Get-Date -Format 'yyyyMMdd-HHmmss')"
  inviteCode = "DEMO10$(Get-Random -Maximum 9999)"
}

$drivers = Build-Drivers
$races = @()

for ($r = 1; $r -le 5; $r += 1) {
  $deadline = [DateTime]::UtcNow.AddDays(10 + $r)
  $raceDate = $deadline.AddHours(12)

  $race = Invoke-Api -Method 'Post' -Uri "$base/admin/races" -Headers $adminHeaders -Body @{
    leagueId = $league.id
    applyToAllLeagues = $false
    name = "Demo Race $r"
    circuitName = "Demo Circuit $r"
    externalRound = $r
    raceDate = $raceDate.ToString('o')
    deadlineAt = $deadline.ToString('o')
    hasSprintWeekend = $false
    predictionOptions = @('raceQualification', 'raceResult', 'racePositions', 'fastestLapDriver')
    positionSlots = @(1, 2, 3)
    drivers = $drivers
  }

  $races += $race
}

$users = @()
for ($u = 1; $u -le 10; $u += 1) {
  $email = ('demo.user{0}@example.com' -f $u)
  $auth = Register-Or-Login -Name ("Demo User $u") -Email $email -Password $userPass
  $headers = @{ Authorization = "Bearer $($auth.token)" }

  $null = Invoke-Api -Method 'Post' -Uri "$base/leagues/join" -Headers $headers -Body @{
    inviteCode = $league.invite_code
  }

  $users += @{
    index = $u
    email = $email
    id = $auth.user.id
    headers = $headers
  }
}

$raceSummaries = @()

for ($ri = 0; $ri -lt $races.Count; $ri += 1) {
  $race = $races[$ri]
  $detail = Invoke-Api -Method 'Get' -Uri "$base/races/$($race.id)" -Headers $adminHeaders
  $categories = @($detail.categories)
  if ($categories.Count -eq 0) {
    throw "Race $($race.name) has no categories"
  }

  foreach ($user in $users) {
    $picks = New-PicksForUserRace -Categories $categories -Drivers $drivers -UserIndex $user.index -RaceIndex $ri
    $null = Invoke-Api -Method 'Post' -Uri "$base/picks/$($race.id)" -Headers $user.headers -Body @{
      leagueId = $league.id
      picks = $picks
    }
  }

  $results = New-ResultsForRace -Categories $categories -Drivers $drivers -RaceIndex $ri
  $null = Invoke-Api -Method 'Post' -Uri "$base/admin/races/$($race.id)/results" -Headers $adminHeaders -Body @{
    tieBreakerValue = ("1:3{0}:44.000" -f $ri)
    results = $results
  }

  $board = Invoke-Api -Method 'Get' -Uri "$base/leaderboard/season?year=$year&leagueId=$($league.id)" -Headers $adminHeaders
  if (@($board.rows).Count -lt 11) {
    throw "Expected at least 11 leaderboard rows after race $($race.name), got $(@($board.rows).Count)"
  }

  $top = $board.rows | Select-Object -First 1
  $raceSummaries += [PSCustomObject]@{
    race = $race.name
    leaderboardRows = @($board.rows).Count
    topPlayer = $top.name
    topPoints = $top.totalPoints
  }
}

$finalBoard = Invoke-Api -Method 'Get' -Uri "$base/leaderboard/season?year=$year&leagueId=$($league.id)" -Headers $adminHeaders
$top5 = @($finalBoard.rows | Select-Object -First 5)

Write-Host ''
Write-Host 'Demo simulation completed successfully.' -ForegroundColor Green
[PSCustomObject]@{
  leagueName = $league.name
  leagueId = $league.id
  inviteCode = $league.invite_code
  adminEmail = $adminEmail
  userCount = $users.Count
  raceCount = $races.Count
  leaderboardRows = @($finalBoard.rows).Count
} | Format-List

Write-Host ''
Write-Host 'Race-by-race leaderboard checkpoints:' -ForegroundColor Cyan
$raceSummaries | Format-Table -AutoSize

Write-Host ''
Write-Host 'Final leaderboard top 5:' -ForegroundColor Cyan
$top5 | Select-Object name, totalPoints | Format-Table -AutoSize
