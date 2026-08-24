#!/usr/bin/env bash
set -u

PORT=8080
EXIT_CODE=0
IGNORE_INT=0
CRASH_AFTER=0
START_DELAY=0
PROGRESS_STEPS=5

while [ $# -gt 0 ]; do
	case "$1" in
	--port)
		PORT="$2"
		shift 2
		;;
	--exit-code)
		EXIT_CODE="$2"
		shift 2
		;;
	--ignore-int)
		IGNORE_INT=1
		shift
		;;
	--crash-after)
		CRASH_AFTER="$2"
		shift 2
		;;
	--start-delay)
		START_DELAY="$2"
		shift 2
		;;
	--progress-steps)
		PROGRESS_STEPS="$2"
		shift 2
		;;
	*)
		shift
		;;
	esac
done

if [ "$START_DELAY" != "0" ]; then
	sleep "$START_DELAY"
fi

printf '\033[2m[SYS]\033[0m fake-server starting on port %s\n' "$PORT"
i=1
while [ "$i" -le "$PROGRESS_STEPS" ]; do
	printf 'load %s%%\r' $((i * 100 / PROGRESS_STEPS))
	sleep 0.02
	i=$((i + 1))
done
printf '\n'
printf '\033[32m[HTTP]\033[0m HTTP server listening on http://127.0.0.1:%s\n' "$PORT"

if [ "$CRASH_AFTER" != "0" ]; then
	sleep "$CRASH_AFTER"
	printf '[ERR] CUDA out of memory\n'
	exit "$EXIT_CODE"
fi

sleep 300 &
waiter=$!
finish() {
	kill "$waiter" 2>/dev/null
	wait "$waiter" 2>/dev/null
	exit "$EXIT_CODE"
}
if [ "$IGNORE_INT" -eq 1 ]; then
	trap '' INT
	trap finish TERM
else
	trap finish INT TERM
fi
wait "$waiter"
exit "$EXIT_CODE"
