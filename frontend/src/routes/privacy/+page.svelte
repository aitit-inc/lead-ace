<script lang="ts">
  const lastUpdated = '2026-04-17';
</script>

<svelte:head>
  <title>Privacy Policy · Lead Ace</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-6 py-12">
  <a href="/" class="text-xs text-text-muted hover:text-text">← Lead Ace</a>
  <h1 class="mt-4 text-2xl font-semibold text-text">Privacy Policy</h1>
  <p class="mt-1 text-xs text-text-muted">Last updated: {lastUpdated}</p>

  <div class="mt-8 space-y-6 text-sm leading-relaxed text-text-secondary">
    <p>
      This Privacy Policy explains how SurpassOne Inc. ("<strong>we</strong>") handles personal
      data when you use Lead Ace.
    </p>

    <section>
      <h2 class="text-base font-semibold text-text">1. Information we collect</h2>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>
          <strong>Account data:</strong> email address, hashed password (managed by Supabase Auth),
          and timestamps of sign-in/sign-out events.
        </li>
        <li>
          <strong>Subscription and billing data:</strong> plan tier, billing period, Stripe
          customer and subscription identifiers. Card details are handled by Stripe and never
          touch our servers.
        </li>
        <li>
          <strong>Application data:</strong> projects, prospects, organisations, outreach logs,
          response records, evaluations, and documents you create or upload through the service.
        </li>
        <li>
          <strong>Operational logs:</strong> request logs, error reports, and quota counters used
          for debugging, abuse prevention, and rate limiting.
        </li>
      </ul>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">2. How we use it</h2>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>Provide and operate the service, including authentication and quota enforcement.</li>
        <li>Process payments and prevent fraud (via Stripe).</li>
        <li>Send transactional email (account confirmation, password reset, billing receipts).</li>
        <li>Investigate and respond to security or abuse incidents.</li>
        <li>Improve reliability and performance using aggregated, non-identifying telemetry.</li>
      </ul>
      <p class="mt-2">
        We do not sell your data. We do not use your application data to train third-party AI
        models.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">3. Sub-processors</h2>
      <p class="mt-2">We rely on the following providers to operate the service:</p>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li><strong>Supabase</strong> — authentication and PostgreSQL database hosting.</li>
        <li><strong>Cloudflare</strong> — application hosting, DNS, and CDN (Workers, Pages, KV).</li>
        <li><strong>Stripe</strong> — payment processing and subscription billing.</li>
        <li><strong>Anthropic</strong> — when the Claude Code plugin invokes Claude on your behalf, the inputs you provide are processed by Anthropic under their terms.</li>
      </ul>
      <p class="mt-2">
        Each sub-processor is contractually required to handle data securely and only as instructed.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">4. Data retention</h2>
      <p class="mt-2">
        We retain account and application data for as long as your account is active. After
        account deletion, we delete or de-identify your data within 30 days, except where retention
        is required by law (e.g. tax or accounting records).
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">5. Your rights</h2>
      <p class="mt-2">
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete
        your personal data, and to object to or restrict certain processing. You can exercise most
        of these rights directly in the product (e.g. by deleting projects or your account from
        the Settings page); for anything you cannot do in-product, contact
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">6. Cookies and local storage</h2>
      <p class="mt-2">
        We use first-party cookies and local storage strictly for authentication and to remember
        UI preferences (e.g. the active project). We do not use third-party advertising or tracking
        cookies.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">7. Security</h2>
      <p class="mt-2">
        We rely on industry-standard transport encryption (TLS), database-level row-level security
        for tenant isolation, and OAuth/JWT-based authentication. No system is perfectly secure;
        please report suspected vulnerabilities to
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">8. International transfers</h2>
      <p class="mt-2">
        Our infrastructure is hosted in the Asia-Pacific region. Where data is transferred across
        borders, we rely on the safeguards offered by our sub-processors. [Legal review needed for
        GDPR/SCC, UK IDTA, or APPI cross-border requirements as the customer base expands.]
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">9. Changes</h2>
      <p class="mt-2">
        We will post material changes to this policy at this URL and notify you by email or
        in-product banner before they take effect.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">10. Contact</h2>
      <p class="mt-2">
        SurpassOne Inc.<br />
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>
      </p>
    </section>
  </div>
</div>
