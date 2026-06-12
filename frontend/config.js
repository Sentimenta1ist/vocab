// Production: overwritten at container start by 40-inject-config.sh with BACKEND_URL env var.
// Local dev (FastAPI serves this directly): empty string → API calls use relative /api.
window.VOCAB_BACKEND = '';
