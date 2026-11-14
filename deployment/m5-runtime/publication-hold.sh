#!/usr/bin/env bash
# #466 part A: the owner-run publication hold command on the rewrite-dev host (alias prod), over SSH.
#   publication-hold.sh inspect --shop <shopId> --config <configId>
#   publication-hold.sh restore --shop <shopId> --config <configId> --operation <id> --inspect-digest <digest> --command-key <key> --confirm
#   publication-hold.sh resolve --shop <shopId> --config <configId> --operation <id> --command-key <key> --confirm
# It runs dist/publication-hold-main.js in a one-off container of the deployed worker image. The
# worker's private composition supplies the image, networks, credential wrapping key and app
# credentials; the worker's DATABASE_URL is blanked, and the command connects only as its own
# identity, read from a private file into the environment (never onto a command line). Every run's
# one JSON audit line is shown and appended to the private audit log.
set -euo pipefail
runtime="${INSIGNIA_RUNTIME_DIR:-$HOME/.local/share/insignia/runtime}"
composition="$runtime/worker.private.json"
url_file="$runtime/publication-hold-database-url"
audit="$runtime/publication-hold-audit.jsonl"
private_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u %a' "$1")" = "$(id -u) 600" ]
}
for file in "$composition" "$url_file"; do
  private_file "$file" || {
    echo "publication-hold: $file must be a regular file you own with mode 0600" >&2
    exit 2
  }
done
if [ -e "$audit" ] && ! private_file "$audit"; then
  echo "publication-hold: $audit must be a regular file you own with mode 0600" >&2
  exit 2
fi
IFS= read -r INSIGNIA_PUBLICATION_HOLD_DATABASE_URL <"$url_file" || true
case "$INSIGNIA_PUBLICATION_HOLD_DATABASE_URL" in
  postgresql://insignia_publication_hold:?*@?*) ;;
  *)
    echo "publication-hold: $url_file must hold the command identity's postgresql:// URL" >&2
    exit 2
    ;;
esac
export INSIGNIA_PUBLICATION_HOLD_DATABASE_URL
umask 077
docker compose -f "$composition" run --rm --no-deps -T \
  -e DATABASE_URL= -e INSIGNIA_PUBLICATION_HOLD_DATABASE_URL \
  --entrypoint /usr/local/bin/node worker /srv/insignia/worker/dist/publication-hold-main.js "$@" |
  tee -a "$audit"
