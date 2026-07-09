# Security Policy

<!-- agent-pmo:372ce7f -->

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Report privately through GitHub's **private vulnerability reporting**: go to the
repository's **Security** tab → **Report a vulnerability** (or
`https://github.com/MelbourneDeveloper/type_diagram/security/advisories/new`). This opens a
private, structured advisory only the maintainers can see.

If you cannot use that channel, email **cftools@nimblesite.co**.

When reporting, please include:

- The type of issue (e.g. injection, path traversal, auth bypass, secret exposure).
- The affected version(s), file(s), and any relevant configuration.
- Steps to reproduce, ideally a minimal proof of concept.
- The impact: what an attacker can achieve.

## What to Expect

- **Acknowledgement** within **3 business days**.
- An assessment and a remediation plan (or a reasoned decline) within **10 business days**.
- Coordinated disclosure: we will agree a disclosure timeline with you and credit
  you in the advisory unless you prefer to remain anonymous.

## Supported Versions

Security fixes land on the latest released minor version. Older lines are
supported only as noted below.

| Version | Supported |
| ------- | --------- |
| 0.5.x   | ✅        |
| < 0.5   | ❌        |
