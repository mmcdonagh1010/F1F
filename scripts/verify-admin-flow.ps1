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

$leagueName = "Flow Verification League $(Get-Date -Format 'yyyyMMddHHmmss')"
$invite = "FLOW$(Get-Random)"

$adminEmail = 'admin.flow@example.com'
$adminPass = 'Password123!'
$null = Register-Or-Login -Name 'Flow Admin' -Email $adminEmail -Password $adminPass
$null = Invoke-RestMethod -Method Post -Uri "$base/admin/bootstrap/promote-admin" -ContentType 'application/json' -Body (@{
  email = $adminEmail
  bootstrapKey = $bootstrapKey
} | ConvertTo-Json)
$adminLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ email = $adminEmail; password = $adminPass } | ConvertTo-Json)
$adminToken = $adminLogin.token
$adminId = $adminLogin.user.id

$playerEmail = "player$(Get-Random)@example.com"
$playerPass = 'Password123!'
$playerAuth = Register-Or-Login -Name 'Flow Player' -Email $playerEmail -Password $playerPass
$playerToken = $playerAuth.token
$playerId = $playerAuth.user.id

$adminHeaders = @{ Authorization = "Bearer $adminToken" }
$league = Invoke-RestMethod -Method Post -Uri "$base/admin/leagues" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  name = $leagueName
  inviteCode = $invite
} | ConvertTo-Json)
$leagueId = $league.id

$race = Invoke-RestMethod -Method Post -Uri "$base/admin/races" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  leagueId = $leagueId
  name = 'Bahrain GP Verification'
  circuitName = 'Bahrain International Circuit'
  raceDate = (Get-Date).AddDays(2).ToString('o')
  deadlineAt = (Get-Date).AddDays(1).ToString('o')
} | ConvertTo-Json)
$raceId = $race.id

$null = Invoke-RestMethod -Method Post -Uri "$base/admin/races/$raceId/categories" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  categories = @(
    @{ name = 'Race Winner'; displayOrder = 1; isPositionBased = $true; exactPoints = 10; partialPoints = 5 },
    @{ name = 'Pole Position'; displayOrder = 2; isPositionBased = $false; exactPoints = 8; partialPoints = 0 }
  )
} | ConvertTo-Json -Depth 5)

$raceDetail = Invoke-RestMethod -Method Get -Uri "$base/races/$raceId" -Headers $adminHeaders
$winnerCatId = ($raceDetail.categories | Where-Object { $_.name -eq 'Race Winner' }).id
$poleCatId = ($raceDetail.categories | Where-Object { $_.name -eq 'Pole Position' }).id

$playerHeaders = @{ Authorization = "Bearer $playerToken" }
$pickSave = Invoke-RestMethod -Method Post -Uri "$base/picks/$raceId" -Headers $playerHeaders -ContentType 'application/json' -Body (@{
  picks = @(
    @{ categoryId = $winnerCatId; valueText = 'Max Verstappen' },
    @{ categoryId = $poleCatId; valueText = 'Lando Norris' }
  )
} | ConvertTo-Json -Depth 5)

$resultSave = Invoke-RestMethod -Method Post -Uri "$base/admin/races/$raceId/results" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  tieBreakerValue = '1:31:44.000'
  results = @(
    @{ categoryId = $winnerCatId; valueText = 'Max Verstappen' },
    @{ categoryId = $poleCatId; valueText = 'Charles Leclerc' }
  )
} | ConvertTo-Json -Depth 5)

$raceBoard = Invoke-RestMethod -Method Get -Uri "$base/leaderboard/race/$raceId" -Headers $adminHeaders
$seasonBoard = Invoke-RestMethod -Method Get -Uri "$base/leaderboard/season" -Headers $adminHeaders
$playerRaceRow = $raceBoard | Where-Object { $_.id -eq $playerId }
$playerSeasonRow = $seasonBoard | Where-Object { $_.id -eq $playerId }

[PSCustomObject]@{
  leagueId = $leagueId
  raceId = $raceId
  adminEmail = $adminEmail
  playerEmail = $playerEmail
  picksSaved = $pickSave.message
  resultsSaved = $resultSave.message
  playerRacePoints = $playerRaceRow.points
  playerSeasonPoints = $playerSeasonRow.total_points
  expectedPoints = 10
} | Format-List
