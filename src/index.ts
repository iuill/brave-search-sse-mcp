#!/usr/bin/env node

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { config } from "dotenv";
import { performWebSearch, performLocalSearch } from "./braveApi.js";

// 環境変数の読み込み
config();

// Expressアプリケーション
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3004;

// セッション管理用オブジェクト
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get("/sse", async (req: Request, res: Response) => {
  try {
    const transport = new SSEServerTransport("/messages", res);
    transports[transport.sessionId] = transport;

    console.log(`SSE接続確立: sessionId=${transport.sessionId}`);

    res.on("close", () => {
      console.log(`SSE接続終了: sessionId=${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    // Server implementation
    const server = new McpServer({
      name: "example-servers/brave-search",
      version: "0.1.0",
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
