-- Lead Ace Database Schema

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 法人マスタ（法人番号が主キー）
CREATE TABLE IF NOT EXISTS organizations (
    corporate_number TEXT PRIMARY KEY,  -- 法人番号（13桁）
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,  -- 正規化済み（NFKC+小文字+trim）
    domain TEXT,  -- website_url からプロトコル・www・パスを除去
    website_url TEXT NOT NULL,
    industry TEXT,
    overview TEXT,
    address TEXT,  -- 国税庁法人番号公表サイトの所在地
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 営業先（法人内の具体的なアプローチ先）
CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,  -- 営業先名（法人名・学校名・部署名等。小さい会社は organizations.name と同じ）
    contact_name TEXT,  -- 担当者名
    organization_id TEXT REFERENCES organizations(corporate_number),  -- FK → organizations（レガシーデータはNULL）
    department TEXT,  -- 部署名・拠点名（なければNULL。学校法人の場合は学校名）
    overview TEXT NOT NULL,
    industry TEXT,
    website_url TEXT NOT NULL,
    email TEXT,
    contact_form_url TEXT,
    form_type TEXT,  -- google_forms, native_html, wordpress_cf7, iframe_embed, with_captcha
    sns_accounts TEXT,  -- JSON: {"twitter": "...", "linkedin": "...", ...}
    do_not_contact INTEGER NOT NULL DEFAULT 0,  -- 1 = 送付NG（全プロジェクト共通）
    org_lookup_status TEXT,  -- NULL=未検索, not_applicable=法人番号なし, unresolvable=特定不可
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS project_prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    prospect_id INTEGER NOT NULL,
    match_reason TEXT NOT NULL,  -- なぜこの営業先がターゲットとして適切か（相手の課題・ニーズも含めて記述）
    priority INTEGER NOT NULL DEFAULT 3,  -- 1=最高 5=最低
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
CREATE INDEX IF NOT EXISTS idx_org_domain ON organizations(domain);
CREATE INDEX IF NOT EXISTS idx_org_normalized_name ON organizations(normalized_name);

-- Indexes: prospects（二重送信防止の UNIQUE 制約）
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

-- Trigger: contacted ステータスには outreach_logs の sent レコードが必要
CREATE TRIGGER IF NOT EXISTS enforce_contacted_has_log
BEFORE UPDATE ON project_prospects
WHEN NEW.status = 'contacted' AND OLD.status != 'contacted'
BEGIN
    SELECT RAISE(ABORT, 'contacted にするには outreach_logs に sent レコードが必要です。send_and_log.py を経由してください')
    WHERE NOT EXISTS (
        SELECT 1 FROM outreach_logs
        WHERE project_id = NEW.project_id
          AND prospect_id = NEW.prospect_id
          AND status = 'sent'
    );
END;
