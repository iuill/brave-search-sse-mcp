#!/usr/bin/env node

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { config } from "dotenv";

// 環境変数の読み込み
config();

// Server implementation
const server = new McpServer({
  name: "example-servers/brave-search",
  version: "0.1.0",
});

// Expressアプリケーション
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3004;

// セッション管理用オブジェクト
const transports: { [sessionId: string]: SSEServerTransport } = {};

const RATE_LIMIT = {
  perSecond: 1,
  perMonth: 15000,
};

const requestCount = {
  second: 0,
  month: 0,
  lastReset: Date.now(),
};

function checkRateLimit() {
  const now = Date.now();
  if (now - requestCount.lastReset > 1000) {
    requestCount.second = 0;
    requestCount.lastReset = now;
  }
  if (
    requestCount.second >= RATE_LIMIT.perSecond ||
    requestCount.month >= RATE_LIMIT.perMonth
  ) {
    throw new Error("Rate limit exceeded");
  }
  requestCount.second++;
  requestCount.month++;
}

interface BraveWeb {
  web?: {
    results?: Array<{
      title: string;
      description: string;
      url: string;
      language?: string;
      published?: string;
      rank?: number;
    }>;
  };
  locations?: {
    results?: Array<{
      id: string; // Required by API
      title?: string;
    }>;
  };
}

interface BraveLocation {
  id: string;
  name: string;
  address: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
  };
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  phone?: string;
  rating?: {
    ratingValue?: number;
    ratingCount?: number;
  };
  openingHours?: string[];
  priceRange?: string;
}

interface BravePoiResponse {
  results: BraveLocation[];
}

interface BraveDescription {
  descriptions: { [id: string]: string };
}

function isBraveWebSearchArgs(
  args: unknown,
): args is { query: string; count?: number } {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: string }).query === "string"
  );
}

function isBraveLocalSearchArgs(
  args: unknown,
): args is { query: string; count?: number } {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: string }).query === "string"
  );
}

async function performWebSearch(
  query: string,
  count: number = 10,
  offset: number = 0,
) {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", Math.min(count, 20).toString()); // API limit
  url.searchParams.set("offset", offset.toString());

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const data = (await response.json()) as BraveWeb;

  // Extract just web results
  const results = (data.web?.results || []).map((result) => ({
    title: result.title || "",
    description: result.description || "",
    url: result.url || "",
  }));

  return results
    .map(
      (r) => `Title: ${r.title}\nDescription: ${r.description}\nURL: ${r.url}`,
    )
    .join("\n\n");
}

async function performLocalSearch(query: string, count: number = 5) {
  checkRateLimit();
  // Initial search to get location IDs
  const webUrl = new URL("https://api.search.brave.com/res/v1/web/search");
  webUrl.searchParams.set("q", query);
  webUrl.searchParams.set("search_lang", "en");
  webUrl.searchParams.set("result_filter", "locations");
  webUrl.searchParams.set("count", Math.min(count, 20).toString());

  const webResponse = await fetch(webUrl, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!webResponse.ok) {
    throw new Error(
      `Brave API error: ${webResponse.status} ${webResponse.statusText}\n${await webResponse.text()}`,
    );
  }

  const webData = (await webResponse.json()) as BraveWeb;
  const locationIds =
    webData.locations?.results
      ?.filter((r): r is { id: string; title?: string } => r.id != null)
      .map((r) => r.id) || [];

  if (locationIds.length === 0) {
    return performWebSearch(query, count); // Fallback to web search
  }

  // Get POI details and descriptions in parallel
  const [poisData, descriptionsData] = await Promise.all([
    getPoisData(locationIds),
    getDescriptionsData(locationIds),
  ]);

  return formatLocalResults(poisData, descriptionsData);
}

async function getPoisData(ids: string[]): Promise<BravePoiResponse> {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/local/pois");
  ids.filter(Boolean).forEach((id) => url.searchParams.append("ids", id));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const poisResponse = (await response.json()) as BravePoiResponse;
  return poisResponse;
}

