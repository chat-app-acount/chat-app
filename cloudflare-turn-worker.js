/*
 * ChatSpace TURN credential Worker
 *
 * Deploy this file as a Cloudflare Worker.
 * Configure these Worker variables:
 *   FIREBASE_PROJECT_ID = chat-app-44d95
 *   TURN_KEY_ID         = your Cloudflare TURN key ID (secret variable recommended)
 *   TURN_KEY_SECRET     = your Cloudflare TURN key secret (SECRET; never commit it)
 *
 * The browser sends its Firebase ID token. This Worker verifies it, then returns
 * short-lived TURN credentials. The long-lived Cloudflare secret never reaches
 * index.html or the browser.
 */

const ALLOWED_ORIGIN = "https://chat-app-acount.github.io";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const TURN_CREDENTIAL_TTL = 86400;

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid token header");

  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId ||
      claims.iss !== "https://securetoken.google.com/" + projectId ||
      typeof claims.sub !== "string" || !claims.sub ||
      claims.sub.length > 128 ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now + 60) {
    throw new Error("Invalid token claims");
  }

  const jwksResponse = await fetch(FIREBASE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!jwksResponse.ok) throw new Error("Could not load signing keys");
  const jwks = await jwksResponse.json();
  const jwk = (jwks.keys || []).find(key => key.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");

  const publicKey = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"]
  );
  const signedContent = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", publicKey,
    decodeBase64Url(parts[2]), signedContent
  );
  if (!valid) throw new Error("Invalid token signature");
  return claims.sub;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (origin !== ALLOWED_ORIGIN) return json({ error: "origin_not_allowed" }, 403, origin);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    if (!env.FIREBASE_PROJECT_ID || !env.TURN_KEY_ID || !env.TURN_KEY_SECRET) {
      return json({ error: "worker_not_configured" }, 503, origin);
    }

    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "authentication_required" }, 401, origin);

    try {
      await verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID);
      const turnResponse = await fetch(
        "https://rtc.live.cloudflare.com/v1/turn/keys/" +
          encodeURIComponent(env.TURN_KEY_ID) +
          "/credentials/generate-ice-servers",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.TURN_KEY_SECRET,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL })
        }
      );
      if (!turnResponse.ok) {
        return json({ error: "turn_credentials_unavailable" }, 502, origin);
      }
      const data = await turnResponse.json();
      const iceServers = (Array.isArray(data.iceServers) ? data.iceServers : [])
        .map(server => {
          const raw = Array.isArray(server.urls) ? server.urls : [server.urls];
          const urls = raw.filter(url =>
            typeof url === "string" &&
            /^(stun|stuns|turn|turns):/i.test(url) &&
            !url.includes(":53?") && !url.endsWith(":53")
          );
          return { ...server, urls };
        })
        .filter(server => server.urls.length);
      if (!iceServers.some(server => server.urls.some(url => /^turns?:/i.test(url)))) {
        return json({ error: "turn_server_missing" }, 502, origin);
      }
      return json({ iceServers }, 200, origin);
    } catch (error) {
      return json({ error: "authentication_or_turn_error" }, 401, origin);
    }
  }
};
