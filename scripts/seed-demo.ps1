$ErrorActionPreference = 'Stop'

$base = 'http://localhost:4000/api'
$bootstrapKey = 'local-bootstrap-key'

function Register-Or-Login {
  param([string]$Name, [string]$Email, [string]$Password)

  $registerBody = @{ name = $Name; email = $Email; password = $Password } | ConvertTo-Json
  try {
    return Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' -Body $registerBody
  }
  catch {
    $loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
    return Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginBody
  }
}

$health = Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/health'
if (-not $health.ok) {
  throw 'Backend is not healthy.'
}

$adminEmail = 'demo.admin@example.com'
$adminPass = 'Password123!'

$null = Register-Or-Login -Name 'Demo Admin' -Email $adminEmail -Password $adminPass
$null = Invoke-RestMethod -Method Post -Uri "$base/admin/bootstrap/promote-admin" -ContentType 'application/json' -Body (@{
  email = $adminEmail
  bootstrapKey = $bootstrapKey
} | ConvertTo-Json)

$adminLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{
  email = $adminEmail
  password = $adminPass
} | ConvertTo-Json)

$adminHeaders = @{ Authorization = "Bearer $($adminLogin.token)" }

$league = Invoke-RestMethod -Method Post -Uri "$base/admin/leagues" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  name = "Demo League $(Get-Date -Format 'yyyyMMdd-HHmmss')"
  inviteCode = "DEMO$(Get-Random)"
} | ConvertTo-Json)

$race = Invoke-RestMethod -Method Post -Uri "$base/admin/races" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  leagueId = $league.id
  name = 'Australian GP (Demo)'
  circuitName = 'Albert Park Circuit'
  raceDate = (Get-Date).AddDays(3).ToString('o')
  deadlineAt = (Get-Date).AddDays(2).ToString('o')
} | ConvertTo-Json)

$null = Invoke-RestMethod -Method Post -Uri "$base/admin/races/$($race.id)/categories" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  categories = @(
    @{ name = 'Pole Position'; displayOrder = 1; isPositionBased = $false; exactPoints = 10; partialPoints = 0 },
    @{ name = 'Race Winner'; displayOrder = 2; isPositionBased = $true; exactPoints = 10; partialPoints = 5 },
    @{ name = 'P2'; displayOrder = 3; isPositionBased = $true; exactPoints = 10; partialPoints = 5 },
    @{ name = 'P3'; displayOrder = 4; isPositionBased = $true; exactPoints = 10; partialPoints = 5 },
    @{ name = 'Fastest Lap'; displayOrder = 5; isPositionBased = $false; exactPoints = 6; partialPoints = 0 }
  )
} | ConvertTo-Json -Depth 6)

$null = Invoke-RestMethod -Method Put -Uri "$base/admin/races/$($race.id)/drivers" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  drivers = @(
    'Max Verstappen',
    'Lando Norris',
    'Charles Leclerc',
    'George Russell',
    'Lewis Hamilton',
    'Oscar Piastri',
    'Fernando Alonso',
    'Carlos Sainz'
  )
} | ConvertTo-Json -Depth 4)

[PSCustomObject]@{
  message = 'Demo seed complete'
  adminEmail = $adminEmail
  adminPassword = $adminPass
  leagueId = $league.id
  leagueName = $league.name
  raceId = $race.id
  raceName = $race.name
} | Format-List
