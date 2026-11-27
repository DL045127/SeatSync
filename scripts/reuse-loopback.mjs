// Preloaded only in the SC-14 child server. Reject non-fixture HTTPS requests.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

https.request = (url, options, callback) => {
  if (!(url instanceof URL) || url.origin !== "https://api.geoapify.com" ||
      url.pathname !== "/v1/geocode/autocomplete" || url.searchParams.get("apiKey") !== "reuse-probe") {
    throw new Error("Unexpected HTTPS request during offline autocomplete probe.");
  }
  const port = Number(process.env.REUSE_PROBE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid loopback provider port.");
  return http.request(new URL(url.pathname + url.search, `http://127.0.0.1:${port}`), options, callback);
};
syncBuiltinESMExports();
