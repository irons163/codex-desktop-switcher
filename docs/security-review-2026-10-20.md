# Pre-publication security review — 2026-10-20

Scope: tracked source, all local Git refs and history, screenshots, dependency
manifests, and CI/release workflows. No credential material was uploaded to an
external scanning service.

## Results

- Gitleaks 8.30.1 found no credentials in the complete Git history or working tree.
- Screenshot review confirmed all displayed accounts use `example.com` addresses.
- The historical text scan found no application account email addresses. Git
  author names and email addresses remain part of normal commit metadata.
- `npm audit` reported no known vulnerable dependencies. The package currently
  has no third-party runtime dependencies; Swift uses Apple system frameworks.
- GitHub Actions use pinned action commits, read-only default permissions, and
  checkout without persisted credentials. Release credentials are not passed to
  pull-request CI. Release source must match its tag and be on the default branch.

## Issues fixed before publication

1. Added Host, Origin, and Fetch Metadata checks to the local HTTP bridge to
   reject cross-site control requests and DNS-rebinding hosts.
2. Restricted CDP account commands to the default execution context of the
   trusted main Codex app frame; remote frames and unrelated app paths cannot
   invoke account actions.
3. Made credential directories owner-only and authentication snapshots/backups
   owner-readable/writable. Replacements use atomic writes, avoiding partial
   credential files and destination-symlink overwrites.
4. Restricted browser sign-in destinations to official OpenAI HTTPS URLs and
   dynamic asset discovery to bundled app assets.
5. Added credential-file ignore rules and full-history secret scanning to CI.

Regression coverage includes hostile HTTP headers, untrusted frame contexts,
credential file permissions, symlink destinations, and lookalike sign-in URLs.
The existing account-switching, localization, and release checks also pass.

## Remaining boundary

Account snapshots contain plaintext OAuth tokens, and the local CDP port grants
powerful access to Codex. Processes with local access remain trusted. This review
is a scoped source and secret-exposure check, not a guarantee against all
vulnerabilities or an independent penetration test. See [SECURITY.md](../SECURITY.md).
