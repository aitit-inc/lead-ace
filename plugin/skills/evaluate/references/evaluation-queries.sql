-- 評価用SQLクエリテンプレート（リファレンス用）
-- 実行は sales_queries.py の eval-* コマンドを使用すること

-- アプローチ総数
SELECT COUNT(*) as total_outreach
FROM outreach_logs
WHERE project_id = ?;

-- チャネル別アプローチ数
SELECT channel, COUNT(*) as count
FROM outreach_logs
WHERE project_id = ?
GROUP BY channel;

-- 反応数・ユニーク回答者数
SELECT
    COUNT(*) as total_responses,
    COUNT(DISTINCT o.prospect_id) as unique_responders
FROM responses r
JOIN outreach_logs o ON r.outreach_log_id = o.id
WHERE o.project_id = ?;

-- センチメント別・反応種別の内訳
SELECT sentiment, response_type, COUNT(*) as count
FROM responses r
JOIN outreach_logs o ON r.outreach_log_id = o.id
WHERE o.project_id = ?
GROUP BY sentiment, response_type;

-- 優先度別の反応率
SELECT
    pp.priority,
    COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN pp.prospect_id END) as contacted,
    COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN pp.prospect_id END) as responded
FROM project_prospects pp
LEFT JOIN outreach_logs o ON pp.prospect_id = o.prospect_id AND o.project_id = pp.project_id
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE pp.project_id = ?
GROUP BY pp.priority;

-- ステータス別営業先数
SELECT status, COUNT(*) as count
FROM project_prospects
WHERE project_id = ?
GROUP BY status;

-- チャネル別反応率
SELECT
    o.channel,
    COUNT(DISTINCT o.prospect_id) as contacted,
    COUNT(DISTINCT r.outreach_log_id) as responded,
    ROUND(CAST(COUNT(DISTINCT r.outreach_log_id) AS FLOAT) / NULLIF(COUNT(DISTINCT o.id), 0) * 100, 1) as response_rate_pct
FROM outreach_logs o
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ?
GROUP BY o.channel;

-- 反応があったメールの本文（全件）
SELECT o.id, o.channel, o.subject, o.body, r.sentiment, r.response_type
FROM outreach_logs o
JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ?
ORDER BY r.received_at DESC;

-- 反応がなかったメールの本文（サンプル）
SELECT o.id, o.channel, o.subject, o.body
FROM outreach_logs o
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ? AND r.id IS NULL
ORDER BY o.sent_at DESC
LIMIT 10;
