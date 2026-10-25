# Security notes

- Never commit `.env`, a SQLite database, real user records, API keys or bootstrap credentials.
- Set a strong unique `SESSION_SECRET` for every deployment.
- Public self-registration can only create citizen accounts. Officer accounts and the initial admin are provisioned server-side.
- Privileged API routes verify the current session role. Officers may only update reports assigned to them.
- Passwords are hashed with bcrypt. The server never returns password hashes.
- This is a portfolio starter, not a security-certified public-sector system. Before handling real personal data, add a persistent session store, CSRF protection, strict origin policy, operational monitoring, backups, retention controls and a security review.
- If a credential has ever been published, rotate it; removing it from a later commit does not make the old credential safe.
- Report vulnerabilities privately to the repository owner instead of posting exploit details publicly.
