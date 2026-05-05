# HCP SSO (Microsoft Entra ID) — SPA Integration Pattern

A reusable, end-to-end recipe for wiring **HCP SSO** (Microsoft Entra ID, OIDC
+ PKCE) into any Vite + React + TypeScript SPA, as implemented in
`post-visit-summary`. Lift the file structure and code blocks below into a new
repo and only the env-var values change.

---

## 1. Architecture at a glance

```
                                                ┌────────────────────────────┐
   Browser                       SPA            │ Microsoft Entra ID         │
   ┌──────────┐  GET / unauth   ┌─────────────┐ │ (HCP SSO tenant)           │
   │  User    │ ──────────────► │ RequireAuth │ │                            │
   └──────────┘                 └─────┬───────┘ │  /authorize  → login UI    │
        ▲                             │ Navigate│  /token      → code → JWT  │
        │                             ▼         │  /keys       → JWKS        │
        │                       ┌─────────────┐ │                            │
        │                       │  /login     │ └──────────────┬─────────────┘
        │       loginRedirect() └─────┬───────┘                │
        │                             │                       redirect_uri
        │                             ▼                       (auth code+state)
        │                       Entra hosted UI ──────────────►│
        │                                                      │
        │                       handleRedirectPromise()        │
        │                       MSAL exchanges code → tokens   │
        │                       (PKCE verifier, NO client      │
        │                        secret — public client)       │
        │                                                      │
        │ Authenticated ◄──────────────────────────────────────┘
        │
        ▼
   App routes: /intake, /profile, /logout …  (X-User-Id header = AAD UPN)
```

- **Flow:** Authorization Code with PKCE (S256). Public client — **no client
  secret in browser code, ever.**
- **Token storage:** `sessionStorage` (cleared when the tab closes). MSAL keys
  prefixed `msal.*`.
- **Route gating:** a `<RequireAuth>` wrapper on protected routes redirects
  unauthenticated users to `/login` (preserving the original path in router
  state).
- **Backend identity:** SPA forwards the active account's UPN as `X-User-Id`
  (or, optionally, the access token as `Authorization: Bearer …`).

---

## 2. Prerequisites (HCP SSO self-service, one-time)

Before any code runs in a given environment:

1. **Create / update the OIDC client** in HCP SSO self-service. You will
   receive an email with:
   - `Client ID` (UUID)
   - `Tenant ID` (UUID; embedded in the authorization / token / JWK URLs)
   - `Redirect URI(s)` — must match exactly, **trailing slash matters**.
   - The custom API scope: `api://<client-id>/openid` (or similar).
2. **Register every redirect URI you intend to use**, e.g.:
   - `http://localhost:5173/` for local dev
   - `https://stage-<app>.optum.com/` for stage
   - `https://<app>.optum.com/` for prod
3. **Link at least one `AZU`-prefixed Active Directory group** to the client.
   Users not in a linked group cannot log in (`AADSTS` error from Entra).
4. **Never commit secrets.** Public values (Client ID, Tenant ID, redirect
   URIs, scope) may live in `.env`/build args. If the architecture later
   requires a confidential client (server-side token exchange), the secret
   goes in CyberArk / Azure Key Vault / HashiCorp Vault — never source.

---

## 3. Dependencies

```bash
npm install @azure/msal-browser @azure/msal-react
```

Pinned ranges used here:

```json
"@azure/msal-browser": "^3.27.0",
"@azure/msal-react":   "^2.2.0"
```

MSAL v3 requires **explicit `await msalInstance.initialize()`** before any
React component or `acquireToken*` call — see §6.

---

## 4. Environment variables

All `VITE_*` variables are inlined at **build time** by Vite, so per-env builds
need them as build args. They are public values — safe to commit defaults.

