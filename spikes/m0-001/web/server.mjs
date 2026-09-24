import { createServer } from "node:http";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Shopify CLI must supply a valid PORT");
}

createServer((request, response) => {
  if (request.method !== "GET" || request.url?.split("?", 1)[0] !== "/") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>Insignia M0-001</title><p>Development Function preview.</p>");
}).listen(port, "127.0.0.1");
