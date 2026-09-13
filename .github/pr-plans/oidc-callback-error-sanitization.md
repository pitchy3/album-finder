# Implementation plan: sanitize OIDC callback errors

- Never echo arbitrary `openid-client`, provider, HTTP, or nested error messages to the browser.
- Return a stable generic authentication-failure response while retaining safe standardized OAuth error identifiers when useful.
- Sanitize/redact callback diagnostics before console and auth-event persistence, reusing existing secret-safe diagnostic helpers where appropriate.
- Ensure client secrets, authorization codes, tokens, cookies, and sensitive query values cannot enter responses or persisted error messages.
- Add tests with deliberately secret-bearing provider and nested errors and assert no secret reaches response/log/audit payloads.
