# PR Plan — Phase 10: Portability and Process Identity

Status: planned
Source: `plans/audit-remediation-roadmap.md`
Spec references: `plans/llamamanager.md` §6.3, §7, §8

## Objective

Remove Linux-only orphan assumptions and reduce false-positive process detection and accidental signaling risk.

## In scope

- Add a process-inspection abstraction.
- Provide Linux `/proc` support and safe unsupported-platform behavior.
- Improve identity checks using command, owner, endpoint, and start identity where available.
- Handle IPv4, IPv6, localhost, and wildcard binding consistently.
- Expand network-exposure confirmation beyond exact `0.0.0.0`.
- Require expected process/endpoint relationship for adoption.
- Clarify permission-denied behavior.
- Document platform support and limitations.

## Out of scope

- Multi-instance support.
- Authentication for llama-server.
- New server protocols.

## Tests

- Mock process backends for Linux, macOS, Windows, and unsupported platforms.
- PID reuse and mismatched process tests.
- Wrong-port and closed-port tests.
- IPv4/IPv6 preflight tests.
- Permission-denied signaling tests.
- Public-interface warning tests.

## EXIT criterion

The app never silently treats a valid process as stale only because `/proc` is unavailable, and it refuses mismatched processes or endpoints without risking an unrelated kill.
