# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3.0 | No        |

## Reporting a Vulnerability

Email **security@zauso.ai** with:

- Description of the vulnerability
- Steps to reproduce
- Affected components (auth, CSRF, MCP, A2A, policy, etc.)
- Impact assessment

**Do not open a public issue for security vulnerabilities.**

## Scope

In scope: auth bypass, XSS, CSRF bypass, injection, privilege escalation, policy bypass, MCP/A2A protocol vulnerabilities, approval workflow bypass.

Out of scope: already public issues, DoS without auth bypass, social engineering.

## Response Timeline

- Acknowledge: within 48 hours
- Assessment: within 7 days
- Fix (critical): within 14 days
- Fix (high): within 30 days

## Credit

Security reporters are credited in release notes unless they prefer anonymity.
