#!/bin/sh
# Fixture for issue #13: hangs past the Supervisor SIGINT grace (forcing
# SIGINT -> SIGKILL escalation). `trap '' INT` marks SIGINT ignored and that
# disposition survives `exec`, so this stays a SINGLE process: the SIGKILL
# leaves no orphaned children behind.
trap '' INT
echo "hang-int-server ready"
exec sleep 300
