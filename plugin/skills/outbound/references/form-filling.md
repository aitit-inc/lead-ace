# Contact Form Submission Procedure

Use playwright-cli to fill in and submit forms, then record the result via MCP.

**Important: Submit forms only once.** After clicking the submit button, do not retry for any reason. Use the network command to verify submission success.

## Basic Flow

```bash
# 1. Open browser and navigate to the form
playwright-cli open <form URL>

# 2. Use snapshot to understand form structure
playwright-cli snapshot

# 3. Fill in each field (using refs)
playwright-cli fill e5 "Acme Corp"
playwright-cli fill e8 "John Smith"
playwright-cli fill e12 "info@example.com"
playwright-cli select e15 "Service inquiry"
playwright-cli fill e20 "<body text>"

# 4. Click the submit button
playwright-cli click e25

# 5. Verify submission completion (see "Submission Completion Check" below)

# 6. Close the browser
playwright-cli close
```

## Sales Refusal Check (Safety Net)

When taking a snapshot of the form page, check for any text stating "No sales inquiries", "Please refrain from sales outreach", "No solicitation", etc. **If found, stop the form submission** and do the following before moving on to the next prospect:

```bash
playwright-cli close
```

Then call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "Sales refusal notice found"`.

Then call `mcp__plugin_lead-ace_api__update_prospect_status` with `status: "inactive"`.

## Form Filling Policy

- Split the message appropriately to match the form's fields
- For "Inquiry type" fields, select options like "Service inquiry" or "Business partnership inquiry"
- Retrieve basic info (organization name, full name, email, phone number) from BUSINESS.md
- In free-text fields, enter a customized message following the same email guidelines, but adapted to be concise for forms
- Use `playwright-cli check <ref>` for checkboxes (e.g., privacy policy agreement)

## Submission Completion Check (Required)

After clicking the submit button, verify completion in the following order. **Never re-submit until verification is complete.**

### Step 1: Check Page Change with snapshot

```bash
playwright-cli snapshot
```

The submission is **successful** if any of the following are observed:
- A thank-you page is displayed ("Thank you for your inquiry", etc.)
- URL has transitioned to a thank-you page (`/thanks`, `/complete`, etc.)
- The form has disappeared and a completion message is displayed
- A success message such as "Message sent" is displayed

### Step 2: If snapshot is inconclusive, check network

```bash
playwright-cli network
```

Look for a POST request in the network output:
- A POST to the form URL or a related endpoint -> **Submission successful** (reached the server)
- POST status is 200 or 302 -> **Submission successful**
- No POST found -> **Submission failed** (button click may not have triggered form submission)

### Processing Based on Verification Result

**If submission was successful:**

```bash
playwright-cli close
```

Then call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, `subject`, and `body`.

**If submission failed (only when no POST confirmed):**

```bash
playwright-cli close
```

Then call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "<reason>"`.

**Important:** Even on failure, do not re-submit to that form. Move on to the next prospect.

## Error Handling

- **Form not found:** No form element in snapshot -> record with `status: "failed"` and `errorMessage`
- **Input validation error:** Check snapshot for error messages, then attempt one corrected re-submission. Verify the re-submission via network as well
- **Page load timeout:** Record as `status: "failed"` and move on

### When reCAPTCHA / hCaptcha or Similar is Present

If the form has reCAPTCHA, hCaptcha, Turnstile, or similar CAPTCHA (detected in snapshot), skip form submission:

```bash
playwright-cli close
```

Then call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "failed"`, `errorMessage: "Skipped due to reCAPTCHA"`.

- The prospect's status stays as `new` (the CAPTCHA may be removed in a future update)
- If another channel (email, SNS) is available, try that instead

### For Google Forms

Submit Google Forms via a direct POST to the `formResponse` endpoint rather than browser UI interaction. This has a high success rate (no UI interaction needed, no CAPTCHA), and minimal context usage. No browser needs to be opened.

**Detection:**
- URL contains `docs.google.com/forms`
- Page source contains `FB_PUBLIC_LOAD_DATA_`

**Submission procedure:**

1. **Retrieve the raw HTML of the form page and extract form ID and entry IDs**

   Use the `--raw` flag to get raw HTML (Jina Reader strips form data):

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py \
     --url "https://docs.google.com/forms/d/{FORM_ID}/viewform" \
     --prompt "Extract all entry IDs from this Google Form. From the field definitions in FB_PUBLIC_LOAD_DATA_, list each field's label and its corresponding entry.XXXXXXX ID. For multiple-choice fields, include the list of options and their selection IDs." \
     --raw --timeout 20
   ```

   - Form ID: from the `/forms/d/{FORM_ID}/` part of the URL
   - Entry IDs: `--raw` passes raw HTML to Haiku, which extracts field labels and entry ID mappings from `FB_PUBLIC_LOAD_DATA_`

3. **POST to the formResponse endpoint**

   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -X POST "https://docs.google.com/forms/d/{FORM_ID}/formResponse" \
     -d "entry.XXXXXXX=value1&entry.YYYYYYY=value2&entry.ZZZZZZZ=value3"
   ```

   - HTTP 200 means submission was successful
   - Redirect (302 -> confirmation page) also means success

4. **Record the log**

   Call `mcp__plugin_lead-ace_api__record_outreach` with `channel: "form"`, `status: "sent"`, `subject`, and `body`.

**Notes:**
- The order of form fields and their entry IDs may not be obvious. Cross-reference with the field definitions (label text) in the page source to map the correct entry IDs
- Some forms with email collection enabled also require an `emailAddress` parameter