```bash
# .env.example

# Master feature flag — flip to "false" to bypass SSO entirely (local dev only).
VITE_SSO_ENABLED=true

VITE_MSAL_CLIENT_ID=<oidc-client-id>
VITE_MSAL_TENANT_ID=<entra-tenant-id>

# Must EXACTLY match a registered redirect URI (trailing slash matters).
VITE_MSAL_REDIRECT_URI=http://localhost:5173/
VITE_MSAL_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/

# Custom API scope minted for this client (used to obtain an access token
# for downstream API calls).
VITE_MSAL_API_SCOPE=api://<oidc-client-id>/openid
```

---

### 4.1 Feature-flag bypass (`VITE_SSO_ENABLED`)

A single env var disables SSO end-to-end so contributors can iterate on UI
without AAD access (offline, on a plane, behind a captive portal, etc.).
Default is `true`; only the literal string `"false"` (case-insensitive) turns
SSO off.

When `VITE_SSO_ENABLED=false`:

- `msalInstance.initialize()` and `handleRedirectPromise()` are **skipped** in
  bootstrap.
- `<MsalProvider>` is **not** mounted — components must guard MSAL hooks with
  `isSsoEnabled` (split into `Foo` / `FooAuthed` sub-components).
- `<RequireAuth>` becomes a passthrough.
- `/login` auto-navigates to the home route; `/logout` and `/profile` show a
  yellow "SSO disabled" notice.
- `getUserId()` returns a persistent random `dr-xxxx` id from `localStorage`
  so audit logs are still attributed to a stable identity per browser.
- Header `<UserMenu>` renders a yellow `SSO off (dev)` badge.

Implementation pattern — every component that calls `useMsal()` /
`useIsAuthenticated()` must short-circuit **before** invoking the hook,
because the provider isn't mounted in this mode. Example:

```tsx
import { isSsoEnabled } from "../lib/auth/msalConfig";

export default function UserMenu() {
  if (!isSsoEnabled) return <SsoOffBadge />;
  return <UserMenuAuthed />;          // ← only this child calls useMsal()
}
```

Production safety:

- Never deploy a build with the flag off. Add a CI guard that fails the build
  if `VITE_SSO_ENABLED !== "true"` for any non-dev image.
- The msalConfig logs a `console.warn` on every page load when SSO is
  disabled, making it obvious during PR review screen-shares.

---

## 5. File structure (drop-in)

```
web/
├── .env                       # local-dev VITE_MSAL_* values
├── .env.example               # documents the variables
├── Dockerfile.prod            # accepts VITE_MSAL_* as build args
├── nginx.conf                 # SPA fallback + no-store on index.html
└── src/
    ├── main.tsx               # bootstraps MSAL + router (public + gated)
    ├── App.tsx                # protected app shell, renders <UserMenu/>
    ├── components/
    │   └── UserMenu.tsx       # header pill → /profile, logout → /logout
    ├── lib/
    │   ├── api.ts             # getUserId() reads MSAL active account
    │   └── auth/
    │       ├── msalConfig.ts  # Configuration + msalInstance singleton
    │       └── AuthProvider.tsx  # <AuthProvider>, <RequireAuth>
    └── pages/
        ├── Login.tsx          # public clean login page
        ├── Logout.tsx         # public sign-out confirm / farewell
        └── Profile.tsx        # protected user-claims viewer
```

---

## 6. Reference implementation

### 6.1 `src/lib/auth/msalConfig.ts`

```ts
import {
  PublicClientApplication,
  LogLevel,
  type Configuration,
  type RedirectRequest,
} from "@azure/msal-browser";

const env = (import.meta as any).env ?? {};
const clientId   = env.VITE_MSAL_CLIENT_ID ?? "";
const tenantId   = env.VITE_MSAL_TENANT_ID ?? "";
const redirectUri          = env.VITE_MSAL_REDIRECT_URI          ?? window.location.origin + "/";
const postLogoutRedirectUri = env.VITE_MSAL_POST_LOGOUT_REDIRECT_URI ?? redirectUri;
const apiScope   = env.VITE_MSAL_API_SCOPE ?? "";

if (!clientId || !tenantId) {
  console.error("[auth] Missing VITE_MSAL_CLIENT_ID / VITE_MSAL_TENANT_ID.");
}

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "sessionStorage",   // safer than localStorage against XSS persistence
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
      loggerCallback: (level, msg, pii) => {
        if (pii) return;
        if (level === LogLevel.Error)   console.error(msg);
        else if (level === LogLevel.Warning) console.warn(msg);
      },
    },
  },
};

export const loginRequest: RedirectRequest = {
  scopes: [
    "openid", "profile", "email", "offline_access",
    ...(apiScope ? [apiScope] : []),
  ],
};

// Singleton — also imported by api.ts to read the active account.
export const msalInstance = new PublicClientApplication(msalConfig);
```

