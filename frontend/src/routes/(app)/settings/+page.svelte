<script lang="ts">
  import { onMount } from 'svelte';
  import { get as storeGet } from 'svelte/store';
  import { page } from '$app/state';
  import { del, get, post } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import { plan } from '$lib/stores/plan';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import type { PlanTier, Project } from '$lib/types';

  let showDeleteDialog = $state(false);
  let deleting = $state(false);
  let checkoutLoading = $state<string | null>(null);
  let portalLoading = $state(false);
  let message = $state('');
  let billingPeriod = $state<'monthly' | 'yearly'>('monthly');
  let projectName = $state<string | null>(null);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) {
      projectName = null;
      return;
    }
    get<{ projects: Project[] }>('/projects').then(({ projects }) => {
      projectName = projects.find((p) => p.id === pid)?.name ?? pid;
    });
  });

  interface PaidTier {
    tier: Exclude<PlanTier, 'free'>;
    name: string;
    monthlyPrice: number;
    yearlyPrice: number;
    projects: string;
    outreach: string;
    priceIds: { monthly: string | undefined; yearly: string | undefined };
  }

  const TIERS: PaidTier[] = [
    {
      tier: 'starter',
      name: 'Starter',
      monthlyPrice: 29,
      yearlyPrice: 290,
      projects: '1 project',
      outreach: '1,500 outreach / month',
      priceIds: {
        monthly: import.meta.env.VITE_STRIPE_PRICE_STARTER_MONTHLY,
        yearly: import.meta.env.VITE_STRIPE_PRICE_STARTER_YEARLY,
      },
    },
    {
      tier: 'pro',
      name: 'Pro',
      monthlyPrice: 79,
      yearlyPrice: 790,
      projects: '5 projects',
      outreach: '10,000 outreach / month',
      priceIds: {
        monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY,
        yearly: import.meta.env.VITE_STRIPE_PRICE_PRO_YEARLY,
      },
    },
    {
      tier: 'scale',
      name: 'Scale',
      monthlyPrice: 199,
      yearlyPrice: 1990,
      projects: 'Unlimited projects',
      outreach: 'Unlimited outreach',
      priceIds: {
        monthly: import.meta.env.VITE_STRIPE_PRICE_SCALE_MONTHLY,
        yearly: import.meta.env.VITE_STRIPE_PRICE_SCALE_YEARLY,
      },
    },
  ];

  // Reset transient loading state when the page is restored from bfcache
  // (browser back after navigating away to Stripe).
  function resetLoadingState() {
    portalLoading = false;
    checkoutLoading = null;
  }

  async function pollPlanUntilUpdated(fromPlan: string, maxAttempts = 8, intervalMs = 1500) {
    for (let i = 0; i < maxAttempts; i++) {
      await plan.load();
      const planNow = storeGet(plan).data?.plan;
      if (planNow && planNow !== fromPlan) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  onMount(() => {
    plan.load();
    const status = page.url.searchParams.get('checkout');
    if (status === 'success') {
      message = 'Subscription activated. Waiting for confirmation…';
      const fromPlan = storeGet(plan).data?.plan ?? 'free';
      pollPlanUntilUpdated(fromPlan).then(() => {
        message = 'Subscription activated.';
      });
    } else if (status === 'cancel') {
      message = 'Checkout cancelled.';
    }
    window.addEventListener('pageshow', resetLoadingState);
    return () => window.removeEventListener('pageshow', resetLoadingState);
  });

  async function handleDelete() {
    const pid = $activeProject;
    if (!pid) return;
    deleting = true;
    try {
      await del(`/projects/${pid}`);
      message = `Project "${projectName ?? pid}" deleted.`;
      activeProject.set(null);
      window.location.href = '/prospects';
    } catch (e) {
      message = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
    deleting = false;
    showDeleteDialog = false;
  }

  async function handleUpgrade(tier: PaidTier) {
    const priceId = tier.priceIds[billingPeriod];
    if (!priceId) {
      message = `Price ID for ${tier.name} (${billingPeriod}) is not configured.`;
      return;
    }
    checkoutLoading = tier.tier;
    try {
      const res = await post<{ url: string }>('/me/checkout', {
        priceId,
        successUrl: `${window.location.origin}/settings?checkout=success`,
        cancelUrl: `${window.location.origin}/settings?checkout=cancel`,
      });
      window.location.href = res.url;
    } catch (e) {
      message = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
      checkoutLoading = null;
    }
  }

  async function handlePortal() {
    portalLoading = true;
    try {
      const res = await post<{ url: string }>('/me/portal', {
        returnUrl: `${window.location.origin}/settings`,
      });
      window.location.href = res.url;
    } catch (e) {
      message = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
      portalLoading = false;
    }
  }

  function formatQuota(used: number, limit: number | null): string {
    if (limit === null) return `${used.toLocaleString()} used`;
    return `${used.toLocaleString()} / ${limit.toLocaleString()}`;
  }
</script>

<h2 class="text-lg font-semibold text-text mb-6">Settings</h2>

{#if message}
  <div class="mb-6 rounded bg-surface px-4 py-3 text-sm text-text">{message}</div>
{/if}

<!-- Plan -->
<section class="mb-10">
  <h3 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Plan</h3>

  {#if $plan.loading}
    <p class="text-text-muted text-sm">Loading...</p>
  {:else if $plan.error}
    <p class="text-sm text-danger">Error: {$plan.error}</p>
  {:else if $plan.data}
    {@const p = $plan.data}
    <div class="rounded-md border border-border p-5 mb-6">
      <div class="flex items-start justify-between mb-5">
        <div>
          <p class="text-xs text-text-muted uppercase tracking-wider mb-1">Current plan</p>
          <p class="text-xl font-semibold text-text capitalize">
            {p.isUnlimited ? 'Unlimited' : p.plan}
            {#if !p.isUnlimited && p.plan === 'free'}
              <span class="ml-1 text-xs font-normal text-text-muted">(trial)</span>
            {/if}
          </p>
        </div>
        {#if !p.isUnlimited && p.plan !== 'free'}
          <button
            onclick={handlePortal}
            disabled={portalLoading}
            class="rounded px-3 py-1.5 text-xs font-medium text-text border border-border hover:bg-surface transition-colors disabled:opacity-50"
          >
            {portalLoading ? 'Opening...' : 'Manage subscription'}
          </button>
        {/if}
      </div>

      {#if !p.isUnlimited && p.plan !== 'free'}
        <p class="text-xs text-text-muted mb-5 -mt-2">
          Change plan, update payment method, view invoices, or cancel via the
          Stripe Customer Portal.
        </p>
      {/if}

      <div class="grid grid-cols-2 gap-6">
        <div>
          <p class="text-xs text-text-muted mb-1">
            Outreach ({p.isUnlimited ? 'unlimited' : p.limits.isLifetime ? 'lifetime' : 'this month'})
          </p>
          <p class="font-mono text-lg text-text">
            {formatQuota(p.outreach.used, p.outreach.limit)}
          </p>
          {#if p.outreach.limit !== null}
            <div class="mt-1.5 h-1 w-full rounded-full bg-surface">
              <div
                class="h-1 rounded-full {p.outreach.remaining === 0
                  ? 'bg-accent'
                  : 'bg-text'}"
                style="width: {Math.min(100, (p.outreach.used / p.outreach.limit) * 100)}%"
              ></div>
            </div>
          {/if}
        </div>
        {#if p.prospects}
          <div>
            <p class="text-xs text-text-muted mb-1">
              Prospects ({p.limits.isLifetime ? 'lifetime' : 'this month'})
            </p>
            <p class="font-mono text-lg text-text">
              {formatQuota(p.prospects.used, p.prospects.limit)}
            </p>
            {#if p.prospects.limit !== null}
              <div class="mt-1.5 h-1 w-full rounded-full bg-surface">
                <div
                  class="h-1 rounded-full {p.prospects.remaining === 0
                    ? 'bg-accent'
                    : 'bg-text'}"
                  style="width: {Math.min(100, (p.prospects.used / p.prospects.limit) * 100)}%"
                ></div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if !p.isUnlimited && p.plan === 'free'}
      <div class="flex items-center justify-between mb-4">
        <p class="text-xs font-medium text-text-secondary">Upgrade</p>
        <div class="inline-flex rounded border border-border text-xs">
          <button
            onclick={() => (billingPeriod = 'monthly')}
            class="px-3 py-1 {billingPeriod === 'monthly'
              ? 'bg-surface-2 text-text font-medium'
              : 'text-text-muted hover:text-text'}"
          >
            Monthly
          </button>
          <button
            onclick={() => (billingPeriod = 'yearly')}
            class="px-3 py-1 {billingPeriod === 'yearly'
              ? 'bg-surface-2 text-text font-medium'
              : 'text-text-muted hover:text-text'}"
          >
            Yearly
            <span class="ml-1 text-[10px] text-accent">−17%</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {#each TIERS as tier}
          {@const price = billingPeriod === 'monthly' ? tier.monthlyPrice : tier.yearlyPrice}
          {@const suffix = billingPeriod === 'monthly' ? '/month' : '/year'}
          <div class="rounded-md border border-border p-4 flex flex-col">
            <p class="text-sm font-medium text-text">{tier.name}</p>
            <p class="mt-1">
              <span class="font-mono text-xl font-semibold text-text">${price}</span>
              <span class="text-xs text-text-muted">{suffix}</span>
            </p>
            <ul class="mt-3 space-y-1 text-xs text-text-secondary flex-1">
              <li>{tier.projects}</li>
              <li>{tier.outreach}</li>
            </ul>
            <button
              onclick={() => handleUpgrade(tier)}
              disabled={checkoutLoading !== null}
              class="mt-4 w-full rounded px-3 py-1.5 text-xs font-medium text-page bg-accent hover:bg-accent-strong transition-colors disabled:opacity-50"
            >
              {checkoutLoading === tier.tier ? 'Redirecting...' : `Upgrade to ${tier.name}`}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<!-- Danger zone -->
<section>
  <h3 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Danger Zone</h3>

  {#if $activeProject}
    <div class="rounded-md border border-danger/30 p-4">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-text">Delete project</p>
          <p class="text-xs text-text-secondary mt-0.5">
            Permanently delete <span class="font-medium break-words">{projectName ?? $activeProject}</span> and all its data (prospects, outreach logs, responses, evaluations).
          </p>
        </div>
        <button
          onclick={() => (showDeleteDialog = true)}
          disabled={deleting}
          class="rounded px-3 py-1.5 text-xs font-medium text-danger border border-danger/40 hover:bg-danger hover:text-page transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          Delete
        </button>
      </div>
    </div>
  {:else}
    <p class="text-xs text-text-muted">Select a project to see delete options.</p>
  {/if}
</section>

{#if showDeleteDialog}
  <ConfirmDialog
    title="Delete project"
    message="This will permanently delete the project and all associated data. This action cannot be undone."
    confirmLabel={deleting ? 'Deleting...' : 'Delete'}
    danger
    onconfirm={handleDelete}
    oncancel={() => (showDeleteDialog = false)}
  />
{/if}
