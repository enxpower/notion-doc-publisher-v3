# Phase 2 Runtime Reliability Note

The production incremental publisher treats transient Notion transport failures, HTTP 429 responses, and HTTP 5xx responses as retryable. Retries are bounded, use capped backoff, preserve the prior successful deployment state, and never convert a failed operation into a success writeback.

Permanent HTTP 4xx responses fail closed immediately. Credentials are never included in retry diagnostics.
