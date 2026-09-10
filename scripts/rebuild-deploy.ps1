# Rebuild the fork's two deploy artifacts from `main` and the topic branches.
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
# The invariant that makes it work: NOTHING IS EVER COMMITTED TO EITHER ARTIFACT. The
# moment a change lives only there, the artifact stops being regenerable and this script
# silently drops that change. FORK.md was exactly that, once (`fork/docs` is where it
# lives now).
#
# TWO ARTIFACTS, BUILT AS ONE STACK. `deploy-full` is `deploy` PLUS $PrivateTopics - it
# CONTINUES the public build rather than repeating it from `main`:
#
#     main --> [$Topics] --> deploy --> [$PrivateTopics] --> deploy-full
#
# One run produces both. That ordering is the whole design, and it buys three things:
#
#   - the $Topics merges happen ONCE per run instead of once per artifact, so every
#     recurring conflict is replayed through rerere half as often,
#   - the two artifacts are byte-identical over their shared half BY CONSTRUCTION, because
#     `deploy` is a literal ancestor of `deploy-full`. Built independently they could
#     drift - a resolution replayed differently, a merge ordered differently - and nothing
#     would say so,
#   - the history draws as one line with a short private tail, rather than two parallel
#     ladders of the same dozen merge commits.
#
# `deploy` is MOVED AND BANKED as soon as its own gate passes, before the private stage is
# attempted. So a failure in a private topic leaves a verified public artifact ready to
# push and `deploy-full` where it was; it never costs you a good public build.
#
# Because both artifacts are regenerated, both are force pushed and neither fast-forwards.
# That is stated in FORK.md so nobody reaches for `git pull`.
#
# Turn `git rerere` on before running this (`git config --global rerere.enabled true`).
# Several topics touch the same integration points - the trigger calls in
# messages.svelte.ts, the rows in settings-pages.ts - so the same handful of conflicts
# recur on every rebuild. rerere resolves them for you after the first time.
#
# Run it from anywhere EXCEPT `deploy` or `deploy-full`: the last steps move those
# branches, which git refuses to do while one is checked out.

param(
    # Skip the check/test/build gate on BOTH artifacts. For a rebuild you intend to inspect
    # by hand, never for one you intend to push.
    [switch]$SkipVerify,

    # Stop after `deploy`, leaving `deploy-full` where it was. Saves the second gate when
    # you have only touched public work and want the public artifact out now. The summary
    # says plainly that `deploy-full` is behind, so this can never be a silent skip.
    [switch]$PublicOnly
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
    'feature/corrections',
    'feature/random-roll-macros',
    # The frameworks base, and the date framework. A framework is a deterministic
    # calculation over story state that rewrites a marker inside a lorebook entry as
    # that entry reaches the prompt, or injects a block of its own.
    # The base may not know what any framework is about, which is what keeps it reusable
    # and what makes it the half that could go upstream. Date is the one framework it
    # carries anyway: the per-chat day mode is a BASE field, and nothing else can
    # produce the markers that mode reads, so shipping the two apart would leave half a
    # feature sitting here. Every other framework still registers itself on its own
    # branch and needs no edit to the base.
    'feature/frameworks',
    # The floating window shell, and the features built on it. All are cut from main; the
    # consumers are cut from the shell, which makes them SIBLINGS rather than a stack.
    # Retiring any consumer is still a one-line edit here and leaves the others standing.
    # The shell must be merged before all of them, which is the only ordering constraint in
    # this list that is a real dependency rather than a habit.
    #
    # That constraint REACHES ACROSS THE TWO LISTS: the frameworks panel is a third
    # consumer and it lives in $PrivateTopics, which is merged in a later stage and so is
    # ordered correctly for free. The trap is removal, not ordering. Dropping the shell from
    # here would leave `deploy` building perfectly and `deploy-full` failing to compile, and
    # the gate would report it as a failure in the private topic. Retire the shell only once
    # nothing in EITHER list imports it.
    #
    # A change to how those windows drag, dock or resize belongs on feature/floating-window,
    # never on a consumer: a copy on one of them is a copy the other cannot see, and the two
    # would then disagree about the same component on every rebuild.
    'feature/floating-window',
    # EchoChamber's reaction feed is a fourth consumer. It carried its own copy of the
    # shell's maths until the copy was removed, which is what moved it from above the
    # shell in this list to below it: the dependency is real now, not stylistic.
    'feature/echochamber',
    'feature/image-popout',
    'feature/notepad',
    # The frameworks panel: what every marker in this chat's books is doing, and the
    # per-chat switches for the frameworks themselves. Cut from feature/frameworks and
    # consumes the shell, so it needs BOTH above it and typechecks on neither alone.
    # It sits here rather than beside frameworks for that reason.
    'feature/frameworks-panel',
    # An entry can scan the steering standing over the reply. Touches the three context
    # builders on the line where each hands the scan its extra sources, and that is a line
    # feature/frameworks changes the neighbours of, so it sits AFTER it: the conflict is one
    # rerere shape and every shape above this point is left unchanged.
    'feature/lore-scan-steering',
    # Memoized token counting. Touches only src/lib/tokenizer/, so it overlaps nothing else
    # in either list and sits last purely to keep every conflict shape above it unchanged.
    'fix/token-count-cache'
)

