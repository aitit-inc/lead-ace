# 構成イメージ

以下のような構成がおすすめです。

```text
+------------------------+
|   Human User Browser   |
|   Web Frontend (UI)    |
+-----------+------------+
            |
            | HTTPS
            v
+------------------------+
|    Web API Server      |
|  Auth / App Logic /    |
| Jobs / Audit / Rules   |
+-----+-------------+----+
      |             |
      | SQL         | Internal API / Queue / Events
      v             v
+-----------+   +------------------------+
|    DB     |   |  Worker / Job Runner   |
| Postgres  |   | Long tasks / retries   |
+-----------+   +------------------------+


+------------------------+        HTTPS / MCP Transport
| Managed AI Agent       |------------------------------+
| Server-side Agent      |                              |
+------------------------+                              |
                                                        v
+------------------------+                    +------------------------+
| Local AI Agent         |------------------->|      MCP Server        |
| Claude Code, etc.      |   HTTPS / MCP      | Tools / Resources /    |
+------------------------+                    | Prompts / Policy Layer |
                                              +-----------+------------+
                                                          |
                                                          | Internal API
                                                          v
                                              +------------------------+
                                              |    Web API Server      |
                                              |  Shared Backend Entry  |
                                              +-----+-------------+----+
                                                    |             |
                                                    | SQL         | Queue / Events
                                                    v             v
                                              +-----------+   +------------------+
                                              |    DB     |   | Worker / Jobs    |
                                              +-----------+   +------------------+
```

もう少し役割を整理した図にすると、こうです。

```text
                        +----------------------+
                        |   Human User         |
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   Web Frontend       |
                        |   Result Viewer UI   |
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   Web API Server     |
                        |   Core Backend       |
                        +---+--------------+---+
                            |              |
                            v              v
                      +-----------+   +-------------+
                      |    DB     |   | Workers     |
                      +-----------+   +-------------+


   +----------------------+                 +----------------------+
   | Managed AI Agent     |                 | Local AI Agent       |
   | Cloud-hosted Agent   |                 | Claude Code, etc.    |
   +----------+-----------+                 +----------+-----------+
              \                                        /
               \                                      /
                \            MCP Protocol            /
                 +----------------------------------+
                                  |
                                  v
                        +----------------------+
                        |   MCP Server         |
                        |   AI Access Layer    |
                        +----------+-----------+
                                   |
                                   v
                        +----------------------+
                        |   Web API Server     |
                        |   Core Backend       |
                        +---+--------------+---+
                            |              |
                            v              v
                      +-----------+   +-------------+
                      |    DB     |   | Workers     |
                      +-----------+   +-------------+
```

解説です。

まず基本方針として、**Web API Server を唯一の中核バックエンド**にします。
つまり、DB に直接触るのは Web API Server だけに寄せます。MCP Server も AI Agent も、原則として DB に直接つながない方がいいです。

この形にすると責務がきれいに分かれます。

* **Web Frontend**

  * 人間が結果を見るためのUI
  * 必要なら最小限の確認操作や承認操作だけ置く
  * データ取得は Web API Server 経由

* **Web API Server**

  * システムの本体
  * 認証認可
  * 業務ロジック
  * DBアクセス
  * 監査ログ
  * 非同期ジョブ投入
  * 冪等性制御
  * 失敗時のリトライ方針
  * ここが「唯一の正規の backend entry point」になるのが理想です

* **DB**

  * 永続データ保存
  * AIやMCPから直接触らせない

* **Worker / Job Runner**

  * 重い処理
  * 時間のかかる生成
  * 外部API連携
  * 再実行が必要な処理
  * AIが直接全部同期でやるより、ここに逃がす方が安定します

* **MCP Server**

  * AI向けの接続層
  * tools / resources / prompts を公開
  * AIに見せる操作を整理する
  * 内部では Web API Server を呼ぶ
  * つまり **MCP Server は backend 本体ではなく adapter / policy layer**

* **AI Agent**

  * managed な server-side agent
  * ユーザーのローカルPC上の Claude Code など
  * どちらも MCP Server に接続できるようにする

