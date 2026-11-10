const http = require("node:http");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.DOH_TOKEN || "";
const UPSTREAM = process.env.UPSTREAM_DOH || "https://cloudflare-dns.com/dns-query";
const MAX_BODY = 4096;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 300;
const requestCounts = new Map();

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

function clientIp(req) {
  // Render supplies X-Forwarded-For. Use only the first address.
  return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .toString().split(",")[0].trim();
}

function rateLimited(ip) {
  const now = Date.now();
  let entry = requestCounts.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    entry = { startedAt: now, count: 0 };
  }
  entry.count += 1;
  requestCounts.set(ip, entry);

  // Keep the in-memory map bounded.
  if (requestCounts.size > 5000) {
    for (const [key, value] of requestCounts) {
      if (now - value.startedAt >= WINDOW_MS) requestCounts.delete(key);
    }
  }
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, "ok\n");
  }

  if (!TOKEN || url.pathname !== `/doh/${TOKEN}`) {
    return send(res, 404, "not found\n");
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return send(res, 405, "method not allowed\n");
  }

  if (rateLimited(clientIp(req))) {
    return send(res, 429, "rate limit exceeded\n");
  }

  try {
    let dnsMessage;

    if (req.method === "GET") {
      const encoded = url.searchParams.get("dns");
      if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
        return send(res, 400, "missing or invalid dns parameter\n");
      }
      dnsMessage = Buffer.from(encoded, "base64url");
    } else {
      const contentType = (req.headers["content-type"] || "").split(";")[0].trim();
      if (contentType !== "application/dns-message") {
        return send(res, 415, "expected application/dns-message\n");
      }
      dnsMessage = await readBody(req);
    }

    if (dnsMessage.length < 12 || dnsMessage.length > MAX_BODY) {
      return send(res, 400, "invalid DNS message size\n");
    }

    const upstreamResponse = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "accept": "application/dns-message",
        "content-type": "application/dns-message"
      },
      body: dnsMessage,
      signal: AbortSignal.timeout(7000)
    });

    if (!upstreamResponse.ok) {
      return send(res, 502, `upstream DNS error: ${upstreamResponse.status}\n`);
    }

    const answer = Buffer.from(await upstreamResponse.arrayBuffer());
    return send(res, 200, answer, "application/dns-message");
  } catch (error) {
    if (error.message === "body_too_large") {
      return send(res, 413, "request body too large\n");
    }
    return send(res, 502, "DNS upstream unavailable\n");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DoH forwarder listening on 0.0.0.0:${PORT}`);
  console.log(`Upstream: ${UPSTREAM}`);
  console.log(`Protected endpoint enabled: ${Boolean(TOKEN)}`);
});
