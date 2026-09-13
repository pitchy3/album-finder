# Implementation plan: unify OIDC token refresh

- Eliminate the independent refresh implementation in `forceTokenRefresh()`.
- Extract/reuse one internal refresh transaction for middleware and forced refresh callers.
- Preserve single-flight behavior through session persistence.
- Preserve rotated refresh tokens and synchronize waiter session state.
- Keep transient provider/network failures non-destructive.
- Keep invalid/revoked refresh-token failures distinct from transient failures.
- Add concurrency, rotation, persistence-failure, and transient-error regression tests for forced refresh as well as middleware refresh.
- Remove `forceTokenRefresh()` entirely if repository-wide analysis confirms there are no legitimate callers and tests/docs can be simplified safely.
