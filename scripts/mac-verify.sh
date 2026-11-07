#!/usr/bin/env bash
# Verifies one Atelier ref on Charlie's Mac (Apple Silicon), end to end, and writes a report.
#
#   scripts/mac-verify.sh <git-ref>          e.g. v2, v2-lot-01, a tag or a commit
#
# Steps (each one's exit code, duration and totals go into the report):
#   fetch + check out the ref in ~/dev/atelier (read-only clone of H1: the Mac never pushes), npm ci, typecheck,
#   lint, unit tests, build, e2e (real desktop), dist:mac, install to ~/Applications/Atelier.app (ad-hoc signature),
#   packaged smoke, then the clean-room check (scripts/cleanroom-check.mjs) on the source tree and on the installed
#   app's app.asar: no identifier of the third-party engine Atelier no longer uses may ship.
#
# Environment (all optional):
#   ATELIER_REPO     the clone (default ~/dev/atelier; cloned from ATELIER_REMOTE when missing)
#   ATELIER_REMOTE   only needed when the clone is missing: where to clone from (scp-style path such as build-pc:/path/to/atelier, or a git URL)
#   VERIFY_DIR       where the report and the logs go (default ~/dev/atelier-verify)
#
# Exit code: 0 only when every step passed. A failed step does not hide the others: steps that do not depend on it
# still run, the ones that do are reported as skipped.
set -euo pipefail

if [[ $# -ne 1 || -z "$1" || "$1" == -* ]]; then
  echo "usage: $0 <git-ref>   (a ref cannot start with '-')" >&2
  exit 2
fi

# A verdict must mean the specs ran: never inherit the switches that skip or force them from Charlie's shell.
unset ATELIER_E2E_SKIP ATELIER_E2E_ALLOW_SKIP ATELIER_E2E_FORCE FORCE_COLOR

# Checking out another ref rewrites this very file while bash is still reading it: run from a private copy. So a
# run always executes the script as it was before the checkout; changes to it apply from the next run.
if [[ -z "${_ATELIER_MAC_VERIFY_SELF_COPY:-}" ]]; then
  copy="$(mktemp -t atelier-mac-verify.XXXXXX)"
  cp "$0" "$copy"
  _ATELIER_MAC_VERIFY_SELF_COPY="$copy" exec "${BASH:-/bin/bash}" "$copy" "$@"
fi

REF="$1"
: "${HOME:?HOME is not set}"
REPO="${ATELIER_REPO:-$HOME/dev/atelier}"
REMOTE="${ATELIER_REMOTE:-}"
VERIFY_DIR="${VERIFY_DIR:-$HOME/dev/atelier-verify}"
SAFE_REF="${REF//[^A-Za-z0-9._-]/_}"
REPORT="$VERIFY_DIR/verify-mac-$SAFE_REF.md"
LOGS="$VERIFY_DIR/logs-$SAFE_REF"
APP_DEST="$HOME/Applications/Atelier.app"

# A Terminal on the Mac has Homebrew and ~/.local/bin already; ssh or launchd sessions may not.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.local/bin:$PATH"
# Plain logs (no colour codes) so the totals can be read back.
export NO_COLOR=1
# e2e screenshots go next to the logs, never into the clone's tracked docs/screens (the next checkout would refuse).
export ATELIER_E2E_SCREENS="$LOGS/screens"

mkdir -p "$VERIFY_DIR" "$LOGS" "$ATELIER_E2E_SCREENS"
STARTED="$(date '+%Y-%m-%d %H:%M:%S')"
NAMES=()
CODES=()
SECS=()
TOTALS=()
FAILED=0
COMMIT="?"

# Totals worth quoting, read from a step's log (grep finding nothing is not an error).
totals_of() {
  local name="$1" log="$2" found=""
  case "$name" in
    test) found="$(grep -E '^ *(Test Files|Tests) ' "$log" || true)" ;;
    e2e | packaged) found="$(grep -E '^ *[0-9]+ (passed|failed|skipped|flaky|did not run)' "$log" || true)" ;;
    cleanroom-src | cleanroom-app) found="$(grep -E '^cleanroom: ' "$log" || true)" ;;
    dist-mac) found="$(grep -E '(building|target=)' "$log" || true)" ;;
    engine-demo) found="$(grep -E '^(ffmpeg: |PASS|FAIL|=====)' "$log" || true)" ;;
  esac
  printf '%s' "$found"
}

