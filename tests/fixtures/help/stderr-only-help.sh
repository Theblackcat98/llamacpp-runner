#!/bin/sh
# Fixture for issue #19: binary prints --help to stderr only (stdout empty).
cat >&2 <<'EOF'
usage: llama-server [options]

-t,    --threads N       number of CPU threads to use
-c,    --ctx-size N      size of the prompt context
--port PORT              port to listen (default: 8080)
--mlock                  DEPRECATED in favor of `--load-mode`
EOF
