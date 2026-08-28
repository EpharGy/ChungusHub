# Rebuild `deploy` from `main` and the fork's topic branches.
#
# `deploy` is a BUILD ARTIFACT, not a branch anyone commits to. It is `main` plus every
# branch in $Topics below, merged in order, and it is regenerated rather than added to.
# That is what buys the three things this fork is organised around:
#
#   - a feature can be SENT UPSTREAM, because its branch sits on plain `main` and holds
#     one change,
#   - a feature can be DROPPED when upstream supersedes it, by deleting one line from
#     $Topics rather than reverting a merge commit,
#   - `main` stays a pure mirror, so the fork reads as at-parity on GitHub.
#
# The invariant that makes it work: NOTHING IS EVER COMMITTED TO `deploy`. The moment a
# change lives only there, `deploy` stops being regenerable and this script silently drops
# that change. FORK.md was exactly that, once (`fork/docs` is where it lives now).
#
# Because `deploy` is regenerated, it is force pushed and does not fast-forward. That is
# stated in FORK.md so nobody reaches for `git pull`.
#
# Turn `git rerere` on before running this (`git config --global rerere.enabled true`).
# Several topics touch the same integration points - the trigger calls in
# messages.svelte.ts, the rows in settings-pages.ts - so the same handful of conflicts
# recur on every rebuild. rerere resolves them for you after the first time.
#
# Run it from anywhere EXCEPT `deploy` itself: the last step moves that branch, which git
# refuses to do while it is checked out.

param(
    # Skip the test/build gate. For a rebuild you intend to inspect by hand, never for one
    # you intend to push.
    [switch]$SkipVerify
)

# Deliberately NOT 'Stop'. Almost every step here is a native git call, and Windows
# PowerShell turns any stderr write from a native command into a terminating error under
# 'Stop' - which git does routinely on success ("Preparing worktree...", "Deleted branch").
# Every git call below is checked on $LASTEXITCODE instead, which is what actually says
# whether it worked.
$ErrorActionPreference = 'Continue'
Set-Location -Path (Join-Path $PSScriptRoot '..')

# Merge order. Keep it stable: a stable order means the same conflicts recur in the same
# shape, which is what lets rerere replay their resolutions. Add a branch here when you
# start one; DELETE a line here when upstream supersedes that work.
#
# The prefix says whether a branch could ever leave this fork. `feature/` and `fix/` sit on
# plain `main` and hold one change, so any of them can be opened as a PR upstream. `fork/`
# is the exception: those exist to describe or operate the fork itself, so upstream has no
# use for them and they are never submitted. Nothing in the script treats them differently;
# the prefix is for the person reading the list.
$Topics = @(
    'fork/docs',
    'fork/deploy-tooling',
    'feature/comfy-inject',
    'feature/docker',
    'feature/echochamber',
    'feature/per-chat-persona',
    'feature/memory-defaults'
)

function Fail($message) {
    Write-Host "[rebuild-deploy] $message" -ForegroundColor Red
    exit 1
}

# `git branch -D` on a branch that is not there is an error, and a leftover from a previous
# run is exactly as valid a starting state as a clean one.
function Remove-BranchIfPresent($name) {
    git show-ref --verify --quiet "refs/heads/$name"
    if ($LASTEXITCODE -eq 0) { git branch -D $name | Out-Null }
}

# --- Refuse to start from a state that would make the result a guess -------------------

if (git status --porcelain) {
    Fail 'Working tree is not clean. Commit or set aside your changes first.'
}

$current = (git rev-parse --abbrev-ref HEAD).Trim()
if ($current -eq 'deploy') {
    Fail 'Run this from any branch except `deploy`; the last step moves that branch.'
}

