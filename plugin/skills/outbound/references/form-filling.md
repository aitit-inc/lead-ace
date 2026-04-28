# Contact Form Submission Procedure

Use the `mcp__claude_in_chrome__*` tools to fill in and submit forms, then record the result via MCP. See `claude-in-chrome-guide.md` for the full tool reference.

**Important: Submit forms only once.** After clicking the submit button, do not retry for any reason. Verify outcome via `read_network_requests` and page state.

## Basic Flow

Set up the tab and navigate per the Quick start in `claude-in-chrome-guide.md`, then:

```
1. mcp__claude_in_chrome__read_page { tabId }
   -> identify the form, fields, and submit button refs

2. mcp__claude_in_chrome__form_input × N  (call in parallel — no order dependency)
   { tabId, ref: "ref_5",  value: "Acme Corp" }
   { tabId, ref: "ref_8",  value: "山田 太郎" }
   { tabId, ref: "ref_12", value: "info@example.com" }
   { tabId, ref: "ref_15", value: "Service inquiry" }   // select uses string
   { tabId, ref: "ref_20", value: "<body text>" }        // textarea
   { tabId, ref: "ref_22", value: true }                 // checkbox / radio

3. mcp__claude_in_chrome__read_network_requests { tabId, clear: true }
   -> initialize tracking BEFORE the submit click

4. mcp__claude_in_chrome__computer { tabId, action: "left_click", ref: <submit ref> }

5. Verify completion (see "Submission Completion Check" below)
```

Capture the body text in your own state **before** step 4 — some forms wipe fields on submit.

## Sales Refusal Check (Safety Net)

When inspecting the form page, check for any text stating "No sales inquiries", "Please refrain from sales outreach", "営業お断り", "勧誘お断り", etc. The accessibility tree from `read_page` includes most labels and headings; for body copy, also try `find { query: "sales refusal notice" }` or `javascript_tool { text: "document.body.innerText" }` and grep.

**If found, stop the form submission** and call:
- `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "Sales refusal notice found"`.
- `mcp__plugin_lead-ace_api__update_prospect_status` with `status: "inactive"`.

## Form Filling Policy

- Split the message appropriately to match the form's fields
- For "Inquiry type" fields, select options like "Service inquiry" or "Business partnership inquiry"
- Retrieve basic info (organization name, full name, email, phone number) from BUSINESS.md
- In free-text fields, enter a customized message following the same email guidelines, but adapted to be concise for forms
- Use `form_input { ref, value: true }` for privacy-policy / agreement checkboxes

## Submission Completion Check (Required)

After the submit click, verify in this order. **Never re-submit until verification is complete.**

### Step 1: Check the network result

```
mcp__claude_in_chrome__read_network_requests { tabId, urlPattern: <relevant>, limit: 30 }
```

