# Security reporting

Do not post API keys, private projects, exploit details or signing credentials in public issues.

Before the public repository opens, use a private contact method listed on the maintainer's GitHub profile: https://github.com/ahmadaIanazi. If none is available, open an issue containing only a request for a private security contact; do not include the vulnerability details. The public launch checklist requires enabling GitHub private vulnerability reporting before release.

After private reporting is enabled on the public repository, use its Security → Report a vulnerability flow. Include the version, operating system, reproduction steps and impact without real credentials or personal media. This early beta has no promised response SLA or bug bounty.

Local storage does not make all input trusted. The application binds to loopback, restricts browser origins and uses a local session. Online AI sends selected inputs to external providers. Never disable these protections to simplify a test.