### 6.2 `src/lib/auth/AuthProvider.tsx`

```tsx
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { MsalProvider, useIsAuthenticated, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { msalInstance } from "./msalConfig";

export function AuthProvider({ children }: { children: ReactNode }) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const location = useLocation();

  // Don't navigate while MSAL is still processing a redirect.
  if (inProgress !== InteractionStatus.None &&
      inProgress !== InteractionStatus.Startup) {
    return <div className="min-h-screen flex items-center justify-center">Signing you in…</div>;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}
```

### 6.3 `src/main.tsx` — bootstrap order is critical

```tsx
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { EventType, type AuthenticationResult } from "@azure/msal-browser";
import { AuthProvider, RequireAuth } from "./lib/auth/AuthProvider";
import { msalInstance } from "./lib/auth/msalConfig";
// … your page imports

async function bootstrap() {
  // 1) v3 requires explicit init before any other MSAL API call.
  await msalInstance.initialize();

  // 2) Resolve the auth-code response if we just came back from /authorize.
  const result = await msalInstance.handleRedirectPromise();
  if (result?.account) {
    msalInstance.setActiveAccount(result.account);
  } else if (!msalInstance.getActiveAccount()) {
    const accts = msalInstance.getAllAccounts();
    if (accts.length > 0) msalInstance.setActiveAccount(accts[0]);
  }

  // 3) Keep active account in sync on subsequent logins / token acquisitions.
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) {
      const p = event.payload as AuthenticationResult | null;
      if (p?.account) msalInstance.setActiveAccount(p.account);
    }
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public auth routes — must NOT be wrapped in RequireAuth */}
          <Route path="/login"  element={<Login />} />
          <Route path="/logout" element={<Logout />} />

          {/* Protected app shell */}
          <Route path="/" element={<RequireAuth><App /></RequireAuth>}>
            <Route index            element={<Navigate to="/home" replace />} />
            <Route path="home"      element={<Home />} />
            <Route path="profile"   element={<Profile />} />
            {/* … */}
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

bootstrap().catch((err) => console.error("[bootstrap]", err));
```

### 6.4 `src/lib/api.ts` — propagate identity to backend

```ts
import { msalInstance } from "./auth/msalConfig";

export function getUserId(): string {
  const acct = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (acct?.username) return acct.username;          // AAD UPN
  return "anonymous";                                // defensive fallback
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getUserId(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : await res.json();
}
```

> **When the backend later validates JWTs**, replace `X-User-Id` with
> `Authorization: Bearer <access_token>` obtained via
> `msalInstance.acquireTokenSilent({ scopes: [VITE_MSAL_API_SCOPE], account })`,
> falling back to `acquireTokenRedirect` on `InteractionRequiredAuthError`.

### 6.5 Public pages — `Login.tsx` (skeleton)

```tsx
const onSignIn = () => instance.loginRedirect(loginRequest);
// shows "Sign in with Microsoft" button;
// reads ?signedOut=1 to display a friendly banner;
// useEffect: if isAuthenticated → navigate to "/home" replace.
```

### 6.6 Public pages — `Logout.tsx` (skeleton)

```tsx
const onConfirm = () => instance.logoutRedirect({
  account,
  postLogoutRedirectUri:
    import.meta.env.VITE_MSAL_POST_LOGOUT_REDIRECT_URI ??
    window.location.origin + "/",
});
// when authed: "Sign out?" confirm card with Cancel + Sign out
// when unauthed: "You're signed out" + link to /login?signedOut=1
```

