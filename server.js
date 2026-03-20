const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tguxjwgpfherviuykrkg.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json());

// Auth middleware
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// Health
app.get('/', (req, res) => res.json({ status: 'ok', service: 'leadflow-api', version: '2.1.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===== AUTH =====
const authSignup = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { data, error } = await supabase.auth.admin.createUser({ 
      email, password, email_confirm: true,
      user_metadata: { name: name || '' }
    });
    if (error) throw error;
    const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signErr) throw signErr;
    res.json({ user: { id: data.user.id, email: data.user.email, name: name || '' }, token: signIn.session.access_token, refresh_token: signIn.session.refresh_token });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

const authLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name || '' }, token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

const authRefresh = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error) throw error;
    res.json({ token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch (err) { res.status(401).json({ error: err.message }); }
};

const authMe = [requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email } });
}];

// Register auth routes on BOTH paths
app.post('/api/auth/signup', authSignup);
app.post('/auth/signup', authSignup);
app.post('/api/auth/login', authLogin);
app.post('/auth/login', authLogin);
app.post('/api/auth/refresh', authRefresh);
app.post('/auth/refresh', authRefresh);
app.get('/api/auth/me', ...authMe);
app.get('/auth/me', ...authMe);

// ===== FORMS CRUD =====
const getForms = [requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('forms').select('id, name, steps, theme, created_at, updated_at').eq('user_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ forms: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

const getForm = [requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('forms').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ form: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

const createForm = [requireAuth, async (req, res) => {
  try {
    const { name, steps, theme, ghl_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, ghl_field_map } = req.body;
    const { data, error } = await supabase.from('forms').insert({
      user_id: req.user.id, name: name || 'Untitled Form', steps: steps || [], theme: theme || {},
      ghl_key: ghl_key || '', ghl_location_id: ghl_location_id || '', ghl_pipeline_id: ghl_pipeline_id || '',
      ghl_stage_id: ghl_stage_id || '', ghl_field_map: ghl_field_map || {},
    }).select().single();
    if (error) throw error;
    res.json({ form: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

const updateForm = [requireAuth, async (req, res) => {
  try {
    const updates = {};
    ['name','steps','theme','ghl_key','ghl_location_id','ghl_pipeline_id','ghl_stage_id','ghl_field_map'].forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('forms').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ form: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

const deleteForm = [requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('forms').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

// Register form routes on BOTH paths
app.get('/api/forms', ...getForms);
app.get('/forms', ...getForms);
app.get('/api/forms/:id', ...getForm);
app.get('/forms/:id', ...getForm);
app.post('/api/forms', ...createForm);
app.post('/forms', ...createForm);
app.put('/api/forms/:id', ...updateForm);
app.put('/forms/:id', ...updateForm);
app.delete('/api/forms/:id', ...deleteForm);
app.delete('/forms/:id', ...deleteForm);

// ===== PUBLIC FORM + SUBMIT (for embeds) =====
const getPublicForm = async (req, res) => {
  try {
    const { data, error } = await supabase.from('forms').select('id, name, steps, theme, ghl_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, ghl_field_map').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Form not found' });
    res.json({ form: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const submitForm = async (req, res) => {
  try {
    const { data: form, error: fErr } = await supabase.from('forms').select('*').eq('id', req.params.formId).single();
    if (fErr || !form) return res.status(404).json({ error: 'Form not found' });

    const { formData } = req.body;
    let ghl_contact_id = null, ghl_opportunity_id = null, status = 'success';

    if (form.ghl_key && form.ghl_location_id) {
      try {
        const allFields = (form.steps || []).flatMap(s => s.fields || []);
        const contact = { locationId: form.ghl_location_id, tags: ['leadflow'] };
        const cfs = [];
        allFields.forEach(f => {
          const v = formData[f.id]; if (v === undefined || v === '' || v === null) return;
          const sv = Array.isArray(v) ? v.join(', ') : String(v);
          const m = (form.ghl_field_map || {})[f.id];
          if (m) { if (m.startsWith('cf_')) cfs.push({ id: m.replace('cf_', ''), field_value: sv }); else contact[m] = sv; }
          else { if (f.type === 'email' && !contact.email) contact.email = sv; else if (f.type === 'phone' && !contact.phone) contact.phone = sv; else if (f.type === 'text' && !contact.firstName) { const p = sv.split(' '); contact.firstName = p[0] || ''; contact.lastName = p.slice(1).join(' ') || ''; } }
        });
        if (cfs.length) contact.customFields = cfs;
        const cRes = await ghlFetch('POST', '/contacts/', form.ghl_key, contact);
        ghl_contact_id = cRes.contact?.id;
        if (ghl_contact_id && form.ghl_pipeline_id && form.ghl_stage_id) {
          const oRes = await ghlFetch('POST', '/opportunities/', form.ghl_key, { pipelineId: form.ghl_pipeline_id, pipelineStageId: form.ghl_stage_id, locationId: form.ghl_location_id, contactId: ghl_contact_id, name: `${contact.firstName || ''} ${contact.lastName || ''} - ${form.name}`.trim(), status: 'open' });
          ghl_opportunity_id = oRes.opportunity?.id;
        }
      } catch (e) { console.error('GHL:', e.message); status = 'ghl_error'; }
    }

    const { data: sub } = await supabase.from('submissions').insert({ form_id: form.id, data: formData, ghl_contact_id, ghl_opportunity_id, status }).select().single();
    res.json({ success: true, submission_id: sub?.id, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

app.get('/api/public/forms/:id', getPublicForm);
app.get('/public/forms/:id', getPublicForm);
app.post('/api/public/submit/:formId', submitForm);
app.post('/public/submit/:formId', submitForm);

// ===== SUBMISSIONS =====
const getSubmissions = [requireAuth, async (req, res) => {
  try {
    const { data: form } = await supabase.from('forms').select('id').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!form) return res.status(404).json({ error: 'Form not found' });
    const { data, error } = await supabase.from('submissions').select('*').eq('form_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ submissions: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
}];

app.get('/api/forms/:id/submissions', ...getSubmissions);
app.get('/forms/:id/submissions', ...getSubmissions);

// ===== GHL PROXY =====
async function ghlFetch(method, path, apiKey, body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': GHL_VERSION, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) opts.body = JSON.stringify(body);
  const r = await fetch(`${GHL_API}${path}`, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || d.msg || `GHL ${r.status}`); e.status = r.status; throw e; }
  return d;
}

app.get('/api/pipelines', async (req, res) => { try { const k = req.headers['x-ghl-key']; const { locationId } = req.query; if (!k || !locationId) return res.status(400).json({ error: 'Missing params' }); res.json(await ghlFetch('GET', `/opportunities/pipelines?locationId=${locationId}`, k)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/contacts', async (req, res) => { try { const k = req.headers['x-ghl-key']; if (!k) return res.status(400).json({ error: 'Missing key' }); res.json(await ghlFetch('POST', '/contacts/', k, req.body)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/opportunities', async (req, res) => { try { const k = req.headers['x-ghl-key']; if (!k) return res.status(400).json({ error: 'Missing key' }); res.json(await ghlFetch('POST', '/opportunities/', k, req.body)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.get('/api/custom-fields', async (req, res) => { try { const k = req.headers['x-ghl-key']; const { locationId } = req.query; if (!k || !locationId) return res.status(400).json({ error: 'Missing params' }); res.json(await ghlFetch('GET', `/locations/${locationId}/customFields`, k)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });

app.listen(PORT, () => console.log(`LeadFlow API v2.1 on port ${PORT}`));
