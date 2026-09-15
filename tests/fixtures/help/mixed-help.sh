#!/bin/sh
# Fixture for issue #19: help split across stdout (ctx-size) and stderr (mlock).
cat <<'EOF'
usage: llama-server [options]

-t,    --threads N       number of CPU threads to use
-c,    --ctx-size N      size of the prompt context
EOF
cat >&2 <<'EOF'
--port PORT              port to listen (default: 8080)
--mlock                  DEPRECATED in favor of `--load-mode`
EOF