foreach ($topic in $Topics) {
    git rev-parse --verify --quiet "$topic" > $null
    if ($LASTEXITCODE -ne 0) { Fail "Branch `"$topic`" does not exist. Fix `$Topics." }
}

# A topic that is not sitting on current `main` re-fights the same main-vs-topic conflicts
# on every single rebuild. Reported rather than fixed here: rebasing rewrites published
# commits, which is a decision, not something a build script should do behind your back.
$stale = @()
foreach ($topic in $Topics) {
    $behind = (git rev-list --count "$topic..main").Trim()
    if ($behind -ne '0') { $stale += "$topic (behind main by $behind)" }
}
if ($stale.Count -gt 0) {
    Write-Host '[rebuild-deploy] These branches are behind `main`:' -ForegroundColor Yellow
    $stale | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host '    Rebase them onto `main` and force-push with --force-with-lease, or this' -ForegroundColor Yellow
    Write-Host '    rebuild re-resolves their upstream conflicts again next time.' -ForegroundColor Yellow
}

# --- Build it somewhere that is not your checkout --------------------------------------
#
# A temp worktree, so nothing here can disturb the tree you are working in, and so the
# script file itself is never the thing being reset out from under the running process.

$buildBranch = 'deploy-rebuild-wip'
$buildPath = Join-Path $env:TEMP 'chungushub-deploy-build'

if (Test-Path $buildPath) { git worktree remove --force $buildPath | Out-Null }
git worktree prune
Remove-BranchIfPresent $buildBranch

Write-Host "[rebuild-deploy] Building in $buildPath" -ForegroundColor Cyan
git worktree add -b $buildBranch $buildPath main | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Could not create the build worktree.' }

# Set when the run stops somewhere a human has to finish by hand, which is the one case
# where the build worktree must survive: the message below sends you into it.
$keepBuild = $false

try {
    Push-Location $buildPath

    foreach ($topic in $Topics) {
        Write-Host "[rebuild-deploy] Merging $topic" -ForegroundColor Cyan
        # The message names `deploy` rather than the scratch branch: this commit IS deploy's
        # history the moment the branch is moved, and "into deploy-rebuild-wip" would be a
        # permanent lie in a branch other people read.
        git merge --no-ff -m "Merge branch '$topic' into deploy" $topic
        if ($LASTEXITCODE -ne 0) {
            # rerere REWRITES the conflicted files from a resolution you gave it before, but
            # it does not finish the merge - git still exits non-zero and leaves the merge in
            # progress. So a failed merge is two different situations, and `git rerere
            # remaining` is what tells them apart: it lists only the paths rerere could NOT
            # answer. Empty means every conflict here is one already settled, and all that is
            # left to do is commit it.
            $remaining = @(git rerere remaining | Where-Object { $_ })
            if ($remaining.Count -eq 0) {
                git add -A
                git commit --no-edit | Out-Null
                if ($LASTEXITCODE -ne 0) { $keepBuild = $true; Fail "Could not commit the $topic merge." }
                Write-Host '    conflicts replayed from rerere' -ForegroundColor DarkGray
            }
            else {
                $keepBuild = $true
                Write-Host ''
                Write-Host "[rebuild-deploy] $topic has conflicts rerere has not seen before:" -ForegroundColor Yellow
                $remaining | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
                Write-Host '  Resolve them in the build worktree, which is left in place for it:' -ForegroundColor Yellow
                Write-Host "    $buildPath" -ForegroundColor Yellow
                Write-Host '    git add -A; git commit --no-edit' -ForegroundColor Yellow
                Write-Host '  then run this script again from the top. rerere records what you' -ForegroundColor Yellow
                Write-Host '  just did, so every later run resolves this one on its own.' -ForegroundColor Yellow
                Fail 'Stopped at a conflict.'
            }
        }
    }

    if (-not $SkipVerify) {
        Write-Host '[rebuild-deploy] bun install' -ForegroundColor Cyan
        & bun install
        if ($LASTEXITCODE -ne 0) { Fail 'bun install failed.' }

        Write-Host '[rebuild-deploy] bun run check' -ForegroundColor Cyan
        & bun run check
        if ($LASTEXITCODE -ne 0) { Fail 'Type check failed. `deploy` was NOT moved.' }

        Write-Host '[rebuild-deploy] bun test' -ForegroundColor Cyan
        & bun test
        if ($LASTEXITCODE -ne 0) { Fail 'Tests failed. `deploy` was NOT moved.' }

        # The image builds the client, so a build that breaks here breaks the NAS deploy
        # too - and it breaks it halfway: the checkout there has already been reset to the
        # new code by then, while the container carries on serving the old.
        Write-Host '[rebuild-deploy] bun run build' -ForegroundColor Cyan
        & bun run build
        if ($LASTEXITCODE -ne 0) { Fail 'Client build failed. `deploy` was NOT moved.' }
    }

    $built = (git rev-parse HEAD).Trim()
}
finally {
    Pop-Location
    # Kept deliberately after a conflict: the message above sends you into this worktree to
    # resolve it, so removing it here would delete the very directory being pointed at. The
    # next run clears it before starting, so a leftover is never a stale starting state.
    if (-not $keepBuild) {
        if (Test-Path $buildPath) { git worktree remove --force $buildPath | Out-Null }
        git worktree prune
    }
}

git branch -f deploy $built
if ($LASTEXITCODE -ne 0) { Fail "Could not move deploy. It is still where it was; the build is $built." }
Remove-BranchIfPresent $buildBranch

Write-Host ''
Write-Host "[rebuild-deploy] deploy is now $($built.Substring(0,7)), verified." -ForegroundColor Green
Write-Host '  Publish it with:' -ForegroundColor Green
Write-Host '      git push --force-with-lease origin deploy' -ForegroundColor Green
Write-Host '  --force-with-lease, never plain --force: deploy is force pushed by design,' -ForegroundColor DarkGray
Write-Host '  and the lease is what still refuses if someone else moved it meanwhile.' -ForegroundColor DarkGray
