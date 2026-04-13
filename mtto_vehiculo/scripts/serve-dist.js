// @ts-nocheck
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 8080);
const root = path.resolve(__dirname, "..", "dist");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

const safeJoin = (base, target) => {
  const targetPath = path.resolve(base, `.${target}`);
  return targetPath.startsWith(base) ? targetPath : null;
};

const serveFile = (filePath, response) => {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
      return;
    }

    response.writeHead(200, { "Content-Type": contentType });
    response.end(data);
  });
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const candidatePath = safeJoin(root, decodeURIComponent(pathname));

  if (!candidatePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(candidatePath, (error, stats) => {
    if (!error && stats.isFile()) {
      serveFile(candidatePath, response);
      return;
    }

    serveFile(path.join(root, "index.html"), response);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving ${root} on http://localhost:${port}/`);
});