この構成の最大のポイントは、
**MCP Server と Web API Server を分けること**です。

理由はシンプルで、MCP Server は

* AIにどのツールを見せるか
* どの粒度で見せるか
* どの説明文で見せるか
* どの認可スコープで見せるか

を管理する層だからです。

一方、Web API Server は

* 正しい業務処理
* データ整合性
* 監査
* セキュリティ
* 冪等性
* 障害耐性

を担保する層です。

この分離をしておくと、将来かなり楽です。
たとえば、

* Web Frontend は Web API を使う
* Claude Code は MCP を使う
* 自社の managed agent も MCP を使う
* 将来別の AI client を追加しても MCP を再利用できる

という形にできます。

実装上は、**MCP Server が公開する tool は Web API の低レベルCRUDをそのまま出さない**のが大事です。
例えば避けたいのはこうです。

* `create_record`
* `update_record`
* `delete_record`
* `set_field`

これだとAIが細かく操作しすぎて危ないです。

代わりに、こういう**高レベルの intent-based tools**にします。

* `create_invoice_for_customer`
* `generate_monthly_report`
* `start_dataset_import`
* `approve_refund_request`
* `search_user_activity`
* `preview_campaign_change`

この方がAIに使わせやすく、安全です。

さらにおすすめなのは、書き込み系を2段階に分けることです。

* read / inspect
* preview / dry_run
* execute

たとえば、

1. AIが現状を読む
2. AIが変更案を作る
3. preview を返す
4. 必要なら人間が確認する
5. execute する

この流れです。
ユーザーが「結果だけ見たい」世界観でも、内部的にはこの分離を入れておくと事故が減ります。

実運用で特に重要なのは次の設計です。

**1. Web API Server を single source of truth にする**
MCP Server にロジックを書きすぎない方がいいです。
MCP 側は薄くして、実処理は全部 Web API 側へ寄せるのが基本です。

**2. DB direct access を禁止する**
AI Agent → DB の直結は避けるべきです。
権限管理、監査、整合性が崩れやすいです。

**3. Long-running tasks は job 化する**
AIが同期で長い処理を待つより、

* `start_job`
* `get_job_status`
* `get_job_result`

の形にする方が安定します。

**4. Audit log を必ず残す**
少なくとも以下は残したいです。

* who requested
* which agent
* which tool
* input summary
* output summary
* affected resources
* timestamp
* approval status

**5. Idempotency を入れる**
AIは同じ操作を再送することがあります。
作成・更新系APIには idempotency key を入れた方が安全です。

**6. Human approval point を一部だけ残す**
全GUIをなくすとしても、次のような高リスク操作だけは承認UIを残す価値があります。

* delete
* billing change
* permission change
* irreversible publish
* external send

おすすめの通信の考え方を一言で言うとこうです。

* **Human path**
  `Browser -> Web Frontend -> Web API Server -> DB/Workers`

* **AI path**
  `AI Agent -> MCP Server -> Web API Server -> DB/Workers`

つまり、**人間系とAI系で入口は分けるが、業務ロジック本体は共有する**、です。

これがいちばんきれいです。

必要なら次に、あなたのこの構成を前提にして
**「本番向けのより現実的な詳細図」**
たとえば Auth, Queue, Cache, Object Storage, Audit Log, Approval UI まで入れた版を描けます。

# Cloudflare + Supabaseで実現
はい、**十分実現可能**です。
しかもこの組み合わせはかなり相性がいいです。

おすすめはこうです。

