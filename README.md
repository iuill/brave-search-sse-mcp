# brave-search-mcp

Brave Search API を利用するための MCP（Model Context Protocol）サーバーです。MCPクライアント（Roo Codeなど）から Brave Search の Web 検索およびローカル検索機能を利用できます。

## 前提条件

- Docker および Docker Compose (通常 Docker Desktop に同梱) がインストールされていること。
- Brave Search API キーを取得していること。
  - [Brave Search API](https://brave.com/search/api/) から API キーを取得してください。
- (シェルスクリプトを使用する場合のみ) `mcp-network` という名前の Docker ネットワークが存在すること。
  ```bash
  # シェルスクリプト使用時に存在しない場合、以下のコマンドで作成
  docker network create mcp-network
  ```
  (Docker Compose を使用する場合、ネットワークは自動的に作成されます)

## セットアップ方法の選択

このプロジェクトのセットアップと管理には、以下のいずれかの方法を使用できます。

- **Docker Compose (推奨):** `docker-compose.yml` ファイルを使用して、ビルド、起動、停止などを管理します。設定がシンプルで一般的です。
- **シェルスクリプト:** `scripts/brave-search-mcp.sh` を使用して、同様の操作を行います。

以下にそれぞれの方法を説明します。

## セットアップ (共通)

1. **リポジトリの準備:**
   このリポジトリをクローンまたはダウンロードします。

2. **環境変数の設定:**
   `.env` ファイルをプロジェクトのルートディレクトリに作成し、以下の内容を設定します。

   ```
   BRAVE_API_KEY=your_api_key_here
   PORT=3005
   ```

   **重要:** `.env` は機密情報です。**絶対に Git リポジトリにコミットしないでください。** (`.gitignore` に含まれています)

## セットアップ (Docker Compose)

1. **環境変数の設定:** [セットアップ (共通)](#セットアップ-共通) を参照してください。`.env` ファイルに `PORT` や `RESTART_POLICY` を追加で設定することもできます（任意）。
   ```dotenv
   # .env (例)
   BRAVE_API_KEY=your_api_key_here
   PORT=3005
   RESTART_POLICY=unless-stopped
   ```

2. **Docker イメージのビルド (任意):**
   `docker compose up` コマンドは通常、必要に応じてイメージを自動でビルドしますが、明示的にビルドすることも可能です。
   ```bash
   docker compose build
   ```

## セットアップ (シェルスクリプト)

1. **環境変数の設定:** [セットアップ (共通)](#セットアップ-共通) を参照してください。
2. **Docker ネットワークの確認/作成:** [前提条件](#前提条件) を参照し、必要であれば `mcp-network` を作成してください。
3. **Docker イメージのビルド:**
   プロジェクトの管理には `scripts/brave-search-mcp.sh` スクリプトを使用します。コマンドを簡略化するために、[便利な使い方 (エイリアス)](#便利な使い方-エイリアス) セクションを参照してエイリアス (`brave_search_mcp` など) を設定することを推奨します。
   以下のコマンドで Docker イメージをビルドします (エイリアス設定後):
   ```bash
   brave_search_mcp build
   ```

## 起動方法 (Docker Compose)

以下のコマンドでサーバーを起動します。`.env` ファイルで設定されたポートと再起動ポリシーが使用されます。

```bash
# ビルドが必要な場合は自動で行い、バックグラウンドで起動
docker compose up -d --build

# イメージが最新の場合は、バックグラウンドで起動
docker compose up -d
```

## 起動方法 (シェルスクリプト)

以下のコマンドでサーバーを起動できます (エイリアス設定後)。

```bash
# デフォルト設定で起動
brave_search_mcp start

# ポート 8080、再起動ポリシー always で起動
brave_search_mcp start -P 8080 -r always
```

サーバーはバックグラウンドで起動します。

## 基本的な使い方 (Docker Compose)

```bash
# サーバー (コンテナ) の停止と削除
docker compose down

# サーバーのログを表示 (Ctrl+C で終了)
docker compose logs -f brave-search-mcp

# コンテナを停止・削除し、イメージも削除
docker compose down --rmi all

# 実行中のコンテナの確認
docker compose ps
```

## 基本的な使い方 (シェルスクリプト - エイリアス使用)

```bash
# サーバー (コンテナ) の停止・削除
brave_search_mcp stop

# サーバーのログを表示 (Ctrl+C で終了)
brave_search_mcp logs

# コンテナを停止・削除し、イメージも削除 (確認あり)
brave_search_mcp delete

# ヘルプを表示
brave_search_mcp help
```

## MCPクライアントからの接続 (Roo Code 例)

ホストマシンから接続する場合、Roo Code の MCP 設定 (MCP Servers -> MCP設定を編集) に以下のように追記します (`PORT` はサーバーの起動ポート):

```json
{
  "mcpServers": {
    "brave-search-mcp-server": {
      "url": "http://localhost:${PORT}/sse"
    }
  }
}
```

デフォルトポート (3005) の場合は `http://localhost:3005/sse` となります。

### 開発コンテナからの接続 (ホスト経由)

開発コンテナなど、この MCP サーバーと同じ Docker ネットワーク (`mcp-network`) に参加していないコンテナから接続する必要がある場合は、ホストマシン経由で接続します。

接続先 URL は `http://<host_ip_or_dns_name>:<PORT>/sse` となります。

- **Docker Desktop (Mac/Windows):** 特別な DNS 名 `host.docker.internal` を使用します。
  - 例: `http://host.docker.internal:3005/sse`
- **Linux:** ホストマシンの IP アドレスや Docker ブリッジネットワークのゲートウェイ IP (通常 `172.17.0.1`) を使用します。
  - 例: `http://172.17.0.1:3005/sse`

Roo Code の MCP 設定例 (Docker Desktop):

```json
{
  "mcpServers": {
    "brave-search-mcp-server": {
      "url": "http://host.docker.internal:3005/sse"
    }
  }
}
```

_注意: `<PORT>` は実際にサーバーがホスト上で公開しているポート番号に置き換えてください。Linux の IP アドレスは環境によって異なります。ホストのファイアウォール設定も確認してください。_

## 便利な使い方 (シェルスクリプト用エイリアス)

毎回 `./scripts/brave-search-mcp.sh` と入力する代わりに、シェルの設定ファイル (`~/.bashrc`, `~/.zshrc` など) にエイリアスを定義すると便利です。

```bash
# 例: brave_search_mcp というエイリアスを作成
alias brave_search_mcp="/path/to/your/project/brave-search-mcp/scripts/brave-search-mcp.sh" # <- 実際のパスに変更
```

設定ファイルを再読み込み (`source ~/.bashrc` など) すると、`brave_search_mcp build` のように短いコマンドでスクリプトを実行できます。

## 利用可能なツール

このサーバーは以下の2つのツールを提供します：

1. **brave_web_search** - Web検索を実行します

   - パラメータ:
     - `query`: 検索クエリ (最大400文字、50単語)
     - `count`: 結果数 (1-20、デフォルト10)
     - `offset`: ページネーションオフセット (最大9、デフォルト0)

2. **brave_local_search** - ローカルビジネスや場所を検索します
   - パラメータ:
     - `query`: ローカル検索クエリ (例: 'pizza near Central Park')
     - `count`: 結果数 (1-20、デフォルト5)

## TIPS / その他の情報

- **API 制限:** Brave Search API には以下の制限があります:
  - 1秒あたり1リクエスト
  - 月間15,000リクエスト
- **Docker 直接操作:** `docker build`, `docker run` コマンドを直接使用することも可能です。詳細は `scripts/brave-search-mcp.sh` の内容や Docker のドキュメントを参照してください。
- **コンテナ間接続:** 同じ `mcp-network` に参加している他のコンテナからは `http://brave-search-mcp-server:${PORT}/sse` で接続できます。
- **通信プロトコル:** このサーバーは SSE (Server-Sent Events) を使用します。
- **環境変数:** ポート番号などは環境変数 (`PORT`) でも設定可能です。
