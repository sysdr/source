# Changelog — 0.2.0 (Gate 3 candidate)

## New
- People module (directory, profile lifecycle, attendance, leave) behind `ff_people_module`
- Employee self-service portal (profile, pay slips, leave)
- Magic-link / OTP landing for Admin and Employee
- API security headers (nosniff, frame deny, CSP, referrer)

## Hardening
- Lightweight DAST / RBAC probes
- Design-token WCAG AA contrast suite
- Payroll/TDS/People mutation-kill proxies
- Demo viewport screenshots Flows A–E

## Fixes
- Frankfurter FX proxied via `/api/fx` (browser CORS)
- CORS allows `X-SUEZ-ROLE` / accountant / employee headers
- Tailwind via local Vite plugin (CDN removed)

## Security
- npm audit: critical=0, high=0 (3 moderate residual)