```text
+------------------------+
| Human User Browser     |
+-----------+------------+
            |
            v
+------------------------+
| Cloudflare Frontend    |
| Pages / Static Assets  |
+-----------+------------+
            |
            v
+------------------------+
| Cloudflare Workers     |
| Web API Server         |
| Auth / App Logic       |
| Audit / Orchestration  |
+-----+-------------+----+
      |             |
      | HTTP        | Queue
      v             v
+-----------+   +------------------------+
| Supabase  |   | Cloudflare Queues      |
| Postgres  |   | Async Jobs             |
| Auth      |   +-----------+------------+
| Storage   |               |
+-----+-----+               v
      |             +------------------------+
      |             | Cloudflare Worker      |
      |             | Job Consumer           |
      |             +-----------+------------+
      |                         |
      +-------------------------+
                HTTP or Postgres


+------------------------+      MCP over HTTP
| Managed AI Agent       |---------------------------+
+------------------------+                           |
                                                     v
+------------------------+      MCP over HTTP   +------------------------+
| Local AI Agent         |--------------------->| Cloudflare Workers     |
| Claude Code, etc.      |                      | MCP Server             |
+------------------------+                      | Tools / Resources      |
                                                | Prompts / Policy       |
                                                +-----------+------------+
                                                            |
                                                            | Internal HTTP
                                                            v
                                                +------------------------+
                                                | Cloudflare Workers     |
                                                | Web API Server         |
                                                +-----------+------------+
                                                            |
                                                            v
                                                +------------------------+
                                                | Supabase               |
                                                | Postgres / Auth /      |
                                                | Storage / Realtime     |
                                                +------------------------+
```

この構成の要点だけ整理します。

### 1. かなり自然に組める

Cloudflare Workers は、API、フロント寄りのサーバー処理、バックグラウンド処理、WebSockets などをまとめて扱える実行基盤です。Cloudflare Pages/Workers でフロントと API を持ち、Queues や Cron Triggers で非同期処理も組めます。 ([Cloudflare Docs][1])

一方で Supabase は Postgres を中核に、Auth、Storage、Realtime まで揃っているので、**データ基盤を Supabase、実行基盤を Cloudflare** に分ける構成は素直です。 ([Supabase][2])

### 2. MCP サーバーも Cloudflare 側で十分置ける

MCP のリモート接続は Streamable HTTP ベースで、HTTP POST/GET と必要に応じて SSE を使う形です。Cloudflare Workers は通常の HTTP 処理に加えて WebSocket やストリーミング系も扱えるので、**MCP サーバーを Workers で作る構成はかなり現実的**です。 ([Model Context Protocol][3])

### 3. ただし DB 接続方式は少し注意

Supabase は接続プーラを含んでいて、**serverless / edge functions 向けには transaction mode の pooler 接続が向く**と案内しています。Cloudflare 側から Postgres Wire Protocol で直接つなぐなら、この pooler を使う設計がまず候補です。 ([Supabase][4])

さらに Cloudflare には Hyperdrive があり、PostgreSQL 系 DB への接続を高速化し、接続プールも持ちます。Workers から Supabase Postgres に直接つなぐなら、**Hyperdrive を挟く案も有力**です。 ([Cloudflare Docs][5])

### 4. ただし最初は「HTTP 経由」を多めにした方が楽

実装のしやすさだけで言うと、最初は Workers から Supabase に対して

* Supabase Auth
* Supabase Storage
* 必要なら PostgREST / RPC / Edge Functions

などの **HTTP ベースの境界**を多めに使う方が、接続管理が単純です。Supabase には Edge Functions や各種 API があり、サーバーサイド統合の前提が整っています。 ([Supabase][2])

### 5. いちばんおすすめの責務分離

この組み合わせなら、役割はこう切るのがきれいです。

* **Cloudflare Frontend**

  * 人間が結果を見る UI
* **Cloudflare Workers Web API**

  * 業務ロジック
  * AI 実行の入口
  * 監査ログ
  * 承認フロー
* **Cloudflare Workers MCP Server**

  * AI 向けの tools / resources / prompts の公開
* **Cloudflare Queues**

  * 重い処理、再試行、非同期ジョブ
* **Supabase**

  * Postgres
  * Auth
  * Storage
  * 必要なら Realtime

このとき、**MCP Server から DB に直接行かず、必ず Web API Server を経由**させるのがよいです。
MCP はあくまで AI 向け adapter / policy layer、Web API が本体、という切り分けです。

