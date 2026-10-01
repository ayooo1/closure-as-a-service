# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/ayooo1/closure-as-a-service/security/advisories/new)
with steps to reproduce, and you'll get a reply within a week.

Especially welcome:

- ways to read or recover another user's text (answers, messages, practice conversations)
- ways to get around the per-IP rate limit or run up model costs
- prompt injection that defeats the safety check or the privacy rules
- secrets or personal data exposed by the code, images or manifests

## Supported versions

Only the latest release and `main` get security fixes.

## How user data is handled

- Answers with a name or personal details are never cached or stored. Practice conversations are never stored.
- Feedback votes store only answer categories (ending, tone, and so on), never text.
- Logs record request metadata (method, route, status, client IP), latency and token counts, never request bodies
  or message content.
