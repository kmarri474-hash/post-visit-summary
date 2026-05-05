import {
  PublicClientApplication,
  LogLevel,
  type Configuration,
  type RedirectRequest,
} from "@azure/msal-browser";

const env = (import.meta as any).env ?? {};

/**
 * Feature flag — flip a single env var to bypass SSO entirely (useful for
 * local UI work without an internet connection or AAD access).
 *
 *   VITE_SSO_ENABLED=false   → SSO disabled, UI runs as anonymous dev user
 *   VITE_SSO_ENABLED=true    → SSO enforced (default)
 *
 * Anything other than the literal string "false" (case-insensitive) keeps
 * SSO enabled, so missing values default to ON.
 */
export const isSsoEnabled: boolean =
  String(env.VITE_SSO_ENABLED ?? "true").toLowerCase() !== "false";

const clientId: string = env.VITE_MSAL_CLIENT_ID ?? "";
const tenantId: string = env.VITE_MSAL_TENANT_ID ?? "";
const redirectUri: string =
  env.VITE_MSAL_REDIRECT_URI ?? window.location.origin + "/";
const postLogoutRedirectUri: string =
  env.VITE_MSAL_POST_LOGOUT_REDIRECT_URI ?? redirectUri;
const apiScope: string = env.VITE_MSAL_API_SCOPE ?? "";

if (isSsoEnabled && (!clientId || !tenantId)) {
  // Surface a clear error early; without these MSAL silently fails on init.
  // eslint-disable-next-line no-console
  console.error(
    "[auth] Missing VITE_MSAL_CLIENT_ID or VITE_MSAL_TENANT_ID env vars. SSO cannot initialize."
  );
}

if (!isSsoEnabled) {
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] SSO is DISABLED via VITE_SSO_ENABLED=false. The app is running in anonymous dev mode — never deploy this build."
  );
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
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error(message);
        else if (level === LogLevel.Warning) console.warn(message);
      },
      piiLoggingEnabled: false,
    },
  },
};

export const loginRequest: RedirectRequest = {
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    ...(apiScope ? [apiScope] : []),
  ],
};

// Singleton MSAL instance shared by the React provider and helper modules
// (e.g. api.ts uses it to read the active account for the X-User-Id header).
export const msalInstance = new PublicClientApplication(msalConfig);
