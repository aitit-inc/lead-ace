<script lang="ts">
  import Logo from '$lib/components/Logo.svelte';
  const lastUpdated = '2026-04-26';
</script>

<svelte:head>
  <title>Privacy Policy · LeadAce</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-6 py-12">
  <a href="/" class="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
    <Logo size={14} class="text-accent" />
    ← LeadAce
  </a>
  <h1 class="mt-4 text-2xl font-semibold text-text">Privacy Policy</h1>
  <p class="mt-1 text-xs text-text-muted">Last updated: {lastUpdated}</p>

  <div class="mt-8 space-y-6 text-sm leading-relaxed text-text-secondary">
    <p>
      This Privacy Policy explains how SurpassOne Inc. ("<strong>we</strong>") handles personal
      data when you use LeadAce.
    </p>

    <section>
      <h2 class="text-base font-semibold text-text">1. Information we collect</h2>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>
          <strong>Account data:</strong> email address and profile information returned by Google
          Sign-In (managed by Supabase Auth), plus timestamps of sign-in/sign-out events.
        </li>
        <li>
          <strong>Google OAuth credentials:</strong> a Gmail
          <code class="font-mono text-xs">gmail.send</code> refresh token, encrypted at rest with
          pgcrypto and stored only to send outbound email on your behalf when you trigger an
          outreach action. We do not request, store, or read inbox contents — reply checking is
          performed locally through claude.ai's Gmail MCP.
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
        <li>Send transactional email (billing receipts and service notifications).</li>
        <li>Investigate and respond to security or abuse incidents.</li>
        <li>Improve reliability and performance using aggregated, non-identifying telemetry.</li>
      </ul>
      <p class="mt-2">
        We do not sell your data. We do not use your application data to train third-party AI
        models.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">3. Use of Google user data</h2>
      <p class="mt-2">
        LeadAce's use and transfer of information received from Google APIs to any other app will
        adhere to the
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
          class="underline">Google API Services User Data Policy</a
        >, including the
        <strong>Limited Use</strong> requirements.
      </p>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>
          <strong>Scopes requested:</strong>
          <code class="font-mono text-xs">openid</code>, <code class="font-mono text-xs">profile</code>,
          <code class="font-mono text-xs">email</code>, and
          <code class="font-mono text-xs">https://www.googleapis.com/auth/gmail.send</code>.
        </li>
        <li>
          <strong>How we use Gmail data:</strong> the
          <code class="font-mono text-xs">gmail.send</code> scope is used solely to send outbound
          email composed by you (or by the LeadAce skill on your behalf, at your direction) from
          your connected Gmail address.
        </li>
        <li>
          <strong>What we never do:</strong> we do not read your inbox, list messages, modify
          labels, create drafts, or delete email; we do not transfer Google user data to third
          parties for advertising or any unrelated purpose; we do not use Google user data to train
          AI/ML models; we do not allow humans to read Google user data except (i) with your
          explicit consent, (ii) for narrowly-scoped security investigations, or (iii) where
          required by law.
        </li>
        <li>
          <strong>Revocation:</strong> you can disconnect Gmail at any time from
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" class="underline"
            >Google Account → Third-party apps</a
          >; the encrypted refresh token in our database is then unusable and will be deleted on
          your next account interaction or after 30 days, whichever comes first.
        </li>
      </ul>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">4. Sub-processors</h2>
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
      <h2 class="text-base font-semibold text-text">5. Data retention</h2>
      <p class="mt-2">
        We retain account and application data for as long as your account is active. After
        account deletion, we delete or de-identify your data within 30 days, except where retention
        is required by law (e.g. tax or accounting records).
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">6. Your rights</h2>
      <p class="mt-2">
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete
        your personal data, and to object to or restrict certain processing. You can exercise most
        of these rights directly in the product (e.g. by deleting projects or your account from
        the Settings page); for anything you cannot do in-product, contact
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>.
      </p>
    </section>

    <section id="cookies">
      <h2 class="text-base font-semibold text-text">7. Cookies and local storage</h2>
      <p class="mt-2">
        We use only first-party browser storage that is strictly necessary to operate the service,
        plus storage to remember preferences you have set yourself. We do not use analytics,
        advertising, or cross-site tracking technologies.
      </p>

      <h3 class="mt-4 text-sm font-semibold text-text">Strictly necessary</h3>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>
          <strong>Authentication tokens</strong> (stored in local storage by Supabase Auth, key
          <code class="font-mono text-xs">sb-*-auth-token</code>). Required to keep you signed in.
        </li>
      </ul>

      <h3 class="mt-4 text-sm font-semibold text-text">Preferences (set by you)</h3>
      <ul class="mt-2 list-disc pl-5 space-y-1">
        <li>
          <code class="font-mono text-xs">leadace.theme</code> — your light/dark mode choice.
        </li>
        <li>
          <code class="font-mono text-xs">leadace_active_project</code> — the project currently
          selected in the sidebar.
        </li>
        <li>
          <code class="font-mono text-xs">leadace.cookie_consent</code> — records that you have
          seen this notice, so we don't show it again.
        </li>
      </ul>

      <h3 class="mt-4 text-sm font-semibold text-text">Third parties</h3>
      <p class="mt-2">
        When you are redirected to Stripe (for checkout or billing portal) or Google (for
        sign-in), those services set their own cookies under their own domains, governed by their
        respective privacy policies. The landing page and application load web fonts from Google
        Fonts, which may transmit your IP address to Google as part of that request.
      </p>

      <p class="mt-3">
        To revoke your stored preferences, clear the site data for <code class="font-mono text-xs"
          >leadace.ai</code
        > and <code class="font-mono text-xs">app.leadace.ai</code> in your browser settings.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">8. Security</h2>
      <p class="mt-2">
        We rely on industry-standard transport encryption (TLS), database-level row-level security
        for tenant isolation, and OAuth/JWT-based authentication. No system is perfectly secure;
        please report suspected vulnerabilities to
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">9. International transfers</h2>
      <p class="mt-2">
        Our infrastructure is hosted in the Asia-Pacific region. Where data is transferred across
        borders, we rely on the safeguards offered by our sub-processors. [Legal review needed for
        GDPR/SCC, UK IDTA, or APPI cross-border requirements as the customer base expands.]
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">10. Changes</h2>
      <p class="mt-2">
        We will post material changes to this policy at this URL and notify you by email or
        in-product banner before they take effect.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-text">11. Contact</h2>
      <p class="mt-2">
        SurpassOne Inc.<br />
        <a href="mailto:contact@surpassone.com" class="underline">contact@surpassone.com</a>
      </p>
    </section>
  </div>
</div>
