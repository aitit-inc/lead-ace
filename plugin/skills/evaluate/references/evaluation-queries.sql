-- Evaluation SQL query templates (for reference)
-- Use the eval-* commands in sales_queries.py to execute these

-- Total outreach count
SELECT COUNT(*) as total_outreach
FROM outreach_logs
WHERE project_id = ?;

-- Outreach count by channel
SELECT channel, COUNT(*) as count
FROM outreach_logs
WHERE project_id = ?
GROUP BY channel;

-- Response count and unique responders
SELECT
    COUNT(*) as total_responses,
    COUNT(DISTINCT o.prospect_id) as unique_responders
FROM responses r
JOIN outreach_logs o ON r.outreach_log_id = o.id
WHERE o.project_id = ?;

-- Breakdown by sentiment and response type
SELECT sentiment, response_type, COUNT(*) as count
FROM responses r
JOIN outreach_logs o ON r.outreach_log_id = o.id
WHERE o.project_id = ?
GROUP BY sentiment, response_type;

-- Response rate by priority
SELECT
    pp.priority,
    COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN pp.prospect_id END) as contacted,
    COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN pp.prospect_id END) as responded
FROM project_prospects pp
LEFT JOIN outreach_logs o ON pp.prospect_id = o.prospect_id AND o.project_id = pp.project_id
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE pp.project_id = ?
GROUP BY pp.priority;

-- Prospect count by status
SELECT status, COUNT(*) as count
FROM project_prospects
WHERE project_id = ?
GROUP BY status;

-- Response rate by channel
SELECT
    o.channel,
    COUNT(DISTINCT o.prospect_id) as contacted,
    COUNT(DISTINCT r.outreach_log_id) as responded,
    ROUND(CAST(COUNT(DISTINCT r.outreach_log_id) AS FLOAT) / NULLIF(COUNT(DISTINCT o.id), 0) * 100, 1) as response_rate_pct
FROM outreach_logs o
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ?
GROUP BY o.channel;

-- Full body of emails that received responses
SELECT o.id, o.channel, o.subject, o.body, r.sentiment, r.response_type
FROM outreach_logs o
JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ?
ORDER BY r.received_at DESC;

-- Sample of emails that received no response
SELECT o.id, o.channel, o.subject, o.body
FROM outreach_logs o
LEFT JOIN responses r ON o.id = r.outreach_log_id
WHERE o.project_id = ? AND r.id IS NULL
ORDER BY o.sent_at DESC
LIMIT 10;