# Topics that exist on this machine and the NAS ONLY, merged ON TOP OF `deploy` to make
# `deploy-full`. They are absent from `deploy`, so nothing here can reach the public fork
# by way of the artifact, which is the whole reason for a second list rather than a flag
# on the first one.
#
# A branch listed here has no `origin` copy, so the stale-branch check cannot cover it and
# there is no off-machine backup of it. That is a deliberate trade, and its price is that
# this PC and the NAS are the only two places that work exists.
#
# THE NAMES ARE NOT IN THIS FILE, and that is the point. This script is public, so a branch
# named here would announce the existence and the subject of the private work to anyone
# reading the repository, which defeats the separation the two lists exist to create. They
# live one per line in the file below, which is listed in .git/info/exclude and therefore
# cannot be committed even by `git add -A`.
#
# Absent or empty, the private stage is skipped and only `deploy` is built. That is the safe
# direction to fail: a private topic left out is a feature missing from the NAS, where a
# public topic wrongly included would be a leak.
$privateTopicsFile = Join-Path $PSScriptRoot 'private-topics.local.txt'
$PrivateTopics = if (Test-Path $privateTopicsFile) {
    @(Get-Content $privateTopicsFile |
        ForEach-Object { ($_ -replace '#.*$', '').Trim() } |
        Where-Object { $_ })
} else {
    @()
}

$buildFull = (-not $PublicOnly) -and ($PrivateTopics.Count -gt 0)

# `fix/menu-anchor` was here until upstream MERGED it: ours went up as PR #63 and is now
# main's own `33ecbaf`, with one follow-up on top of it (a `max-width: 100%` cap, because a
# style that draws a portrait column can leave that column narrower than the menu itself).
# Supersession by adoption, as with `feature/memory-defaults` below: the tree at the branch
# tip was byte-identical to upstream's commit, so carrying it would merge the same patch
# twice.
#
# `feature/memory-defaults` was here until upstream MERGED it: ours went up as PR #49 and is
# now main's own `891400f`, with two follow-ups on top of it (a double-click reset that falls
# through to the card, and a star on any tunable that has left the value below it). This is
# supersession by adoption rather than by reimplementation, so there is nothing to keep: the
# code in `main` IS ours, and carrying the branch would merge the same patch twice.
#
# `feature/per-chat-persona` was here until upstream built the same job itself (main's
# ChatSetupChip, utils/chat-setup.ts and the library's New Chat Defaults card, which cover
# persona, connection and preset as ours did plus the version pin). Ours was offered as
# PR #39 and CLOSED unmerged, so this is supersession by reimplementation rather than by
# adoption: the two store the SAME feature_state keys in different shapes, ours an object
# ({ follows, id }) and upstream's a plain id string, so neither reads the other's data.
# The branch is deliberately kept, un-rebased, until upstream's version has been tested,
# because it is the only description of what the old blobs meant.

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
if ($current -eq 'deploy' -or $current -eq 'deploy-full') {
    Fail 'Run this from any branch except `deploy` and `deploy-full`; the last steps move them.'
}

