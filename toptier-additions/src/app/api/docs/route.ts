/**
 * GET /api/docs — Swagger UI
 * GET /api/docs/openapi.json — OpenAPI spec
 *
 * Drop into: src/app/api/docs/route.ts
 */

import { NextRequest, NextResponse } from "next/server";

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "TOPTIER Trading Signals API",
    version: "1.0.0",
    description: "Real-time trading signals, market analysis, AI-powered insights, paper trading, and backtesting.",
  },
  servers: [{ url: "/api", description: "Local" }],
  paths: {
    "/news": {
      get: {
        summary: "Get real-time news",
        tags: ["News"],
        parameters: [
          { name: "category", in: "query", schema: { type: "string", enum: ["forex", "stocks", "crypto", "commodities", "economy", "general"] } },
        ],
        responses: { 200: { description: "News articles", content: { "application/json": {} } } },
      },
    },
    "/calendar": {
      get: {
        summary: "Get economic calendar events",
        tags: ["Calendar"],
        parameters: [
          { name: "startDate", in: "query", schema: { type: "string", format: "date" } },
          { name: "endDate", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { 200: { description: "Calendar events" } },
      },
    },
    "/signals-generate": {
      get: {
        summary: "Generate AI signal for a symbol",
        tags: ["AI Signals"],
        parameters: [
          { name: "symbol", in: "query", required: true, schema: { type: "string" }, description: "e.g. EURUSD" },
          { name: "symbols", in: "query", schema: { type: "string" }, description: "Comma-separated for batch mode" },
          { name: "timeframe", in: "query", schema: { type: "string", default: "1H" } },
        ],
        responses: { 200: { description: "Generated signal" } },
      },
    },
    "/screenshot-analyze": {
      post: {
        summary: "Analyze a trading chart screenshot with AI Vision",
        tags: ["AI Vision"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { image: { type: "string", description: "Base64-encoded image" }, mimeType: { type: "string" } } } } },
        },
        responses: { 200: { description: "Analysis result" } },
      },
    },
    "/push/subscribe": {
      post: {
        summary: "Subscribe to push notifications",
        tags: ["Push"],
        requestBody: { required: true, content: { "application/json": {} } },
        responses: { 200: { description: "Subscription saved" } },
      },
    },
    "/push/unsubscribe": {
      post: {
        summary: "Unsubscribe from push notifications",
        tags: ["Push"],
        responses: { 200: { description: "Subscription removed" } },
      },
    },
    "/push/test": {
      post: {
        summary: "Send test push notification",
        tags: ["Push"],
        responses: { 200: { description: "Test notification sent" } },
      },
    },
    "/paper-trade": {
      get: { summary: "Get paper trading account", tags: ["Paper Trading"], responses: { 200: {} } },
      post: {
        summary: "Open / close / reset paper trade",
        tags: ["Paper Trading"],
        requestBody: { content: { "application/json": {} } },
        responses: { 200: {} },
      },
    },
    "/backtest": {
      post: {
        summary: "Run a backtest",
        tags: ["Backtesting"],
        requestBody: { content: { "application/json": {} } },
        responses: { 200: { description: "Backtest result" } },
      },
    },
    "/signals": {
      get: { summary: "List signals (existing)", tags: ["Signals"], responses: { 200: {} } },
    },
    "/performance": {
      get: { summary: "Get performance stats (existing)", tags: ["Performance"], responses: { 200: {} } },
    },
    "/auth/login": {
      post: { summary: "Login", tags: ["Auth"], responses: { 200: {} } },
    },
    "/auth/register": {
      post: { summary: "Register", tags: ["Auth"], responses: { 200: {} } },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
  security: [{ bearerAuth: [] }],
};

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TOPTIER API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("format") === "json") {
    return NextResponse.json(OPENAPI_SPEC);
  }
  return new NextResponse(SWAGGER_HTML, {
    headers: { "Content-Type": "text/html" },
  });
}