Look for the form's POST:
- **HTTP 200 / 302** -> Submission successful
- **HTTP 4xx** -> Submission failed (validation or rejection)
- **HTTP 5xx** -> Treat as failed for the outreach log. **Note**: a small number of SaaS form backends (e.g. studio.design's `studiodesignapp.com`) return 5xx but still deliver the message asynchronously. If you suspect this, surface it in the report so the user can verify.
- **No POST visible** -> the submit click did not trigger submission. Re-check the form for missing required fields, then verify page state.

If there are many unrelated requests, narrow with `urlPattern` (a substring of the expected POST URL) before reading.

### Step 2: Sanity-check page state

```
mcp__claude_in_chrome__read_page { tabId }
```

The submission is **definitely successful** if any of:
- A thank-you page is displayed ("Thank you for your inquiry", "送信完了", etc.)
- URL has transitioned to a confirmation route (`/thanks`, `/complete`, etc.)
- The form has disappeared and a completion message is shown

### Processing Based on Verification Result

**If submission was successful:** call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, `subject`, and `body`. Use the body text you captured **before** the click.

**If submission failed (4xx, 5xx, or no POST):** call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "<reason>"`.

**Important:** Even on failure, do not re-submit to that form. Move on to the next prospect.

## Error Handling

- **Form not found:** No `<form>` in `read_page` -> record with `status: "failed"` and `errorMessage: "no form on page"`
- **Input validation error:** Check `read_page` for inline error messages, then make **one** corrected re-submission attempt. Verify the re-submission via network as well.
- **Page load timeout:** Record as `status: "failed"` and move on.

### When reCAPTCHA / hCaptcha or Similar is Present

If the form has reCAPTCHA, hCaptcha, Turnstile, or similar CAPTCHA (visible in `read_page` or `find { query: "captcha" }`), skip form submission:

- `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "Skipped due to reCAPTCHA"`.
- The prospect's status stays as `new` (the CAPTCHA may be removed in a future update).
- If another channel (email, SNS) is available, try that instead.

### For Google Forms

Submit Google Forms via a direct POST to the `formResponse` endpoint rather than browser UI interaction. This has a high success rate (no UI interaction needed, no CAPTCHA), and minimal context usage.

**Detection:**
- URL contains `docs.google.com/forms`
- Page source contains `FB_PUBLIC_LOAD_DATA_`

**Submission procedure:**

1. **Extract entry IDs via `javascript_tool`** (replaces the old `fetch_url.py --raw` + Haiku flow — deterministic, no LLM call needed):

   ```
   mcp__claude_in_chrome__navigate { tabId, url: "https://docs.google.com/forms/d/e/{FORM_ID}/viewform" }

   mcp__claude_in_chrome__javascript_tool {
     tabId,
     action: "javascript_exec",
     text: "(() => { const data = window.FB_PUBLIC_LOAD_DATA_; const fields = data[1][1]; return JSON.stringify({ formId: location.pathname.match(/\\/forms\\/d\\/e\\/([^/]+)\\//)[1], title: data[1][8], fields: fields.map(f => ({ label: f[1], type: f[3], entries: Array.isArray(f[4]) ? f[4].map(e => ({ id: e[0], options: Array.isArray(e[1]) ? e[1].map(o => o[0]) : null })) : null })) }); })()"
   }
   ```

   Result shape:
   ```json
   {
     "formId": "1FAIp...",
     "title": "...",
     "fields": [
       { "label": "ラジオボタン", "type": 2, "entries": [{ "id": 1022372562, "options": ["オプション 1", ...] }] },
       { "label": "プルダウン",   "type": 3, "entries": [{ "id": 87339598,   "options": [...] }] },
       { "label": "チェックボックス", "type": 4, "entries": [{ "id": 1220516489, "options": [...] }] },
       { "label": "日付選択",     "type": 9, "entries": [{ "id": 1490458150, "options": null }] },
       ...
     ]
   }
   ```

2. **POST to the formResponse endpoint** via Bash:

   ```bash
   curl -s -o /tmp/gform_resp.html -w "HTTP: %{http_code}\n" \
     -X POST "https://docs.google.com/forms/d/e/{FORM_ID}/formResponse" \
     --data-urlencode "entry.XXXXXXX=value1" \
     --data-urlencode "entry.YYYYYYY=value2" \
     --data-urlencode "entry.YYYYYYY=value3"   # repeat the same entry.X for multi-checkbox
   grep -oE "回答を記録しました|response has been recorded" /tmp/gform_resp.html
   ```

   - HTTP 200 + the body containing `回答を記録しました` (or `Your response has been recorded.`) -> success
   - HTTP 200 without that marker usually means the form re-rendered with a validation error — check the response body.
   - HTTP 302 (redirect to confirmation page) also means success.

3. **Record the log:** call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, `subject`, and `body`.

**Notes:**
- The order of form fields and their entry IDs may not be obvious. Cross-reference with the field `label` in the JS extraction to map the correct entry IDs.
- Some forms with email collection enabled also require an `emailAddress` parameter.
- For checkbox fields, repeat `--data-urlencode "entry.X=optionA"` once per selected option.
