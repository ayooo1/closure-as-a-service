#!/usr/bin/env bash
# Cuts a release: tags the latest main and pushes the tag. CI then runs every check, publishes the
# images as ghcr.io/<owner>/caas-{api,web}:<version>, and creates the GitHub Release with notes
# and a manifest pinned to that version.
#
#   ./scripts/release.sh            # next patch version (v1.2.3 -> v1.2.4)
#   ./scripts/release.sh minor      # v1.2.3 -> v1.3.0
#   ./scripts/release.sh major      # v1.2.3 -> v2.0.0
#   ./scripts/release.sh v1.3.0-rc.1  # an explicit version; one with "-" is a pre-release
set -euo pipefail

die() { echo "release: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
[[ $(git branch --show-current) == main ]] || die "releases are cut from main (git checkout main)"
[[ -z $(git status --porcelain) ]] || die "commit or stash your changes first"
git fetch --quiet --tags origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] ||
  die "local main differs from origin/main (git pull --ff-only, or merge your PR first)"

latest=$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1 || true)
IFS=. read -r major minor patch <<<"${latest:-v0.0.0}"
major=${major#v}

case ${1:-patch} in
  major) next="v$((major + 1)).0.0" ;;
  minor) next="v$major.$((minor + 1)).0" ;;
  patch) next="v$major.$minor.$((patch + 1))" ;;
  *) next=$1 ;;
esac
[[ $next =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "not a version: $next (expected e.g. v1.2.3)"
git rev-parse --quiet --verify "refs/tags/$next" >/dev/null && die "$next already exists"

if [[ -n $latest ]]; then
  [[ -n $(git rev-list "$latest..HEAD") ]] || die "nothing to release: main is still at $latest"
  echo "Changes since $latest:"
  git log --oneline --no-decorate "$latest..HEAD"
else
  echo "First release."
fi
echo
read -r -p "Tag main ($(git rev-parse --short HEAD)) as $next and push? [y/N] " answer
[[ $answer == [yY] ]] || die "cancelled"

git tag --annotate "$next" --message "$next"
git push --quiet origin "$next"

repo=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
echo "Pushed $next. CI is testing and publishing it: https://github.com/$repo/actions"
echo "The release will appear at https://github.com/$repo/releases/tag/$next"
