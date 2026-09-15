#!/bin/sh
# Fixture for issue #19: hangs on --help so the probe timeout must kill it.
# exec keeps this a single process (no subshell grandchild), matching a real
# hanging binary: killing the probed pid must leave nothing behind.
exec sleep 30