$allTopics = @($Topics) + @($PrivateTopics)
foreach ($topic in $allTopics) {
    git rev-parse --verify --quiet "$topic" > $null
    if ($LASTEXITCODE -ne 0) { Fail "Branch `"$topic`" does not exist. Fix the list it is named in." }
}

# A topic that is not sitting on current `main` re-fights the same main-vs-topic conflicts
# on every single rebuild. Reported rather than fixed here: rebasing rewrites published
# commits, which is a decision, not something a build script should do behind your back.
$stale = @()
foreach ($topic in $allTopics) {
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
# ONE worktree for BOTH artifacts: the private stage continues in the same tree, which is
# what makes `deploy` an ancestor of `deploy-full` and what saves a second `bun install`.

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

# Merge one list of topics onto whatever the build worktree is currently at. $artifact names
# the branch the result becomes, and appears in the merge messages: those commits ARE that
# branch's history the moment it is moved, so naming the scratch branch there would be a
# permanent lie in a branch other people read.
function Merge-Topics($topics, $artifact) {
    foreach ($topic in $topics) {
        Write-Host "[rebuild-deploy] Merging $topic into $artifact" -ForegroundColor Cyan
        git merge --no-ff -m "Merge branch '$topic' into $artifact" $topic
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
                if ($LASTEXITCODE -ne 0) { $script:keepBuild = $true; Fail "Could not commit the $topic merge." }
                Write-Host '    conflicts replayed from rerere' -ForegroundColor DarkGray
            }
            else {
                $script:keepBuild = $true
                Write-Host ''
                Write-Host "[rebuild-deploy] $topic has conflicts rerere has not seen before:" -ForegroundColor Yellow
                $remaining | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
                Write-Host '  Resolve them in the build worktree, which is left in place for it:' -ForegroundColor Yellow
                Write-Host "    $buildPath" -ForegroundColor Yellow
                Write-Host '    git add -A; git commit --no-edit' -ForegroundColor Yellow
                Write-Host '  then run this script again from the top. rerere records what you' -ForegroundColor Yellow
                Write-Host '  just did, so every later run resolves this one on its own.' -ForegroundColor Yellow
                Fail "Stopped at a conflict merging $topic."
            }
        }
    }
}

# Run for EACH artifact, not once at the end. `deploy` goes to the public fork and
# `deploy-full` is what the NAS actually runs, so each has to be green on its own terms:
# the private topics add code the public gate never compiled.
function Invoke-Gate($artifact) {
    if ($SkipVerify) {
        Write-Host "[rebuild-deploy] gate SKIPPED for $artifact (-SkipVerify)" -ForegroundColor Yellow
        return
    }

    Write-Host "[rebuild-deploy] $artifact : bun install" -ForegroundColor Cyan
    & bun install
    if ($LASTEXITCODE -ne 0) { Fail "bun install failed. $artifact was NOT moved." }

    Write-Host "[rebuild-deploy] $artifact : bun run check" -ForegroundColor Cyan
    & bun run check
    if ($LASTEXITCODE -ne 0) { Fail "Type check failed. $artifact was NOT moved." }

    Write-Host "[rebuild-deploy] $artifact : bun test" -ForegroundColor Cyan
    & bun test
    if ($LASTEXITCODE -ne 0) { Fail "Tests failed. $artifact was NOT moved." }

    # The image builds the client, so a build that breaks here breaks the NAS deploy
    # too - and it breaks it halfway: the checkout there has already been reset to the
    # new code by then, while the container carries on serving the old.
    Write-Host "[rebuild-deploy] $artifact : bun run build" -ForegroundColor Cyan
    & bun run build
    if ($LASTEXITCODE -ne 0) { Fail "Client build failed. $artifact was NOT moved." }
}

$publicBuilt = $null
$fullBuilt = $null

try {
    Push-Location $buildPath

    # --- Stage 1: main + $Topics -> deploy ---------------------------------------------

    Merge-Topics $Topics 'deploy'
    Invoke-Gate 'deploy'
    $publicBuilt = (git rev-parse HEAD).Trim()

    # Banked HERE, not at the end. `deploy` is verified at this point and owes nothing to
    # the private stage, so a private topic that fails to compile must not also cost you a
    # good public artifact.
    git branch -f deploy $publicBuilt
    if ($LASTEXITCODE -ne 0) { Fail "Could not move deploy. It is still where it was; the build is $publicBuilt." }
    Write-Host "[rebuild-deploy] deploy moved to $($publicBuilt.Substring(0,7))" -ForegroundColor Green

    # --- Stage 2: deploy + $PrivateTopics -> deploy-full -------------------------------

    if ($buildFull) {
        Merge-Topics $PrivateTopics 'deploy-full'
        Invoke-Gate 'deploy-full'
        $fullBuilt = (git rev-parse HEAD).Trim()

        git branch -f deploy-full $fullBuilt
        if ($LASTEXITCODE -ne 0) { Fail "Could not move deploy-full. It is still where it was; the build is $fullBuilt." }
        Write-Host "[rebuild-deploy] deploy-full moved to $($fullBuilt.Substring(0,7))" -ForegroundColor Green
    }
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

Remove-BranchIfPresent $buildBranch

# --- Say exactly what moved, and what did not ------------------------------------------

Write-Host ''
Write-Host "[rebuild-deploy] deploy      $($publicBuilt.Substring(0,7))  verified" -ForegroundColor Green
if ($fullBuilt) {
    Write-Host "[rebuild-deploy] deploy-full $($fullBuilt.Substring(0,7))  verified = deploy + $($PrivateTopics.Count) private topic(s)" -ForegroundColor Green
}
else {
    # Never a silent skip: `deploy-full` is the branch the NAS runs, so being told it is
    # behind is the difference between a deliberate public-only rebuild and a deploy that
    # quietly ships yesterday's code.
    $reason = if ($PublicOnly) { '-PublicOnly was given' } else { 'no private topics are configured' }
    git merge-base --is-ancestor deploy deploy-full 2>$null
    $note = if ($LASTEXITCODE -eq 0) { 'it is level with this deploy' } else { 'IT IS NOW BEHIND deploy AND MUST NOT BE PUSHED AS-IS' }
    Write-Host "[rebuild-deploy] deploy-full NOT rebuilt: $reason - $note." -ForegroundColor Yellow
}

Write-Host '  Publish with:' -ForegroundColor Green
Write-Host '      git push --force-with-lease origin deploy' -ForegroundColor Green
if ($fullBuilt) {
    Write-Host '      git push --force-with-lease nas deploy-full' -ForegroundColor Green
    Write-Host '  `nas`, never `origin`: deploy-full carries the private topics.' -ForegroundColor DarkGray
}
Write-Host '  --force-with-lease, never plain --force: both artifacts are force pushed by' -ForegroundColor DarkGray
Write-Host '  design, and the lease is what still refuses if something moved the ref meanwhile.' -ForegroundColor DarkGray
