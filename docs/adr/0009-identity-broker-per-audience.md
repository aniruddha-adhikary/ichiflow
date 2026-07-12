# 0009 — Identity broker per audience (Keycloak primary), RFC 8693 propagation

- Status: accepted
- Date: 2026-07-12
- Deciders: ichiflow architecture
- Research: [../research/04-adapters-and-auth.md](../research/04-adapters-and-auth.md)

## Context

ichiflow serves **multiple Portals for distinct populations** (back-office staff, customers, partners),
each potentially with its own SSO (OIDC/SAML) *plus* legacy username/password and LDAP. Research 04 §B.0
separates two problems that must not be conflated: **AuthN / identity brokering** ("who is this, via
which portal, through which IdP?") vs **AuthZ** (handled in [0010](0010-hybrid-authorization-openfga-plus-policy.md)).
The stance is "broker per audience, don't build a custom IdP."

## Decision

- **Front each Portal with an identity broker** supporting realms/organizations and per-connection IdP
  config. **Keycloak is the primary default**: Quarkus-based, SAML *and* OIDC, upstream IdP brokering,
  LDAP/Kerberos federation + legacy password, **realm-per-portal isolation**, and token exchange —
  best coverage of the "legacy + modern + multi-portal" requirement (research 04 §B.1.1).
- **Zitadel is the B2B2C path**: built ground-up for multi-tenancy with event-sourced audit; chosen when
  B2B2C tenant isolation + immutable audit are the top priorities, and where **multiple IdPs per org** is
  needed (native in Zitadel; per-connection in Keycloak).
- **Pluggable strategy layer at the app edge** — each Portal declares which strategies it enables
  (oidc-A, oidc-B, saml-C, legacy-password, api-key, mTLS) as a Passport-style plugin registry. Use
  **Better Auth** as the modern TS foundation (Passport is maintenance-mode; Lucia deprecated; Auth.js is
  under the Better Auth umbrella). On the JVM, **Spring Security + pac4j** play the same role.
- **Identity propagation via OAuth2 Token Exchange (RFC 8693)**: the Portal edge authenticates the user
  once; downstream services receive audience-scoped, identity-preserving tokens from an STS (Keycloak/
  Zitadel both implement the grant), enabling least-privilege and B2B2C identity chaining. Log
  **delegation vs impersonation** on every exchange.
- Portals are declared artifacts (strategies + broker + tokenExchange config) an AI agent can generate
  and a validator can check — "declare, don't code" (research 04 §B.3).

Commercial brokers (WorkOS/Stytch/Auth0) are the documented "buy" option when SSO onboarding speed and
embedded admin portals beat self-hosting.

## Alternatives considered

- **Build a custom IdP.** Rejected outright — protocol breadth (OIDC/SAML/LDAP/legacy), security, and
  maintenance are a solved problem; building it is pure liability (research 04 §B.0).
- **Zitadel as primary instead of Keycloak.** Strong #2/co-primary; superior multi-tenant + event-sourced
  audit and native multi-IdP-per-org (research 04 §B.1.1). Not the default because Keycloak's SAML +
  legacy/LDAP federation breadth better fits the enterprise "legacy-inclusive" baseline; Zitadel is the
  explicit B2B2C alternative, not excluded.
- **Ory (Kratos/Hydra/Keto/Oathkeeper).** Powerful, fully API-driven, and Keto doubles as a Zanzibar
  authz engine — but you assemble 3–4 services ("opt into complexity") (research 04 §B.1.1). Rejected as
  default for assembly cost; viable for headless/API-first deployments.
- **Authentik / Authelia / Dex.** Authentik = "simpler Keycloak" but multi-tenancy is not a core strength;
  Authelia is a forward-auth gatekeeper, not a full IdP; Dex is a thin federation shim (research 04
  §B.1.1). All insufficient as the portal-IdP backbone.
- **Passport.js / Lucia / Auth.js as the TS foundation.** Passport is maintenance-mode, Lucia deprecated
  (Mar 2025), Auth.js folded under Better Auth (research 04 §B.1.2). Passport's strategy=plugin *model*
  is emulated; Better Auth is the actual foundation.
- **WorkOS as primary.** Productized enterprise SSO but **one IdP per organization** — a constraint to
  design around, not adopt as the multi-IdP baseline (research 04 §B.1.1, §B.5). Kept as a buy option.

## Consequences

Positive:
- Realm/org-per-portal gives isolation **by construction**, not convention; each audience gets its own
  IdP set, branding, and strategy list.
- RFC 8693 gives clean least-privilege propagation and B2B2C/cross-trust-domain chaining.
- The broker is swappable behind the strategy/PDP abstraction (Keycloak ↔ Zitadel).

Negative / costs:
- **Keycloak is CNCF incubating, not graduated** (mid-2026) — low practical risk (huge adoption, Red Hat
  backing) but note governance maturity; re-verify at adoption (research 04 §B.5).
- **Self-service SSO onboarding is real work**: the embeddable "customer configures their own SSO/SCIM"
  admin experience that WorkOS/Stytch sell must be **built** when self-hosting Keycloak/Zitadel
  (research 04 §B.5).
- **Token-exchange sprawl**: delegation chains can obscure "who did what on whose behalf" — mandatory
  exchange logging with delegation/impersonation flags (research 04 §B.5).
- Multi-IdP-per-tenant differs by broker (native Zitadel, per-connection Keycloak) — tenant/IdP mapping
  must avoid lock-in to a single broker's model.

## References

- Research 04 §B.0 (recommendation), §B.1 (brokers/strategy layer), §B.4 (propagation/multi-tenant SSO), §B.5 (risks)
- Keycloak (CNCF) — https://www.cncf.io/projects/keycloak/ · RFC 8693 — https://datatracker.ietf.org/doc/html/rfc8693
- Related: [0010](0010-hybrid-authorization-openfga-plus-policy.md), [0013](0013-modular-monolith-split-later.md), [0015](0015-first-party-mcp-server-and-agent-kit.md)