### 6.7 Protected pages — `Profile.tsx` (skeleton)

```tsx
const { accounts } = useMsal();
const account = accounts[0];
const claims  = (account.idTokenClaims ?? {}) as Record<string, any>;
// Renders: name, username (UPN), oid (localAccountId), tid, exp, amr,
//          groups[], roles[], plus a copy-to-clipboard idTokenClaims dump.
```

---

## 7. Routing pattern

| Route        | Auth      | Purpose                                                     |
|--------------|-----------|-------------------------------------------------------------|
| `/login`     | public    | Branded sign-in card. Auto-forwards if already authed.      |
| `/logout`    | public    | Confirm screen → `logoutRedirect`; farewell when unauthed.  |
| `/`          | protected | App shell with header / nav (`<App />`).                    |
| `/profile`   | protected | View current account's id-token claims.                     |
| everything else | protected | Your business pages.                                     |

The post-logout URI returns to `/`. Because `/` is gated, `RequireAuth` then
forwards to `/login?signedOut=1`, so we **never need an extra registered URI
for the logout page**.

---

## 8. Per-environment build (Docker)

```dockerfile
ARG VITE_MSAL_CLIENT_ID
ARG VITE_MSAL_TENANT_ID
ARG VITE_MSAL_REDIRECT_URI
ARG VITE_MSAL_POST_LOGOUT_REDIRECT_URI
ARG VITE_MSAL_API_SCOPE
ENV VITE_MSAL_CLIENT_ID=${VITE_MSAL_CLIENT_ID} \
    VITE_MSAL_TENANT_ID=${VITE_MSAL_TENANT_ID} \
    VITE_MSAL_REDIRECT_URI=${VITE_MSAL_REDIRECT_URI} \
    VITE_MSAL_POST_LOGOUT_REDIRECT_URI=${VITE_MSAL_POST_LOGOUT_REDIRECT_URI} \
    VITE_MSAL_API_SCOPE=${VITE_MSAL_API_SCOPE}
RUN npm run build
```

```bash
docker build -f Dockerfile.prod \
  --build-arg VITE_MSAL_CLIENT_ID=… \
  --build-arg VITE_MSAL_TENANT_ID=… \
  --build-arg VITE_MSAL_REDIRECT_URI=https://stage-<app>.optum.com/ \
  --build-arg VITE_MSAL_POST_LOGOUT_REDIRECT_URI=https://stage-<app>.optum.com/ \
  --build-arg VITE_MSAL_API_SCOPE=api://<client-id>/openid \
  -t <app>-web:stage web/
```

`nginx.conf` essentials (SPA fallback + no-cache shell so deploys never serve
a stale auth bundle):

```nginx
location = /index.html {
  add_header Cache-Control "no-store, no-cache, must-revalidate";
}
location / {
  try_files $uri $uri/ /index.html;
}
```

---

## 9. Backend identity propagation

Two options, in increasing strictness:

| Option                          | What the SPA sends                       | What the backend does                                                       |
|---------------------------------|------------------------------------------|------------------------------------------------------------------------------|
| **A. UPN header (current)**     | `X-User-Id: <upn>`                       | Trust the SPA; record UPN in audit log.                                      |
| **B. Bearer JWT**               | `Authorization: Bearer <access_token>`   | Validate sig + `iss` + `aud` against JWKS; pull UPN/oid/groups from claims.  |
| **C. Bearer JWT + group check** | same as B                                | Additionally enforce membership of an `AZU`-prefix group in the `groups` claim. |

For B/C the backend needs the JWK endpoint
`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`, the expected
audience (typically `api://<client-id>` or the client id), and a JWT library
(e.g. `python-jose` / `authlib` / `fastapi-azure-auth`).

---

## 10. Validation checklist (smoke test per env)