async function getDescriptionsData(ids: string[]): Promise<BraveDescription> {
  checkRateLimit();
  const url = new URL("https://api.search.brave.com/res/v1/local/descriptions");
  ids.filter(Boolean).forEach((id) => url.searchParams.append("ids", id));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Brave API error: ${response.status} ${response.statusText}\n${await response.text()}`,
    );
  }

  const descriptionsData = (await response.json()) as BraveDescription;
  return descriptionsData;
}

function formatLocalResults(
  poisData: BravePoiResponse,
  descData: BraveDescription,
): string {
  return (
    (poisData.results || [])
      .map((poi) => {
        const address =
          [
            poi.address?.streetAddress ?? "",
            poi.address?.addressLocality ?? "",
            poi.address?.addressRegion ?? "",
            poi.address?.postalCode ?? "",
          ]
            .filter((part) => part !== "")
            .join(", ") || "N/A";

        return `Name: ${poi.name}
Address: ${address}
Phone: ${poi.phone || "N/A"}
Rating: ${poi.rating?.ratingValue ?? "N/A"} (${poi.rating?.ratingCount ?? 0} reviews)
Price Range: ${poi.priceRange || "N/A"}
Hours: ${(poi.openingHours || []).join(", ") || "N/A"}
Description: ${descData.descriptions[poi.id] || "No description available"}
`;
      })
      .join("\n---\n") || "No local results found"
  );
}

// SSEエンドポイント
app.get("/sse", async (req: Request, res: Response) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    console.log(`SSE接続確立: sessionId=${transport.sessionId}`);

    res.on("close", () => {
      console.log(`SSE接続終了: sessionId=${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    await server.connect(transport);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("SSE接続確立エラー:", message);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    // レスポンスがまだ送信されていない場合のみエラーレスポンスを送信
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: { message: "Failed to establish SSE connection" },
      });
    }
  }
});

// メッセージ受信エンドポイント
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    try {
      await transport.handlePostMessage(req, res);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("メッセージ処理エラー:", message);
      if (error instanceof Error && error.stack) {
        console.error("Stack trace:", error.stack);
      }
      // レスポンスがまだ送信されていない場合のみエラーレスポンスを送信
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: { message: "Error processing message" },
        });
      }
    }
  } else {
    res.status(400).json({
      success: false,
      error: { message: "No transport found for sessionId" },
    });
  }
});

// ツールの登録
// Web検索ツール
server.tool(
  "brave_web_search",
  "Performs a web search using the Brave Search API, ideal for general queries, news, articles, and online content. " +
    "Use this for broad information gathering, recent events, or when you need diverse web sources. " +
    "Supports pagination, content filtering, and freshness controls. " +
    "Maximum 20 results per request, with offset for pagination. ",
  {
    query: z.string().describe("Search query (max 400 chars, 50 words)"),
    count: z
      .number()
      .default(10)
      .describe("Number of results (1-20, default 10)"),
    offset: z
      .number()
      .default(0)
      .describe("Pagination offset (max 9, default 0)"),
  },
  async ({ query, count = 10, offset = 0 }) => {
    try {
      const results = await performWebSearch(query, count, offset);
      return {
        content: [{ type: "text", text: results }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ローカル検索ツール
server.tool(
  "brave_local_search",
  "Searches for local businesses and places using Brave's Local Search API. " +
    "Best for queries related to physical locations, businesses, restaurants, services, etc. " +
    "Returns detailed information including:\n" +
    "- Business names and addresses\n" +
    "- Ratings and review counts\n" +
    "- Phone numbers and opening hours\n" +
    "Use this when the query implies 'near me' or mentions specific locations. " +
    "Automatically falls back to web search if no local results are found.",
  {
    query: z
      .string()
      .describe("Local search query (e.g. 'pizza near Central Park')"),
    count: z
      .number()
      .default(5)
      .describe("Number of results (1-20, default 5)"),
  },
  async ({ query, count = 5 }) => {
    try {
      const results = await performLocalSearch(query, count);
      return {
        content: [{ type: "text", text: results }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// サーバー初期化と起動
async function initializeServer() {
  try {
    // Check for API key
    if (!process.env.BRAVE_API_KEY) {
      console.error("Error: BRAVE_API_KEY environment variable is required");
      process.exit(1);
    }

    // サーバー起動
    app.listen(port, () => {
      console.log(
        `Brave Search MCP Server running at http://localhost:${port}`,
      );
      console.log("Use this URL in your MCP client configuration");
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("サーバー初期化中に致命的なエラーが発生しました:", message);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// サーバー初期化と起動
initializeServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("サーバー起動プロセスで予期せぬエラー:", message);
  if (error instanceof Error && error.stack) {
    console.error("Stack trace:", error.stack);
  }
  process.exit(1);
});
