<script lang="ts">
  import Logo from '$lib/components/Logo.svelte';
  const lastUpdated = '2026-04-25';
</script>

<svelte:head>
  <title>特定商取引法に基づく表記 · LeadAce</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-6 py-12">
  <a href="/" class="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
    <Logo size={14} class="text-accent" />
    ← LeadAce
  </a>
  <h1 class="mt-4 text-2xl font-semibold text-text">特定商取引法に基づく表記</h1>
  <p class="mt-1 text-xs text-text-muted">最終更新日: {lastUpdated}</p>

  <div class="mt-8 text-sm leading-relaxed text-text-secondary">
    <dl class="grid grid-cols-1 gap-y-4 sm:grid-cols-[12rem_1fr] sm:gap-x-6">
      <dt class="font-medium text-text">販売業者</dt>
      <dd>SurpassOne 株式会社</dd>

      <dt class="font-medium text-text">代表者</dt>
      <dd>宇野 礼於</dd>

      <dt class="font-medium text-text">所在地</dt>
      <dd>〒162-0052 東京都新宿区戸山 3-6-7</dd>

      <dt class="font-medium text-text">電話番号</dt>
      <dd>請求があり次第、遅滞なくお伝えいたします。お問い合わせは下記メールアドレスへお願いいたします。</dd>

      <dt class="font-medium text-text">メールアドレス</dt>
      <dd>
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>
      </dd>

      <dt class="font-medium text-text">販売価格</dt>
      <dd>
        各プランの月額または年額をお申し込み時の画面に表示します（米ドル建て、消費税は課税地の制度に従い別途課税されます）。
        <ul class="mt-2 list-disc pl-5 space-y-1">
          <li>Free: $0（永久無料、利用上限あり）</li>
          <li>Starter: $29 / 月、または $290 / 年（17% 割引）</li>
          <li>Pro: $79 / 月、または $790 / 年</li>
          <li>Scale: $199 / 月、または $1,990 / 年</li>
        </ul>
      </dd>

      <dt class="font-medium text-text">販売価格以外の必要料金</dt>
      <dd>
        本サービスのご利用に必要なインターネット接続料金、PC その他の機器、および Anthropic 社が提供する Claude Code の利用料金は、お客様のご負担となります。
      </dd>

      <dt class="font-medium text-text">支払方法</dt>
      <dd>クレジットカード（Stripe 決済）</dd>

      <dt class="font-medium text-text">支払時期</dt>
      <dd>
        月額プラン: 毎月のお申し込み日（または更新日）に課金されます。<br />
        年額プラン: 毎年のお申し込み日（または更新日）に課金されます。
      </dd>

      <dt class="font-medium text-text">サービスの提供時期</dt>
      <dd>決済完了後、即時にご利用いただけます。</dd>

      <dt class="font-medium text-text">返品・キャンセル</dt>
      <dd>
        本サービスはデジタルサービスの性質上、課金期間途中での返金には応じておりません。
        サブスクリプションのキャンセルは、ご契約者ご自身で
        <a href="https://app.leadace.ai/settings" class="underline">設定画面</a>
        の Manage subscription（Stripe Customer Portal）から行っていただけます。
        キャンセル後も、課金済みの期間が終了するまでは引き続きご利用いただけます。
      </dd>

      <dt class="font-medium text-text">動作環境</dt>
      <dd>
        PC（macOS / Windows / Linux）、最新版の主要 Web ブラウザ、および Anthropic 社が提供する Claude Code が動作する環境。
      </dd>
    </dl>
  </div>
</div>
