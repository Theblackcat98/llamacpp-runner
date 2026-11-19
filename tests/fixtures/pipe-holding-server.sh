#!/usr/bin/env bash
# Fixture for issue #82: a server whose long-lived child inherits the
# stdio pipes. The parent ignores SIGINT, so the shared teardown must
# escalate to SIGKILL; when the parent dies, the child is orphaned and
# keeps holding stdout/stderr, so the parent's stdio streams stay open
# long after the process itself has exited.
set -u

trap '' INT
sleep 300 &
printf 'pipe-holding-server listening on http://127.0.0.1:9999\n'
wait
