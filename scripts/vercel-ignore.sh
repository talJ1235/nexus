#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand). exit 0 = skip the build, exit 1 = build.
# - Only main deploys.
# - A manual Redeploy (same commit as the last deploy) always builds, so env var changes take effect.
# - Otherwise skip when only docs/, *.md or .claude/ changed since the last deployed commit.
[ "$VERCEL_GIT_COMMIT_REF" = "main" ] || exit 0
P=${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}
[ "$P" = "$VERCEL_GIT_COMMIT_SHA" ] && exit 1
git cat-file -e "$P^{commit}" 2>/dev/null || exit 1
git diff --quiet "$P" HEAD -- . ':(exclude)docs' ':(exclude)*.md' ':(exclude).claude'