# step <name> <command...>: runs it with its output in $LOGS/<name>.log, records exit code, time and totals.
step() {
  local name="$1"
  shift
  local log="$LOGS/$name.log" t0 rc
  t0=$(date +%s)
  echo "==> $name: $*"
  if "$@" >"$log" 2>&1; then rc=0; else rc=$?; fi
  NAMES+=("$name")
  CODES+=("$rc")
  SECS+=("$(($(date +%s) - t0))")
  TOTALS+=("$(totals_of "$name" "$log")")
  if [[ $rc -ne 0 ]]; then
    FAILED=1
    echo "    FAILED (exit $rc), last lines of $log:"
    tail -n 15 "$log" | sed 's/^/    /' || true
  else
    echo "    ok"
  fi
  return 0
}

skip() {
  NAMES+=("$1")
  CODES+=("skipped")
  SECS+=("0")
  TOTALS+=("skipped: $2")
  FAILED=1
  echo "==> $1: skipped ($2)"
}

passed() {
  local i
  for i in "${!NAMES[@]}"; do
    if [[ "${NAMES[$i]}" == "$1" ]]; then [[ "${CODES[$i]}" == "0" ]]; return; fi
  done
  return 1
}

# The ffmpeg the engine will use (same order as src/engine/media/tools.ts: Homebrew's keg-only ffmpeg-full first,
# then PATH) and what it lacks among the filters and encoders lot P4 needs. Homebrew's plain `ffmpeg` formula is a
# slim build since 2026 (no libass, no freetype): the render needs `brew install ffmpeg-full`.
media_tools() {
  local dir found="" filters encoders missing="" n
  for dir in /opt/homebrew/opt/ffmpeg-full/bin /usr/local/opt/ffmpeg-full/bin; do
    if [[ -x "$dir/ffmpeg" ]]; then found="$dir/ffmpeg"; break; fi
  done
  [[ -n "$found" ]] || found="$(command -v ffmpeg 2>/dev/null || true)"
  if [[ -z "$found" ]]; then
    echo "ffmpeg: not found (PATH=$PATH)"
    return 0
  fi
  echo "ffmpeg: $found"
  "$found" -hide_banner -version 2>/dev/null | head -n 1 || true
  filters="$("$found" -hide_banner -filters 2>/dev/null || true)"
  # RENDER_FILTERS + DRAW_FILTERS of src/engine/media (tools.ts, draw.ts)
  for n in ass drawtext gradients vignette xfade perspective loudnorm amix alimiter atempo; do
    grep -Eq "^ *[^ ]+ +$n " <<<"$filters" || missing="$missing $n"
  done
  encoders="$("$found" -hide_banner -encoders 2>/dev/null || true)"
  for n in libx264 aac flac; do
    grep -Eq "^ *[^ ]+ +$n " <<<"$encoders" || missing="$missing $n"
  done
  echo "missing filters/encoders the engine needs:${missing:- none}"
  if [[ -x "$(dirname "$found")/ffprobe" ]]; then echo "ffprobe: $(dirname "$found")/ffprobe"; else echo "ffprobe: $(command -v ffprobe 2>/dev/null || echo 'not found')"; fi
  echo "say: $([[ -x /usr/bin/say ]] && echo /usr/bin/say || echo 'not found')"
}

