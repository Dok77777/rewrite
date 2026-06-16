const cookieJar = new Map();

/* =========================
   COOKIES
========================= */
function getCookies(host) {
  return cookieJar.get(host) || "";
}

function setCookies(host, setCookieHeaders) {
  if (!setCookieHeaders) return;
  const prev = cookieJar.get(host) || "";
  let newCookies = prev ? prev + "; " : "";

  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const c of cookies) {
    if (!c?.trim()) continue;
    const value = c.split(';')[0].trim();
    if (value) {
      newCookies += (newCookies.endsWith("; ") ? "" : "; ") + value;
    }
  }
  if (newCookies) cookieJar.set(host, newCookies);
}

/* =========================
   TARGET EXTRACTOR — ИСПРАВЛЕННЫЙ
========================= */
function extractTarget(reqUrl) {
  const url = new URL(reqUrl);

  // Mode 1: Path-based
  let path = url.pathname.slice(1);
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return safeDecode(path);
  }

  // Mode 2: ?url=... — улучшенный парсинг
  let targetStr = url.searchParams.get("url");

  // Если searchParams не сработал (из-за & в URL)
  if (!targetStr || !targetStr.includes("://")) {
    const fullUrl = reqUrl;
    const match = fullUrl.match(/url=([^&]+)/i);   // берём до первого &
    if (match) targetStr = match[1];
  }

  if (targetStr) {
    return safeDecode(targetStr);
  }

  return null;
}

function safeDecode(v) {
  if (!v) return null;
  let decoded = v.trim();
  for (let i = 0; i < 3; i++) {
    try {
      const temp = decodeURIComponent(decoded);
      if (temp === decoded) break;
      decoded = temp;
    } catch { break; }
  }
  try { 
    return new URL(decoded).href; 
  } catch { 
    try { return new URL(v).href; } catch { return null; } 
  }
}

/* =========================
   SERVER
========================= */
Deno.serve(async (request) => {
  try {
    const reqUrl = request.url;
    const url = new URL(reqUrl);

    const fakeIp = url.searchParams.get("ip") || url.searchParams.get("IP");
    const targetHref = extractTarget(reqUrl);

    if (!targetHref) {
      return new Response(
        "Использование: ?url=https://example.com/stream&ip=1.2.3.4", 
        { status: 400 }
      );
    }

    const target = new URL(targetHref);
    const host = target.host;

    const headers = new Headers();
    headers.set("Host", host);
    headers.set("User-Agent", "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 2 rev: 250 Safari/533.3");
    headers.set("Accept", "*/*");
    headers.set("Connection", "keep-alive");
    headers.set("Referer", `${target.protocol}//${host}/`);

    if (fakeIp) {
      const ip = fakeIp.trim();
      headers.set("X-Forwarded-For", ip);
      headers.set("X-Real-IP", ip);
      headers.set("Client-IP", ip);
      headers.set("True-Client-IP", ip);
      headers.set("Forwarded", `for=${ip}`);
    }

    const response = await fetch(target.href, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(response.headers);

    const setCookie = responseHeaders.getSetCookie?.() || responseHeaders.get("set-cookie");
    if (setCookie) setCookies(host, setCookie);

    if (response.status >= 400) {
      console.log(`[${new Date().toISOString()}] ${response.status} | ${target.href} | IP: ${fakeIp || 'real'}`);
    }

    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "*");

    const location = responseHeaders.get("location");
    if (location) {
      let absolute = location;
      try { absolute = new URL(location, target.href).href; } catch {}
      const newLoc = `${url.origin}/?url=${encodeURIComponent(absolute)}${fakeIp ? `&ip=${fakeIp}` : ""}`;
      responseHeaders.set("location", newLoc);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (err) {
    console.error(err);
    return new Response("Proxy error: " + err.message, { status: 502 });
  }
});
