// Injected at container start via envsubst.
// Empty string = relative URLs (local dev, when FastAPI serves everything).
// Full URL = production separate deployment (e.g. https://vocab-api.qear.net).
window.VOCAB_BACKEND = '${BACKEND_URL}';