# What failed in one step, for the report: the failing tests and their first lines for the test runners
# (scripts/verify-summary.mjs reads their JSON report, else the plain log), the end of the log for the other steps.
# Read-only: it never touches CODES or FAILED.
failure_summary() {
  local name="$1" log="$LOGS/$1.log" kind="" summariser="$REPO/scripts/verify-summary.mjs"
  case "$name" in
    test) kind=vitest ;;
    e2e | packaged) kind=playwright ;;
  esac
  # exit 0: the failing tests are listed; 3 (nothing found inside the tests) or anything else: the log's end follows
  if [[ -n "$kind" && -f "$summariser" ]] && command -v node >/dev/null 2>&1; then
    if node "$summariser" "$kind" "$LOGS/$name.json" "$log" --root "$REPO"; then return 0; fi
    echo
  fi
  echo "Last 15 lines of \`$log\`:"
  echo '```'
  tail -n 15 "$log" 2>/dev/null | cut -c1-300 | sed "s/\`\`\`/'''/g" || true
  echo '```'
}

write_report() {
  local i
  # Remove the private copy, and only when it is the file being executed.
  if [[ "$0" == "${_ATELIER_MAC_VERIFY_SELF_COPY:-}" ]]; then rm -f -- "$0"; fi
  # macOS's /bin/bash is 3.2: expanding an empty array under set -u is an error there.
  if [[ ${#NAMES[@]} -eq 0 ]]; then
    echo "No step ran; no report written." >&2
    return
  fi
  {
    echo "# Mac verification of \`$REF\`"
    echo
    echo "- commit: \`$COMMIT\`"
    echo "- started: $STARTED, finished: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "- machine: $(uname -sm), macOS $(sw_vers -productVersion 2>/dev/null || echo '?'), node $(node -v 2>/dev/null || echo 'missing'), npm $(npm -v 2>/dev/null || echo 'missing')"
    echo "- clone: \`$REPO\` (origin \`$(git -C "$REPO" remote get-url origin 2>/dev/null || echo '?')\`)"
    echo "- logs: \`$LOGS\`"
    echo "- verdict: $([[ $FAILED -eq 0 ]] && echo '**PASS**' || echo '**FAIL**')"
    echo
    echo "| step | exit | seconds |"
    echo "|---|---|---|"
    for i in "${!NAMES[@]}"; do echo "| ${NAMES[$i]} | ${CODES[$i]} | ${SECS[$i]} |"; done
    echo
    echo "## Totals"
    for i in "${!NAMES[@]}"; do
      if [[ -n "${TOTALS[$i]}" ]]; then
        echo
        echo "### ${NAMES[$i]}"
        echo '```'
        echo "${TOTALS[$i]}"
        echo '```'
      fi
    done
    echo
    echo "## Media tools (what the engine finds)"
    echo '```'
    media_tools || true
    echo '```'
    local failures=0
    for i in "${!NAMES[@]}"; do
      [[ "${CODES[$i]}" == "0" || "${CODES[$i]}" == "skipped" ]] && continue
      if [[ $failures -eq 0 ]]; then
        echo
        echo "## Failures"
        failures=1
      fi
      echo
      echo "### ${NAMES[$i]} (exit ${CODES[$i]})"
      echo
      failure_summary "${NAMES[$i]}" || true
    done
  } >"$REPORT"
  echo "Report: $REPORT"
}
trap write_report EXIT

# The step functions below run as `if fn; then`, where bash ignores set -e: each command that must stop the step
# says so with `|| return 1`.

# e2e_run <name> <command...>: Playwright exits 0 when specs are skipped, so the log is judged too.
e2e_run() {
  local name="$1" gatelog
  shift
  gatelog="$LOGS/$name.playwright.log"
  # the JSON report lists the failing specs in the report (playwright*.config.ts add the reporter when this is set)
  rm -f "$LOGS/$name.json"
  ATELIER_E2E_JSON="$LOGS/$name.json" "$@" 2>&1 | tee "$gatelog" || return 1
  node "$REPO/scripts/e2e-gate.mjs" "$gatelog" || return 1
}

# ---- 1. the clone and the ref -------------------------------------------------------------------------------
checkout() {
  if [[ ! -d "$REPO/.git" ]]; then
    mkdir -p "$(dirname "$REPO")" || return 1
    if [[ -z "$REMOTE" ]]; then echo "ATELIER_REMOTE is not set and $REPO is not a clone: set ATELIER_REMOTE (e.g. build-pc:/path/to/atelier) or ATELIER_REPO" >&2; return 1; fi
    git clone "$REMOTE" "$REPO" || return 1
  fi
  cd "$REPO" || return 1
  # The Mac's clone is read-only: refuse to run over local edits rather than lose them.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "The clone $REPO has local changes; commit nothing here, discard them by hand first." >&2
    return 1
  fi
  git fetch --prune --tags origin || return 1
  local target
  if git rev-parse --verify -q --end-of-options "origin/$REF^{commit}" >/dev/null; then target="origin/$REF"; else target="$REF"; fi
  git checkout --detach "$target" -- || return 1
  git log -1 --format='%H %s'
}
step checkout checkout
if ! passed checkout; then
  echo "Cannot check out $REF: nothing else runs." >&2
  exit 1
fi
cd "$REPO"
COMMIT="$(git rev-parse HEAD)"

# ---- 2. install, static checks, unit tests, build -------------------------------------------------------------
step npm-ci npm ci
if ! passed npm-ci; then
  echo "npm ci failed: nothing else runs." >&2
  exit 1
fi
step typecheck npm run typecheck
step lint npm run lint
# vitest also writes a JSON report next to the logs (vitest.config.mts adds the reporter when this is set)
unit_tests() {
  rm -f "$LOGS/test.json"
  ATELIER_VITEST_JSON="$LOGS/test.json" npm test
}
step test unit_tests
step build npm run build
# our engine's own film (lot P4): Homebrew ffmpeg, the macOS `say` voice and the deterministic aligner on a real Mac
step engine-demo npm run engine:demo

# ---- 3. e2e on the real desktop, the app bundle, the installed app --------------------------------------------
if passed build; then
  step e2e e2e_run e2e npm run test:e2e
  step dist-mac npm run dist:mac
else
  skip e2e "build failed"
  skip dist-mac "build failed"
fi

install_app() {
  local src="$REPO/dist/mac/mac-arm64/Atelier.app"
  [[ -d "$src" ]] || { echo "No app bundle at $src" >&2; return 1; }
  # Never replace the app under a running copy.
  if pgrep -f "$APP_DEST/Contents/MacOS/Atelier" >/dev/null; then
    echo "Atelier is running from $APP_DEST: quit it first." >&2
    return 1
  fi
  mkdir -p "$HOME/Applications" || return 1
  if [[ -e "$APP_DEST" ]]; then rm -rf "$APP_DEST" || return 1; fi
  ditto "$src" "$APP_DEST" || return 1
  # Ad-hoc signature (Apple Silicon runs only signed code); built here, so there is no quarantine flag to clear.
  codesign --force --deep --sign - "$APP_DEST" || return 1
  codesign --verify --deep --strict --verbose=2 "$APP_DEST" || return 1
  local bid
  bid="$(plutil -extract CFBundleIdentifier raw "$APP_DEST/Contents/Info.plist")" || return 1
  echo "CFBundleIdentifier: $bid"
  [[ "$bid" == fr.charlie.atelier ]] || { echo "Unexpected bundle id $bid (want fr.charlie.atelier)" >&2; return 1; }
}
if passed dist-mac; then
  step install install_app
else
  skip install "dist:mac did not pass"
fi
if passed install; then
  step packaged e2e_run packaged npm run test:packaged
else
  skip packaged "the app is not installed"
fi

# ---- 4. clean room: no identifier of the removed third-party engine in the code or the shipped app (lot P1) -----
step cleanroom-src node scripts/cleanroom-check.mjs
if passed install; then
  step cleanroom-app node scripts/cleanroom-check.mjs --asar "$APP_DEST/Contents/Resources/app.asar"
else
  skip cleanroom-app "the app is not installed"
fi

if [[ $FAILED -eq 0 ]]; then
  echo "ALL GREEN for $REF ($COMMIT)"
  exit 0
fi
echo "SOME STEPS FAILED for $REF ($COMMIT): see $REPORT" >&2
exit 1
