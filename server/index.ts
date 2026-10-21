import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

try {
  process.loadEnvFile?.(".env");
} catch {
  // .env is optional
}

const app = createApp({ clientId: process.env.AZURE_CLIENT_ID, tenantId: process.env.AZURE_TENANT_ID });

const LOGIN = "https://login.microsoftonline.com";
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      `connect-src 'self' ${LOGIN}`,
      `frame-src 'self' ${LOGIN}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  next();
});

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webRoot, "index.html")));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  if (!process.env.AZURE_CLIENT_ID) console.warn("AZURE_CLIENT_ID is not set; sign-in will not work.");
  console.log(`Key Vault Manager listening on http://localhost:${port}`);
});
