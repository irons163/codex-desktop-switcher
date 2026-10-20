# Security

To report a vulnerability, use this repository's GitHub Security Advisories
instead of posting credentials or account snapshots in a public issue.

## Local trust boundary

The app manages existing Codex authentication files on your Mac. Account snapshots
and backups contain bearer credentials in plaintext; they are not encrypted by
the switcher. Keep your macOS account and backups protected. The switcher creates
its authentication directories with mode `0700`, writes authentication files
with mode `0600`, and replaces credential files atomically.

The bridge binds to `127.0.0.1`, validates loopback Host headers, and rejects
browser-origin and cross-site control requests. Account commands from CDP must
come from the main Codex app frame. Sign-in URLs are limited to HTTPS on
`auth.openai.com`.

CDP provides powerful local access to the running desktop app. Local processes
that can connect to its debug port are inside this trust boundary. The switcher
does not protect against malware running on your Mac. Stop the bridge and quit
Codex when you no longer need the debugging session.

## Releases and contributions

Pull-request CI receives no release credentials. Release jobs use an immutable
tag whose source must be on the default branch; Apple signing secrets are scoped
to the `release-production` environment. Both architecture builds must pass
tests, signature checks, Apple notarization, ticket validation, and Gatekeeper
assessment before installers are uploaded.

Never commit `auth.json`, account snapshots, `.env` files, signing certificates,
or private keys. CI scans the complete Git history with a pinned Gitleaks binary
and redacts any matching secrets from its logs.
