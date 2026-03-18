const ALLOWED_HOST_SUFFIX = ".die-staemme.de";
const ALLOWED_PATHS = new Set([
  "/backend/get_servers.php",
  "/map/player.txt",
  "/map/village.txt",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/proxy") {
      return handleProxyRequest(url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleProxyRequest(url) {
  const target = url.searchParams.get("url");

  if (!target) {
    return jsonResponse({ error: "missing ?url=" }, 400);
  }

  let upstreamUrl;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return jsonResponse({ error: "invalid url" }, 400);
  }

  if (!isAllowedUpstream(upstreamUrl)) {
    return jsonResponse({ error: "target not allowed" }, 403);
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      cf: {
        cacheTtl: 900,
        cacheEverything: false,
      },
    });

    if (!upstreamResponse.ok) {
      return jsonResponse({ error: `remote http ${upstreamResponse.status}` }, 502);
    }

    return new Response(await upstreamResponse.text(), {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=900",
      },
    });
  } catch (error) {
    return jsonResponse({ error: error.message || "proxy request failed" }, 502);
  }
}

function isAllowedUpstream(url) {
  return (
    url.protocol === "https:" &&
    (url.hostname === "www.die-staemme.de" || url.hostname.endsWith(ALLOWED_HOST_SUFFIX)) &&
    ALLOWED_PATHS.has(url.pathname)
  );
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
