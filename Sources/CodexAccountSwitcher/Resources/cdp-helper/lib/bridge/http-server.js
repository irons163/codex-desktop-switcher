"use strict";

function writeJSON(response, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function isTrustedBridgeRequest(request, bridgePort) {
  // Reject browser origins and DNS-rebinding hosts before any control action.
  const headers = request.headers || {};
  const localHosts = [`127.0.0.1:${bridgePort}`, `localhost:${bridgePort}`];
  return localHosts.includes(headers.host)
    && headers.origin === undefined
    && (headers["sec-fetch-site"] === undefined || headers["sec-fetch-site"] === "none");
}

module.exports = { isTrustedBridgeRequest, writeJSON };
