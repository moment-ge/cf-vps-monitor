CREATE INDEX history_expiry ON history(ts);
CREATE INDEX login_limits_expiry ON login_limits(expires_at);
