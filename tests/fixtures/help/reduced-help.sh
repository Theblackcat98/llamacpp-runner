#!/bin/sh
if [ "$1" = "--help" ]; then
	printf '%s\n' probe >> "$0.probes"
	if [ -f "$0.fail" ]; then
		exit 1
	fi
	if [ -f "$0.pending" ]; then
		while [ ! -f "$0.release" ]; do sleep 0.05; done
	fi
	printf '%s\n' \
		'usage: reduced-server [options]' \
		'-t, --threads N' \
		'-c, --ctx-size N' \
		'--port PORT' \
		'--host HOST'
	exit 0
fi
printf '%s\n' "$@" > "$0.argv"
printf '%s\n' 'server is listening'
trap 'exit 0' INT TERM
while :; do sleep 0.05; done
