#!/bin/bash
set -eu
old_pid="$1"; target="$2"; prepared="$3"; backup="$4"; log="$5"; ready="$6"; launcher="${7:-/usr/bin/open}"
exec >> "$log" 2>&1
printf 'Waiting for app to exit\n'
printf ready > "$ready"
for ((i=0;i<120;i++)); do
  if ! kill -0 "$old_pid" 2>/dev/null; then break; fi
  sleep 1
done
if kill -0 "$old_pid" 2>/dev/null; then echo 'ERROR: app did not exit; not replacing'; exit 1; fi
moved=0
rollback() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$moved" -eq 1 ]; then
    echo 'ERROR: install failed; restoring backup'
    if [ -e "$target" ]; then mv "$target" "${target}.failed-$(date +%s)" || true; fi
    mv "$backup" "$target" || true
    "$launcher" "$target" || true
  fi
  exit "$status"
}
trap rollback EXIT
[ -d "$target" ] && [ -d "$prepared" ] && [ ! -e "$backup" ]
mv "$target" "$backup"
moved=1
mv "$prepared" "$target"
"$launcher" "$target"
printf 'Launch requested; awaiting version confirmation on next app startup\n'
# Keep backup; startup verifies the pending receipt against the running version.
exit 0