### 6. 実務上のおすすめ接続パターン

かなり実務寄りに言うと、最初は次の順が堅いです。

**A. まず最小構成**

* Frontend: Cloudflare Pages
* Web API: Cloudflare Workers
* MCP: Cloudflare Workers
* Data: Supabase
* Async: Cloudflare Queues

**B. DB 接続は最初これ**

* 基本は Supabase の HTTP API / Auth / Storage を使う
* DB 直SQLが必要な一部だけ pooler 経由
* 直結が増えてきたら Hyperdrive を検討

### 7. 向いている理由

この構成が向いているのは、

* フロント配信と API を Cloudflare で近接運用しやすい
* MCP を HTTP ベースで出しやすい
* 非同期処理を Queues で逃がせる
* Supabase 側で Auth / Storage / Postgres をまとめやすい

からです。Cloudflare Workers は Node.js 互換も拡充しており、npm エコシステムの利用余地も広いです。 ([Cloudflare Docs][6])

### 8. 注意点

ただし、いくつか割り切りは必要です。

* **大量SQLを常時直叩きする設計**は接続管理に気を使う
  Supabase 側も接続数監視や pooler 利用を強く意識しています。 ([Supabase][7])
* **重い長時間処理は同期で返さない**
  Queues に積んで job 化した方が安定します。Cloudflare Queues は batch / retry / dead-letter 的な設計を取りやすいです。 ([Cloudflare Docs][8])
* **MCP 側には低レベル CRUD を見せない**
  `create_report`, `preview_change`, `start_import_job` のような高レベル tool に寄せるべきです。

### 9. 結論

**「データは Supabase、コンピューティングとフロントは Cloudflare」+「MCP も Cloudflare」** は、2026年時点でも十分に現実的です。
むしろ、

* Cloudflare = execution and edge
* Supabase = data and auth

で綺麗に分離できるので、かなり良い選択です。 ([Cloudflare Docs][1])

おすすめの一言版はこれです。

**Best starting architecture**

* Frontend: Cloudflare Pages
* Web API: Cloudflare Workers
* MCP Server: Cloudflare Workers
* Async Jobs: Cloudflare Queues
* Data/Auth/Storage: Supabase
* DB access: first prefer HTTP APIs, then add pooled Postgres access where needed

必要なら次に、
**この構成を前提にした「本番向け詳細アーキテクチャ図」**
をもう一段具体化して描きます。
たとえば `Auth`, `RLS`, `Storage`, `Queue`, `Audit Log`, `Approval UI`, `Managed Agent`, `Local MCP Client` まで入れた版にできます。

[1]: https://developers.cloudflare.com/workers/?utm_source=chatgpt.com "Overview · Cloudflare Workers docs"
[2]: https://supabase.com/docs?utm_source=chatgpt.com "Supabase Docs"
[3]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports?utm_source=chatgpt.com "Transports - Model Context Protocol"
[4]: https://supabase.com/docs/guides/database/connecting-to-postgres?utm_source=chatgpt.com "Connect to your database | Supabase Docs"
[5]: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/?utm_source=chatgpt.com "Connect to PostgreSQL · Cloudflare Hyperdrive docs"
[6]: https://developers.cloudflare.com/workers/runtime-apis/nodejs/?utm_source=chatgpt.com "Node.js compatibility · Cloudflare Workers docs"
[7]: https://supabase.com/docs/guides/database/connection-management?utm_source=chatgpt.com "Connection management | Supabase Docs"
[8]: https://developers.cloudflare.com/queues/?utm_source=chatgpt.com "Overview · Cloudflare Queues docs"

# 補足！！
- Authは Supabase Authかな。
- エンジニア向けには自分でデプロイできるようにしたい。
  - ただし、無料版の制限として1プロジェクトまで。
  - 複数プロジェクト作れるようにするようなソース改変は禁止（それ以外はいいことにする？どうする？）
- ローカルで試せるのがベスト（docker composeで諸々立ち上げておいて、Claude Codeでローカルシステムにmcp繋いで動かすとか？）
