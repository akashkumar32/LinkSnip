$BASE = "http://localhost:3000"
$pass = 0
$fail = 0

function Test-Api {
    param(
        [string]$name,
        [string]$method,
        [string]$endpoint,
        $body = $null,
        [int]$expectStatus = 200,
        [hashtable]$headers = @{},
        [string]$token = $null
    )
    try {
        $uri = "$BASE$endpoint"
        $reqHeaders = @{ "Content-Type" = "application/json" }
        if ($token) { $reqHeaders["Authorization"] = "Bearer $token" }
        foreach ($k in $headers.Keys) { $reqHeaders[$k] = $headers[$k] }

        $params = @{
            Method = $method
            Uri = $uri
            Headers = $reqHeaders
            ErrorAction = "SilentlyContinue"
            UseBasicParsing = $true
        }
        if ($body) { $params["Body"] = ($body | ConvertTo-Json -Depth 5) }

        $response = Invoke-WebRequest @params 2>$null
        $status = [int]$response.StatusCode
        $ok = ($status -eq $expectStatus)

        if ($ok) {
            $script:pass++
            Write-Host "  [PASS] [$status] $name" -ForegroundColor Green
        } else {
            $script:fail++
            Write-Host "  [FAIL] [$status] $name (expected $expectStatus)" -ForegroundColor Red
        }
        try { return $response.Content | ConvertFrom-Json } catch { return $null }
    } catch {
        $statusCode = 0
        try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
        if ($statusCode -eq $expectStatus) {
            $script:pass++
            Write-Host "  [PASS] [$statusCode] $name" -ForegroundColor Green
        } else {
            $script:fail++
            Write-Host "  [FAIL] [$statusCode] $name (expected $expectStatus)" -ForegroundColor Red
        }
        return $null
    }
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  LinkSnip Full API Test Suite" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# ── AUTH ────────────────────────────────────────────────────
Write-Host "`n[AUTH TESTS]" -ForegroundColor Yellow

$rand = Get-Random -Maximum 99999
$regEmail = "testuser$rand@linksnip.io"

$r = Test-Api "Register new user" POST "/api/auth/register" @{ email=$regEmail; password="Test@1234!" } 201
Start-Sleep -Milliseconds 400

$r = Test-Api "Login with correct credentials" POST "/api/auth/login" @{ email=$regEmail; password="Test@1234!" } 200
$token = $null
if ($r -and $r.token) { $token = $r.token }

Test-Api "Login with wrong password (expect 401)" POST "/api/auth/login" @{ email=$regEmail; password="WrongPass" } 401

Test-Api "Get current user" GET "/api/auth/me" -token $token

# ── URL SHORTENING ───────────────────────────────────────────
Write-Host "`n[URL SHORTENING TESTS]" -ForegroundColor Yellow

$r = Test-Api "Shorten basic URL (302)" POST "/api/shorten" @{ target_url="https://www.google.com"; redirect_type=302 } 201 -token $token
$shortCode1 = if ($r -and $r.link) { $r.link.short_code } else { $null }

$aliasRand = Get-Random -Maximum 9999
$myAlias = "test-alias-$aliasRand"
$r = Test-Api "Shorten with custom alias" POST "/api/shorten" @{ target_url="https://www.github.com"; custom_alias=$myAlias; redirect_type=302 } 201 -token $token

Test-Api "Duplicate alias rejection (expect 409)" POST "/api/shorten" @{ target_url="https://www.bing.com"; custom_alias=$myAlias } 409 -token $token

Test-Api "Shorten with expiration date" POST "/api/shorten" @{ target_url="https://www.example.com"; expire_at="2030-12-31T23:59:59Z"; redirect_type=302 } 201 -token $token

$r = Test-Api "Shorten with click limit (max 5)" POST "/api/shorten" @{ target_url="https://www.bing.com"; max_clicks=5; redirect_type=302 } 201 -token $token
$clickLimitCode = if ($r -and $r.link) { $r.link.short_code } else { $null }

Test-Api "Shorten with tags" POST "/api/shorten" @{ target_url="https://www.stackoverflow.com"; tags="dev,tools"; redirect_type=302 } 201 -token $token

$passAliasRand = Get-Random -Maximum 9999
$passAlias = "locked-$passAliasRand"
Test-Api "Shorten password-protected link" POST "/api/shorten" @{ target_url="https://www.secret.com"; custom_alias=$passAlias; password="mypass123"; redirect_type=302 } 201 -token $token

Test-Api "Malicious URL blocked (IP-based)" POST "/api/shorten" @{ target_url="http://192.168.1.1/login.php" } 400

Test-Api "Shorten with 301 permanent redirect" POST "/api/shorten" @{ target_url="https://www.amazon.com"; redirect_type=301 } 201 -token $token

# ── REDIRECTION ─────────────────────────────────────────────
Write-Host "`n[REDIRECTION TESTS]" -ForegroundColor Yellow

if ($shortCode1) {
    Test-Api "Short link 302 redirect" GET "/$shortCode1" -expectStatus 302
}
Test-Api "Custom alias redirect" GET "/$myAlias" -expectStatus 302
Test-Api "Non-existent link returns 404" GET "/nonexistent-xyz99999" -expectStatus 404

# ── QR CODE ─────────────────────────────────────────────────
Write-Host "`n[QR CODE TESTS]" -ForegroundColor Yellow
$qrUrl = "/api/qr?url=https%3A%2F%2Fgoogle.com&dark=%23000000&light=%23ffffff"
Test-Api "QR code PNG generation" GET $qrUrl -expectStatus 200

# ── LINK MANAGEMENT ─────────────────────────────────────────
Write-Host "`n[LINK MANAGEMENT TESTS]" -ForegroundColor Yellow

$r = Test-Api "Get all links (dashboard)" GET "/api/links" -token $token
$firstLinkId = if ($r -and $r.links -and $r.links.Count -gt 0) { $r.links[0].id } else { $null }

Test-Api "Search links by keyword" GET "/api/links?search=google" -token $token
Test-Api "Sort links by most clicks" GET "/api/links?sort=clicks" -token $token
Test-Api "Sort links by oldest" GET "/api/links?sort=oldest" -token $token
Test-Api "Filter links by tag" GET "/api/links?tag=dev" -token $token

if ($firstLinkId) {
    Test-Api "Edit destination URL" PUT "/api/links/$firstLinkId" @{ target_url="https://www.updated-destination.com"; redirect_type=302 } 200 -token $token
    Test-Api "Edit redirect type to 301" PUT "/api/links/$firstLinkId" @{ redirect_type=301 } 200 -token $token
    Test-Api "Disable link (is_enabled=false)" PUT "/api/links/$firstLinkId" @{ is_enabled=$false } 200 -token $token
    Test-Api "Re-enable link (is_enabled=true)" PUT "/api/links/$firstLinkId" @{ is_enabled=$true } 200 -token $token
}

# ── PASSWORD VERIFY ─────────────────────────────────────────────────────────
Write-Host "`n[PASSWORD PROTECTION TEST]" -ForegroundColor Yellow
Test-Api "Verify correct link password" POST "/api/verify-password" @{ code=$passAlias; password="mypass123" } 200
Test-Api "Wrong link password (expect 401)" POST "/api/verify-password" @{ code=$passAlias; password="wrongpass" } 401

# ── BULK OPERATIONS ─────────────────────────────────────────────────────────
Write-Host "`n[BULK OPERATIONS TESTS]" -ForegroundColor Yellow

$csvContent = "https://www.python.org,py-org-$aliasRand,Python Official,dev`nhttps://www.nodejs.org,node-org-$aliasRand,Node.js Official,dev`nhttps://www.rust-lang.org,rust-lang-$aliasRand,Rust Language,dev"
Test-Api "Bulk CSV shorten 3 URLs" POST "/api/bulk-shorten" @{ csv=$csvContent } 201 -token $token

$r = Test-Api "Get links for bulk delete" GET "/api/links" -token $token
if ($r -and $r.links -and $r.links.Count -ge 2) {
    $idsToDelete = @([int]$r.links[0].id, [int]$r.links[1].id)
    Test-Api "Bulk delete selected links" POST "/api/links/bulk-delete" @{ ids=$idsToDelete } 200 -token $token
}

# ── ANALYTICS ───────────────────────────────────────────────
Write-Host "`n[ANALYTICS TESTS]" -ForegroundColor Yellow

$r = Test-Api "Get links for analytics" GET "/api/links" -token $token
$analyticsId = if ($r -and $r.links -and $r.links.Count -gt 0) { $r.links[0].id } else { $null }

if ($analyticsId) {
    Test-Api "Get analytics for link" GET "/api/analytics/$analyticsId" -token $token
    Test-Api "Export analytics CSV" GET "/api/export/$analyticsId" -token $token
}

Test-Api "Cache hit rate stats" GET "/api/cache/stats"

# ── AI TESTS ────────────────────────────────────────────────
Write-Host "`n[AI TESTS]" -ForegroundColor Yellow
Test-Api "AI alias suggestions" POST "/api/ai/suggest-alias" @{ target_url="https://headphones-shop.com/sale"; title="Wireless Headphones" } 200
Test-Api "AI safety scan - safe URL" POST "/api/ai/analyze-safety" @{ target_url="https://www.google.com" } 200
Test-Api "AI safety scan - risky URL" POST "/api/ai/analyze-safety" @{ target_url="http://free-prize-winner.xyz/claim" } 200

# ── API KEY TESTS ────────────────────────────────────────────
Write-Host "`n[API KEY TESTS]" -ForegroundColor Yellow

$r = Test-Api "Generate API key" POST "/api/auth/api-key" -token $token
$apiKey = if ($r -and $r.api_key) { $r.api_key } else { $null }

if ($apiKey) {
    Test-Api "Use API key header to shorten" POST "/api/shorten" @{ target_url="https://www.example.com/apikey-test"; redirect_type=302 } 201 -headers @{ "X-API-Key"=$apiKey }
    Test-Api "Revoke API key" DELETE "/api/auth/api-key" -token $token
}

# ── SWAGGER ─────────────────────────────────────────────────
Write-Host "`n[SWAGGER DOCS TEST]" -ForegroundColor Yellow
Test-Api "Swagger UI responds" GET "/api-docs/" -expectStatus 200

# ── PASSWORD VERIFY ─────────────────────────────────────────
Write-Host "`n[PASSWORD PROTECTION TEST]" -ForegroundColor Yellow
Test-Api "Verify correct link password" POST "/api/verify-password" @{ code=$passAlias; password="mypass123" } 200
Test-Api "Wrong link password (expect 401)" POST "/api/verify-password" @{ code=$passAlias; password="wrongpass" } 401

# ── DELETE SINGLE LINK ───────────────────────────────────────
Write-Host "`n[SINGLE DELETE TEST]" -ForegroundColor Yellow
if ($firstLinkId) {
    Test-Api "Delete single link" DELETE "/api/links/$firstLinkId" -token $token
}

# ── LOGOUT ──────────────────────────────────────────────────
Write-Host "`n[LOGOUT TEST]" -ForegroundColor Yellow
Test-Api "Logout user" POST "/api/auth/logout" -token $token

# ── SUMMARY ─────────────────────────────────────────────────
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  TEST RESULTS" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "  PASSED: $pass" -ForegroundColor Green
Write-Host "  FAILED: $fail" -ForegroundColor Red
$total = $pass + $fail
if ($total -gt 0) {
    $pct = [math]::Round(($pass / $total) * 100)
    Write-Host "  SCORE:  $pass/$total ($pct%)" -ForegroundColor Cyan
}
Write-Host "=================================================" -ForegroundColor Cyan
