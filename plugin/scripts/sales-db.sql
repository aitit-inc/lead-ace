-- Lead Ace Database Schema

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Entity master table (apex domain is the unique identifier)
CREATE TABLE IF NOT EXISTS organizations (
    domain TEXT PRIMARY KEY,             -- apex domain (e.g., "example.com")
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,       -- normalized (NFKC + lowercase + trim)
    website_url TEXT NOT NULL,
    country TEXT,                        -- ISO 3166-1 alpha-2 (e.g., "JP", "US")
    address TEXT,
    industry TEXT,
    overview TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Prospects (specific outreach targets within an entity)
CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,  -- prospect name (entity name, school name, department, etc.; same as organizations.name for small companies)
    contact_name TEXT,  -- contact person's name
    organization_id TEXT NOT NULL REFERENCES organizations(domain),  -- FK → organizations
    department TEXT,  -- department or branch name (NULL if not applicable)
    overview TEXT NOT NULL,
    industry TEXT,
    website_url TEXT NOT NULL,
    email TEXT,
    contact_form_url TEXT,
    form_type TEXT,  -- google_forms, native_html, wordpress_cf7, iframe_embed, with_captcha
    sns_accounts TEXT,  -- JSON: {"twitter": "...", "linkedin": "...", ...}
    do_not_contact INTEGER NOT NULL DEFAULT 0,  -- 1 = do not contact (applies across all projects)
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS project_prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    prospect_id INTEGER NOT NULL,
    match_reason TEXT NOT NULL,  -- why this prospect is a suitable target (include their challenges and needs)
    priority INTEGER NOT NULL DEFAULT 3,  -- 1=highest 5=lowest
    status TEXT NOT NULL DEFAULT 'new',  -- new, contacted, responded, converted, rejected, inactive, unreachable
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (prospect_id) REFERENCES prospects(id),
    UNIQUE(project_id, prospect_id)
);

CREATE TABLE IF NOT EXISTS outreach_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    prospect_id INTEGER NOT NULL,
    channel TEXT NOT NULL,  -- email, form, sns_twitter, sns_linkedin, etc.
    subject TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',  -- sent, failed
    sent_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    error_message TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (prospect_id) REFERENCES prospects(id)
);

CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outreach_log_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    content TEXT NOT NULL,
    sentiment TEXT NOT NULL,  -- positive, neutral, negative
    response_type TEXT NOT NULL,  -- reply, auto_reply, bounce, meeting_request, rejection, etc.
    received_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (outreach_log_id) REFERENCES outreach_logs(id)
);

CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    evaluation_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    metrics TEXT NOT NULL,  -- JSON: {"total_sent": N, "response_rate": 0.XX, ...}
    findings TEXT NOT NULL,
    improvements TEXT NOT NULL,  -- JSON array of improvement actions
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Indexes: organizations
-- (domain is the PRIMARY KEY, automatically indexed)
CREATE INDEX IF NOT EXISTS idx_org_normalized_name ON organizations(normalized_name);

-- Indexes: prospects (UNIQUE constraints to prevent duplicate outreach)
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_unique_email ON prospects(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_unique_form ON prospects(contact_form_url) WHERE contact_form_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_org ON prospects(organization_id);

-- Indexes: project_prospects
CREATE INDEX IF NOT EXISTS idx_project_prospects_project ON project_prospects(project_id);
CREATE INDEX IF NOT EXISTS idx_project_prospects_prospect ON project_prospects(prospect_id);
CREATE INDEX IF NOT EXISTS idx_project_prospects_status ON project_prospects(status);
CREATE INDEX IF NOT EXISTS idx_outreach_project ON outreach_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_outreach_prospect ON outreach_logs(prospect_id);
CREATE INDEX IF NOT EXISTS idx_outreach_dedup ON outreach_logs(project_id, prospect_id, status);
CREATE INDEX IF NOT EXISTS idx_responses_outreach ON responses(outreach_log_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_project ON evaluations(project_id);

-- Trigger: setting status to contacted requires a sent record in outreach_logs
CREATE TRIGGER IF NOT EXISTS enforce_contacted_has_log
BEFORE UPDATE ON project_prospects
WHEN NEW.status = 'contacted' AND OLD.status != 'contacted'
BEGIN
    SELECT RAISE(ABORT, 'A sent record in outreach_logs is required to set status to contacted. Use send_and_log.py.')
    WHERE NOT EXISTS (
        SELECT 1 FROM outreach_logs
        WHERE project_id = NEW.project_id
          AND prospect_id = NEW.prospect_id
          AND status = 'sent'
    );
END;
