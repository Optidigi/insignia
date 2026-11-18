#!/usr/bin/env bash
# #466 part A: the owner-run publication hold command on the production host (alias prod), over SSH.
#   publication-hold.sh inspect --shop <shopId> --config <configId>
#   publication-hold.sh restore --shop <shopId> --config <configId> --operation <id> --inspect-digest <digest> --command-key <key> --confirm
#   publication-hold.sh resolve --shop <shopId> --config <configId> --operation <id> --command-key <key> --confirm
# It runs dist/publication-hold-main.js in a one-off container of the worker service of the production
# stack (project `insignia`), which supplies the image, networks, credential wrapping key and app
# credentials; the worker's DATABASE_URL is blanked, and the command connects only as its own
# identity, read from a private file in the stack's secrets/ into the environment (never onto a
# command line). Every run's one JSON audit line, including this wrapper's own refusals, is shown and
# appended to the private audit log on the data volume.
set -euo pipefail
stack="${INSIGNIA_STACK_DIR:-/srv/saas/infra/stacks/insignia}"
state="${INSIGNIA_STATE_DIR:-/srv/data/saas/insignia/runtime-state}"
url_file="$stack/secrets/publication-hold-database-url"
audit="$state/publication-hold-audit.jsonl"
umask 077
private_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u %a' "$1")" = "$(id -u) 600" ]
}
# compose.yaml holds no secret (installed 0640): a regular file owned by the login, writable only by it.
owned_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && case "$(stat -c '%u %a' "$1")" in "$(id -u) 600" | "$(id -u) 640") true ;; *) false ;; esac
}
# refuse <command> <reason code> <message>: one audit line (appended when the log is usable), exit 2.
refuse() {
  local command='null' line
  case "$1" in inspect | restore | resolve) command="\"$1\"" ;; esac
  line="{\"event\":\"publication_hold_command\",\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"command\":$command,\"outcome\":\"refused\",\"reasons\":[\"$2\"],\"by\":\"wrapper\"}"
  echo "publication-hold: $3" >&2
  echo "$line"
  if [ ! -e "$audit" ] || private_file "$audit"; then echo "$line" >>"$audit"; fi
  exit 2
}
if [ -e "$audit" ] && ! private_file "$audit"; then
  refuse "${1-}" audit_log_not_private "$audit must be a regular file you own with mode 0600"
fi
owned_file "$stack/compose.yaml" ||
  refuse "${1-}" private_file_required "$stack/compose.yaml must be a regular file you own with mode 0600 or 0640"
for file in "$stack/.env" "$url_file"; do
  private_file "$file" || refuse "${1-}" private_file_required "$file must be a regular file you own with mode 0600"
done
IFS= read -r INSIGNIA_PUBLICATION_HOLD_DATABASE_URL <"$url_file" || true
case "$INSIGNIA_PUBLICATION_HOLD_DATABASE_URL" in
  postgresql://insignia_publication_hold:?*@?*) ;;
  *) refuse "${1-}" command_identity_required "$url_file must hold the command identity's postgresql:// URL" ;;
esac
export INSIGNIA_PUBLICATION_HOLD_DATABASE_URL
docker compose --project-directory "$stack" run --rm --no-deps -T \
  -e DATABASE_URL= -e INSIGNIA_PUBLICATION_HOLD_DATABASE_URL \
  --entrypoint /usr/local/bin/node worker /srv/insignia/worker/dist/publication-hold-main.js "$@" |
  tee -a "$audit"