1. Open the SPA URL → redirected to `/login` → click **Sign in with Microsoft**.
2. AAD login UI appears → after success, lands on `/` → renders home page.
3. DevTools → **Network** → `/oauth2/v2.0/authorize` request includes
   `code_challenge` and `code_challenge_method=S256`. The token request to
   `/oauth2/v2.0/token` carries `code_verifier` and **no client secret**.
4. DevTools → **Application** → `sessionStorage` has `msal.*` keys;
   `localStorage` does not (unless you flipped the cache option).
5. Click the user pill → `/profile` shows correct UPN, oid, tenant, groups.
6. Click logout → `/logout` confirm → after sign-out, lands on
   `/login?signedOut=1` with the green banner.
7. Backend audit log records the real UPN as `actor`.
8. Negative path: a user not in a linked AZU group sees `AADSTS` denial from
   Entra (this happens on the IdP, not in the SPA).

---

## 11. Common errors

| Symptom                                   | Likely cause                                                                  |
|-------------------------------------------|--------------------------------------------------------------------------------|
| `AADSTS50011: redirect URI mismatch`      | Build-time `VITE_MSAL_REDIRECT_URI` does not match a registered URI exactly. Trailing slash, protocol, port all matter. |
| `AADSTS50105` / "user not assigned"       | No AZU group linked, or user not a member.                                    |
| `interaction_in_progress` console error   | A second `loginRedirect` fired before the first finished. Ensure `RequireAuth` does not call it from a `useEffect` while `inProgress !== None`, and that you `await handleRedirectPromise()` exactly once during bootstrap. |
| Tokens missing after redirect             | Forgot `await msalInstance.initialize()` before `handleRedirectPromise()`.    |
| Logout returns to a blank screen          | `postLogoutRedirectUri` not registered. Use a URI you've already registered as a normal redirect (e.g. `/`) and let `RequireAuth` re-route to `/login`. |
| `audit_log` shows random `dr-xxxx` ids    | `getUserId()` fallback fired before MSAL bootstrapped. Ensure `bootstrap()` awaits initialize + handleRedirectPromise **before** rendering. |

---

## 12. Future hardening (out of scope for the SPA-only baseline)

- **Backend JWT validation** against the tenant JWKS (option B above).
- **Group-claim enforcement** server-side (option C). Note: with > 200
  group memberships Entra emits a `_claim_names` indirection — handle it.
- **Silent token acquisition** for API calls
  (`acquireTokenSilent` → fallback `acquireTokenRedirect`) and an Axios/fetch
  interceptor that attaches `Authorization: Bearer …`.
- **Conditional Access compliance** — surface MSAL `InteractionRequiredAuthError`
  to the user with a "Re-authenticate" CTA.
- **Idle / absolute session timeout** in the SPA on top of MSAL token expiry.
- **Logout broadcast** across tabs via a `BroadcastChannel("auth")` so other
  open tabs reload into `/login` immediately.
- **CSP** — restrict `connect-src` to `login.microsoftonline.com`,
  `login.live.com`, your API origin, and self.

---

## 13. Reuse checklist (copy this to a new repo)

- [ ] Create OIDC client in HCP SSO self-service.
- [ ] Register all redirect URIs (dev / stage / prod, trailing slash).
- [ ] Link an `AZU`-prefix AD group.
- [ ] `npm install @azure/msal-browser @azure/msal-react`.
- [ ] Copy the four files from `src/lib/auth/`, `src/components/UserMenu.tsx`,
      `src/pages/Login.tsx`, `src/pages/Logout.tsx`, `src/pages/Profile.tsx`.
- [ ] Wire `bootstrap()` in `src/main.tsx` (init → handleRedirectPromise →
      setActiveAccount → render).
- [ ] Wrap protected routes in `<RequireAuth>`; keep `/login` & `/logout` public.
- [ ] Add `VITE_MSAL_*` to `.env.example` and Docker build args.
- [ ] Update backend to read `X-User-Id` (option A) — or roll JWT validation
      (option B/C) when ready.
- [ ] Run the §10 smoke test in each environment.
