const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================
// HELPER: Forward request to GHL
// ============================================================
async function ghlRequest(method, path, apiKey, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${GHL_API}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.msg || `GHL error: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ============================================================
// ROUTES
// ============================================================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'leadflow-api', version: '1.0.0' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET pipelines
app.get('/api/pipelines', async (req, res) => {
  try {
    const apiKey = req.headers['x-ghl-key'];
    const { locationId } = req.query;
    if (!apiKey || !locationId) return res.status(400).json({ error: 'Missing x-ghl-key header or locationId' });
    const data = await ghlRequest('GET', `/opportunities/pipelines?locationId=${locationId}`, apiKey);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST contact
app.post('/api/contacts', async (req, res) => {
  try {
    const apiKey = req.headers['x-ghl-key'];
    if (!apiKey) return res.status(400).json({ error: 'Missing x-ghl-key header' });
    const data = await ghlRequest('POST', '/contacts/', apiKey, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST opportunity
app.post('/api/opportunities', async (req, res) => {
  try {
    const apiKey = req.headers['x-ghl-key'];
    if (!apiKey) return res.status(400).json({ error: 'Missing x-ghl-key header' });
    const data = await ghlRequest('POST', '/opportunities/', apiKey, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET custom fields
app.get('/api/custom-fields', async (req, res) => {
  try {
    const apiKey = req.headers['x-ghl-key'];
    const { locationId } = req.query;
    if (!apiKey || !locationId) return res.status(400).json({ error: 'Missing x-ghl-key header or locationId' });
    const data = await ghlRequest('GET', `/locations/${locationId}/customFields`, apiKey);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ============================================================
app.listen(PORT, () => {
  console.log(`LeadFlow API running on port ${PORT}`);
});
