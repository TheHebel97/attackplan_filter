const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";
const ROOT = __dirname;
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/favicon.ico", null],
]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
const ALLOWED_WORLD_FILE_NAMES = new Set(["player.txt", "village.txt"]);

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method !== "GET") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    if (requestUrl.pathname === "/api/servers") {
      const data = await proxyText("https://www.die-staemme.de/backend/get_servers.php");
      sendText(res, 200, data, CONTENT_TYPES[".txt"]);
      return;
    }

    const worldMatch = requestUrl.pathname.match(/^\/api\/world\/([a-z0-9]+)\/(player\.txt|village\.txt)$/i);
    if (worldMatch) {
      const serverCode = worldMatch[1].toLowerCase();
      const fileName = worldMatch[2].toLowerCase();
      if (!ALLOWED_WORLD_FILE_NAMES.has(fileName)) {
        sendText(res, 400, "Unsupported file");
        return;
      }

      const remoteUrl = `https://${serverCode}.die-staemme.de/map/${fileName}`;
      const data = await proxyText(remoteUrl);
      sendText(res, 200, data, CONTENT_TYPES[".txt"]);
      return;
    }

    if (STATIC_FILES.has(requestUrl.pathname)) {
      const target = STATIC_FILES.get(requestUrl.pathname);
      if (!target) {
        sendText(res, 204, "");
        return;
      }
      serveFile(res, path.join(ROOT, target));
      return;
    }

    sendText(res, 404, "Not Found");
  } catch (error) {
    sendJson(res, 502, { error: error.message || "Proxy request failed" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Attackplan Filter läuft auf http://${HOST}:${PORT}`);
});

function proxyText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Remote HTTP ${response.statusCode} fuer ${url}`));
        return;
      }

      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not Found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  });
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": CONTENT_TYPES[".json"] });
  res.end(JSON.stringify(payload));
}
