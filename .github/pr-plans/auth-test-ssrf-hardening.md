# Implementation plan: harden OIDC auth test endpoint

This draft PR is intentionally opened as an implementation task.

- Preserve unauthenticated OIDC testing only for genuine initial setup.
- Require authentication after auth has been configured.
- Validate issuer URLs before discovery; HTTPS only by default.
- Block loopback, link-local, private/internal IP targets, including DNS results, unless an explicit documented development override is enabled.
- Add rate limiting for discovery attempts.
- Preserve existing openid-client timeout/diagnostic behavior.
- Add regression tests for public issuers, local/private targets, initial setup, configured instances, DNS resolution, and throttling.
