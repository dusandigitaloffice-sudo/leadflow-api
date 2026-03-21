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

// ============================================================
// HELPERS
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function evalRule(rule, formData) {
  const val = String(formData[rule.field_id] || '');
  switch (rule.operator) {
    case 'equals': return val === rule.value;
    case 'not_equals': return val !== rule.value;
    case 'contains': return val.toLowerCase().includes((rule.value || '').toLowerCase());
    case 'is_empty': return !val;
    case 'is_not_empty': return !!val;
    default: return false;
  }
}

async function ghlFetch(method, path, apiKey, body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${apiKey}`, 'Version': GHL_VERSION, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) opts.body = JSON.stringify(body);
  const r = await fetch(`${GHL_API}${path}`, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || d.msg || `GHL ${r.status}`); e.status = r.status; throw e; }
  return d;
}

async function fireWebhook(url, payload) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('Webhook error:', e.message); }
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });
  req.user = user;
  next();
}

// ============================================================
// ROUTES
// ============================================================

app.get('/', (req, res) => res.json({ status: 'ok', service: 'floumate-api', version: '4.0.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ===== AUTH =====
const authSignup = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: name || '' } });
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

const authMe = [requireAuth, (req, res) => { res.json({ user: { id: req.user.id, email: req.user.email } }); }];

app.post('/api/auth/signup', authSignup); app.post('/auth/signup', authSignup);
app.post('/api/auth/login', authLogin); app.post('/auth/login', authLogin);
app.post('/api/auth/refresh', authRefresh); app.post('/auth/refresh', authRefresh);
app.get('/api/auth/me', ...authMe); app.get('/auth/me', ...authMe);

// ===== FORMS CRUD =====
const FORM_FIELDS = ['name','steps','theme','ghl_key','ghl_location_id','ghl_pipeline_id','ghl_stage_id','ghl_field_map','rules','pixel_id','webhook_url'];

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
    FORM_FIELDS.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
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

app.get('/api/forms', ...getForms); app.get('/forms', ...getForms);
app.get('/api/forms/:id', ...getForm); app.get('/forms/:id', ...getForm);
app.post('/api/forms', ...createForm); app.post('/forms', ...createForm);
app.put('/api/forms/:id', ...updateForm); app.put('/forms/:id', ...updateForm);
app.delete('/api/forms/:id', ...deleteForm); app.delete('/forms/:id', ...deleteForm);

// ===== PUBLIC FORM + SUBMIT =====
const getPublicForm = async (req, res) => {
  try {
    const { data, error } = await supabase.from('forms').select('*').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Form not found' });
    res.json({ form: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const submitForm = async (req, res) => {
  try {
    const { data: form, error: fErr } = await supabase.from('forms').select('*').eq('id', req.params.formId).single();
    if (fErr || !form) return res.status(404).json({ error: 'Form not found' });

    const { formData, sourceData, sessionId } = req.body;
    let ghl_contact_id = null, ghl_opportunity_id = null, status = 'success';

    // Delete any partial submission for this session
    if (sessionId) {
      const { error: delErr } = await supabase.from('submissions').delete().eq('form_id', form.id).eq('status', 'partial').eq('session_id', sessionId);
      if (delErr) { /* session_id column may not exist yet, ignore */ }
    }

    if (form.ghl_key && form.ghl_location_id) {
      try {
        const allFields = (form.steps || []).flatMap(s => s.fields || []);
        const contact = { locationId: form.ghl_location_id, tags: ['floumate'] };
        const cfs = [];
        allFields.forEach(f => {
          const v = formData[f.id]; if (v === undefined || v === '' || v === null) return;
          const sv = Array.isArray(v) ? v.join(', ') : String(v);
          const m = (form.ghl_field_map || {})[f.id];
          if (m) { if (m.startsWith('cf_')) cfs.push({ id: m.replace('cf_', ''), field_value: sv }); else contact[m] = sv; }
          else { if (f.type === 'email' && !contact.email) contact.email = sv; else if (f.type === 'phone' && !contact.phone) contact.phone = sv; else if (f.type === 'text' && !contact.firstName) { const p = sv.split(' '); contact.firstName = p[0] || ''; contact.lastName = p.slice(1).join(' ') || ''; } }
        });

        // Auto Source Detection → GHL tags
        if (sourceData) {
          if (sourceData.utm_source) contact.tags.push('source:' + sourceData.utm_source.toLowerCase());
          if (sourceData.utm_source) contact.tags.push('utm_source:' + sourceData.utm_source);
          if (sourceData.utm_medium) contact.tags.push('utm_medium:' + sourceData.utm_medium);
          if (sourceData.utm_campaign) contact.tags.push('utm_campaign:' + sourceData.utm_campaign);
        }

        // Conditional Logic → GHL tags + redirect from rules
        let pipelineOverride = null, stageOverride = null, ruleRedirect = null;
        if (form.rules && form.rules.length) {
          form.rules.forEach(rule => {
            if (evalRule(rule, formData)) {
              (rule.actions || []).forEach(a => {
                if (a.type === 'add_tag' && a.value) contact.tags.push(a.value);
                if (a.type === 'set_pipeline') { pipelineOverride = a.pipeline_id; stageOverride = a.stage_id; }
                if (a.type === 'redirect' && a.value) ruleRedirect = a.value;
              });
            }
          });
        }

        if (cfs.length) contact.customFields = cfs;
        const cRes = await ghlFetch('POST', '/contacts/', form.ghl_key, contact);
        ghl_contact_id = cRes.contact?.id;

        const pid = pipelineOverride || form.ghl_pipeline_id;
        const sid = stageOverride || form.ghl_stage_id;
        if (ghl_contact_id && pid && sid) {
          const oRes = await ghlFetch('POST', '/opportunities/', form.ghl_key, {
            pipelineId: pid, pipelineStageId: sid, locationId: form.ghl_location_id,
            contactId: ghl_contact_id, name: `${contact.firstName || ''} ${contact.lastName || ''} - ${form.name}`.trim(), status: 'open'
          });
          ghl_opportunity_id = oRes.opportunity?.id;
        }
      } catch (e) { console.error('GHL:', e.message); status = 'ghl_error'; }
    }

    // Store submission
    const insertData = { form_id: form.id, data: formData, ghl_contact_id, ghl_opportunity_id, status };
    if (sourceData) insertData.source = sourceData;
    if (sessionId) insertData.session_id = sessionId;

    let sub;
    const { data: s, error: insErr } = await supabase.from('submissions').insert(insertData).select().single();
    if (insErr) {
      // Fallback if source/session_id columns don't exist
      const { data: s2 } = await supabase.from('submissions').insert({
        form_id: form.id, data: { ...formData, _source: sourceData, _session_id: sessionId },
        ghl_contact_id, ghl_opportunity_id, status
      }).select().single();
      sub = s2;
    } else { sub = s; }

    // Evaluate redirect rules (also when GHL is not enabled)
    let redirectUrl = null;
    if (form.rules && form.rules.length) {
      form.rules.forEach(rule => {
        if (evalRule(rule, formData)) {
          (rule.actions || []).forEach(a => {
            if (a.type === 'redirect' && a.value) redirectUrl = a.value;
          });
        }
      });
    }
    // Fallback to default redirect from theme
    if (!redirectUrl && form.theme?.redirectUrl) redirectUrl = form.theme.redirectUrl;

    // Webhook on Submit
    if (form.webhook_url) {
      fireWebhook(form.webhook_url, {
        event: 'form_submission',
        form_id: form.id,
        form_name: form.name,
        submission_id: sub?.id,
        data: formData,
        source: sourceData || null,
        ghl_contact_id,
        ghl_opportunity_id,
        submitted_at: new Date().toISOString(),
      });
    }

    res.json({ success: true, submission_id: sub?.id, status, source: sourceData || null, redirect_url: redirectUrl || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

app.get('/api/public/forms/:id', getPublicForm); app.get('/public/forms/:id', getPublicForm);
app.post('/api/public/submit/:formId', submitForm); app.post('/public/submit/:formId', submitForm);

// ===== PARTIAL SUBMIT (for drop-off tracking) =====
const partialSubmit = async (req, res) => {
  try {
    const { formData, sourceData, sessionId, stepReached, totalSteps } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const insertData = {
      form_id: req.params.formId, data: formData || {}, status: 'partial',
      session_id: sessionId, step_reached: stepReached, total_steps: totalSteps,
    };
    if (sourceData) insertData.source = sourceData;

    // Try insert with all columns, fallback to basic columns
    const { error: insErr } = await supabase.from('submissions').insert(insertData);
    if (insErr) {
      await supabase.from('submissions').insert({
        form_id: req.params.formId, status: 'partial',
        data: { ...(formData || {}), _session_id: sessionId, _step_reached: stepReached, _total_steps: totalSteps, _source: sourceData },
      });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

app.post('/api/public/partial/:formId', partialSubmit); app.post('/public/partial/:formId', partialSubmit);

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

app.get('/api/forms/:id/submissions', ...getSubmissions); app.get('/forms/:id/submissions', ...getSubmissions);

// ===== GHL PROXY =====
app.get('/api/pipelines', async (req, res) => { try { const k = req.headers['x-ghl-key']; const { locationId } = req.query; if (!k || !locationId) return res.status(400).json({ error: 'Missing params' }); res.json(await ghlFetch('GET', `/opportunities/pipelines?locationId=${locationId}`, k)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/contacts', async (req, res) => { try { const k = req.headers['x-ghl-key']; if (!k) return res.status(400).json({ error: 'Missing key' }); res.json(await ghlFetch('POST', '/contacts/', k, req.body)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/opportunities', async (req, res) => { try { const k = req.headers['x-ghl-key']; if (!k) return res.status(400).json({ error: 'Missing key' }); res.json(await ghlFetch('POST', '/opportunities/', k, req.body)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.get('/api/custom-fields', async (req, res) => { try { const k = req.headers['x-ghl-key']; const { locationId } = req.query; if (!k || !locationId) return res.status(400).json({ error: 'Missing params' }); res.json(await ghlFetch('GET', `/locations/${locationId}/customFields`, k)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });

// ===== PUBLIC FORM VIEW (HTML) =====
const renderFormHTML = async (req, res) => {
  try {
    const { data: form, error } = await supabase.from('forms').select('*').eq('id', req.params.id).single();
    if (error || !form) return res.status(404).send('<h1>Form not found</h1>');

    const t = form.theme || {};
    const isDark = (t.mode || 'dark') === 'dark';
    const pc = t.primaryColor || '#6c5ce7';
    const br = t.borderRadius || 10;
    const ff = t.fontFamily || 'Outfit';
    const btnText = escapeHtml(t.buttonText || 'Submit');
    const successMsg = escapeHtml(t.successMessage || 'Thanks! We will be in touch.');
    const steps = form.steps || [];
    const isMultiStep = steps.length > 1;
    const API_BASE = `https://${req.get('host')}`;
    const formName = escapeHtml(form.name);
    const rules = form.rules || [];
    const pixelId = form.pixel_id || '';
    const defaultRedirect = t.redirectUrl || '';

    const bg = isDark ? '#0a0a0f' : '#f5f5fa';
    const cardBg = isDark ? '#0e0e16' : '#ffffff';
    const brd = isDark ? '#1e1e2e' : '#e2e2e8';
    const txH = isDark ? '#e4e4ed' : '#1a1a2e';
    const txM = isDark ? '#9a9ab0' : '#555';
    const txD = isDark ? '#65657a' : '#888';
    const inBg = isDark ? '#12121a' : '#f8f8fc';
    const inBrd = isDark ? '#1e1e2e' : '#e0e0e5';

    const renderField = (f) => {
      const req_attr = f.required ? 'required' : '';
      const ph = escapeHtml(f.placeholder || '');
      const label = escapeHtml(f.label);
      const inputStyle = `width:100%;padding:10px 13px;background:${inBg};border:1px solid ${inBrd};border-radius:${br}px;color:${txH};font-size:14px;font-family:'${ff}',sans-serif;outline:none;transition:border-color .2s;`;
      if (f.type === 'textarea') return `<textarea name="${f.id}" placeholder="${ph}" rows="3" ${req_attr} style="${inputStyle}resize:vertical;"></textarea>`;
      if (f.type === 'select') return `<select name="${f.id}" ${req_attr} style="${inputStyle}"><option value="">${ph || 'Select...'}</option>${(f.options||[]).map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
      if (f.type === 'checkbox') return `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:${txM};cursor:pointer;"><input type="checkbox" name="${f.id}" style="accent-color:${pc};" ${req_attr}/>${ph || label}</label>`;
      return `<input type="${f.type}" name="${f.id}" placeholder="${ph}" ${req_attr} style="${inputStyle}"/>`;
    };

    const stepsHTML = steps.map((s, si) => {
      const fieldsHTML = (s.fields || []).map(f => `
        <div class="fm-field" data-field-id="${f.id}" style="margin-bottom:14px;">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:5px;color:${txM};font-family:'${ff}',sans-serif;">
            ${escapeHtml(f.label)}${f.required ? `<span style="color:${pc};"> *</span>` : ''}
          </label>
          ${renderField(f)}
        </div>
      `).join('');
      return `<div class="fm-step" data-step="${si}" style="display:${si === 0 ? 'block' : 'none'};">${fieldsHTML}</div>`;
    }).join('');

    const stepIndicator = isMultiStep ? `
      <div id="fm-step-indicator" style="display:flex;align-items:center;gap:6px;margin:14px 0 18px;">
        ${steps.map((s, i) => `
          <div style="display:flex;align-items:center;gap:6px;${i < steps.length - 1 ? 'flex:1;' : ''}">
            <div class="fm-dot" data-dot="${i}" style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;background:${i === 0 ? pc : (isDark ? '#1a1a25' : '#eee')};color:${i === 0 ? '#fff' : (isDark ? '#65657a' : '#999')};">${i+1}</div>
            ${i < steps.length - 1 ? `<div style="flex:1;height:2px;background:${brd};border-radius:1px;"></div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    const navButtons = isMultiStep ? `
      <div id="fm-nav" style="display:flex;gap:8px;margin-top:6px;">
        <button type="button" id="fm-back" onclick="fmPrev()" style="display:none;flex:1;padding:11px 0;background:${isDark ? '#1a1a25' : '#eee'};color:${isDark ? '#9a9ab0' : '#555'};border:none;border-radius:${br}px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">Back</button>
        <button type="button" id="fm-next" onclick="fmNext()" style="flex:1;padding:11px 0;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">Next</button>
        <button type="submit" id="fm-submit" style="display:none;flex:1;padding:11px 0;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">${btnText}</button>
      </div>
    ` : `<button type="submit" style="width:100%;padding:11px 0;margin-top:6px;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">${btnText}</button>`;

    // Meta Pixel snippet
    const pixelSnippet = pixelId ? `
    <script>
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init','${escapeHtml(pixelId)}');
      fbq('track','PageView');
    </script>
    <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${escapeHtml(pixelId)}&ev=PageView&noscript=1"/></noscript>
    ` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${formName} | Floumate</title>
  <link href="https://fonts.googleapis.com/css2?family=${ff.replace(/ /g,'+')}:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${pixelSnippet}
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:${bg};padding:20px;font-family:'${ff}',sans-serif;}
    input:focus,textarea:focus,select:focus{border-color:${pc}!important;box-shadow:0 0 0 3px ${pc}20;}
    #fm-success{display:none;text-align:center;padding:40px 20px;}
    #fm-success svg{margin:0 auto 16px;}
    .fm-shake{animation:shake .4s ease-in-out;}
    @keyframes shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}75%{transform:translateX(4px);}}
  </style>
</head>
<body>
  <div style="width:100%;max-width:480px;">
    <div style="background:${cardBg};border:1px solid ${brd};border-radius:${br+4}px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,${isDark?'0.4':'0.06'});">
      <div id="fm-form-content">
        <h3 style="font-size:20px;font-weight:700;margin-bottom:4px;color:${txH};">${formName}</h3>
        ${isMultiStep ? stepIndicator : `<p style="font-size:13px;margin-bottom:22px;color:${txD};">Fill in the details below</p>`}
        <form id="fm-form" onsubmit="return fmSubmit(event)">
          ${stepsHTML}
          ${navButtons}
        </form>
      </div>
      <div id="fm-success">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="${pc}20"/><path d="M15 24l6 6 12-12" stroke="${pc}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h3 style="font-size:18px;font-weight:700;color:${txH};margin-bottom:6px;">${successMsg}</h3>
      </div>
      <p style="text-align:center;margin-top:14px;font-size:10.5px;color:${isDark?'#3e3e52':'#bbb'};">
        Powered by <span style="color:${pc};font-weight:600;">Floumate</span>
      </p>
    </div>
  </div>

  <script>
    var fmStep = 0, fmTotal = ${steps.length}, fmSubmitted = false;
    var fmSid = 'fm_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);

    // ---- Source Detection ----
    function fmGetSource() {
      var p = new URLSearchParams(window.location.search), s = {};
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) { var v = p.get(k); if (v) s[k] = v; });
      var cids = {fbclid:'Meta',ttclid:'TikTok',gclid:'Google',li_fat_id:'LinkedIn',msclkid:'Microsoft',twclid:'Twitter',sccid:'Snapchat',pin_unauth:'Pinterest'};
      for (var k in cids) { if (p.get(k)) { s.click_id = p.get(k); s.click_id_type = k; break; } }
      return Object.keys(s).length ? s : null;
    }
    var fmSource = fmGetSource();

    // ---- Conditional Logic ----
    var fmRules = ${JSON.stringify(rules.filter(r => r.actions && r.actions.some(a => a.type === 'show_field' || a.type === 'hide_field')))};
    function fmEvalRules() {
      var fd = {};
      new FormData(document.getElementById('fm-form')).forEach(function(v,k){fd[k]=v;});
      document.querySelectorAll('#fm-form input[type=checkbox]').forEach(function(cb){fd[cb.name]=cb.checked?'true':'false';});
      fmRules.forEach(function(rule) {
        var val = String(fd[rule.field_id]||''), match = false;
        if (rule.operator==='equals') match = val===rule.value;
        else if (rule.operator==='not_equals') match = val!==rule.value;
        else if (rule.operator==='contains') match = val.toLowerCase().indexOf((rule.value||'').toLowerCase())>-1;
        else if (rule.operator==='is_empty') match = !val;
        else if (rule.operator==='is_not_empty') match = !!val;
        (rule.actions||[]).forEach(function(a) {
          if (a.type==='show_field'||a.type==='hide_field') {
            var el = document.querySelector('.fm-field[data-field-id="'+a.target+'"]');
            if (el) {
              if (a.type==='show_field') { el.style.display = match ? 'block' : 'none'; }
              else { el.style.display = match ? 'none' : 'block'; }
            }
          }
        });
      });
    }
    document.querySelectorAll('#fm-form input,#fm-form select,#fm-form textarea').forEach(function(el){
      el.addEventListener('change',fmEvalRules); el.addEventListener('input',fmEvalRules);
    });
    fmEvalRules();

    // ---- Step Navigation ----
    function fmShowStep(n) {
      document.querySelectorAll('.fm-step').forEach(function(el,i){el.style.display=i===n?'block':'none';});
      document.querySelectorAll('.fm-dot').forEach(function(el,i){
        el.style.background=i===n?'${pc}':'${isDark?'#1a1a25':'#eee'}';
        el.style.color=i===n?'#fff':'${isDark?'#65657a':'#999'}';
      });
      if(fmTotal>1){
        document.getElementById('fm-back').style.display=n>0?'block':'none';
        document.getElementById('fm-next').style.display=n<fmTotal-1?'block':'none';
        document.getElementById('fm-submit').style.display=n===fmTotal-1?'block':'none';
      }
      fmEvalRules();
      ${pixelId ? `if(typeof fbq==='function') fbq('trackCustom','StepView',{form_id:'${form.id}',step:n,form_name:'${escapeHtml(form.name).replace(/'/g,"\\'")}'});` : ''}
    }

    function fmNext() {
      var step=document.querySelector('.fm-step[data-step="'+fmStep+'"]');
      var inputs=step.querySelectorAll('[required]'); var valid=true;
      inputs.forEach(function(inp){
        var wrapper=inp.closest('.fm-field'); if(wrapper&&wrapper.style.display==='none') return;
        if(!inp.value.trim()){inp.style.borderColor='#ff4757';valid=false;}else{inp.style.borderColor='${inBrd}';}
      });
      if(!valid){step.classList.add('fm-shake');setTimeout(function(){step.classList.remove('fm-shake')},400);return;}
      if(fmStep<fmTotal-1){fmStep++;fmShowStep(fmStep);}
    }
    function fmPrev(){if(fmStep>0){fmStep--;fmShowStep(fmStep);}}

    // ---- Partial Submit (drop-off tracking) ----
    function fmGetFormData() {
      var fd = {};
      try { new FormData(document.getElementById('fm-form')).forEach(function(v,k){fd[k]=v;}); } catch(e){}
      document.querySelectorAll('#fm-form input[type=checkbox]').forEach(function(cb){fd[cb.name]=cb.checked;});
      return fd;
    }
    function fmSavePartial() {
      if (fmSubmitted) return;
      var payload = JSON.stringify({formData:fmGetFormData(),sourceData:fmSource,sessionId:fmSid,stepReached:fmStep,totalSteps:fmTotal});
      if (navigator.sendBeacon) { navigator.sendBeacon('${API_BASE}/api/public/partial/${form.id}', new Blob([payload],{type:'application/json'})); }
    }
    window.addEventListener('beforeunload', fmSavePartial);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') fmSavePartial(); });

    // ---- Submit ----
    async function fmSubmit(e) {
      e.preventDefault();
      var fd = fmGetFormData();
      var body = {formData:fd,sessionId:fmSid};
      if(fmSource) body.sourceData = fmSource;
      try {
        var r = await fetch('${API_BASE}/api/public/submit/${form.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(r.ok){
          fmSubmitted = true;
          var res = await r.json();
          ${pixelId ? `if(typeof fbq==='function') fbq('track','Lead',{form_id:'${form.id}',form_name:'${escapeHtml(form.name).replace(/'/g,"\\'")}',source:fmSource?fmSource.platform||'direct':'direct'});` : ''}
          if(window.parent!==window) window.parent.postMessage({type:'floumate-submit',formId:'${form.id}',source:fmSource},'*');
          var redir = res.redirect_url || '${escapeHtml(defaultRedirect)}';
          if(redir){
            setTimeout(function(){ window.location.href = redir; }, 300);
          } else {
            document.getElementById('fm-form-content').style.display='none';
            document.getElementById('fm-success').style.display='block';
          }
        }
      } catch(err){console.error(err);}
      return false;
    }
  </script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { res.status(500).send('<h1>Error loading form</h1>'); }
};

app.get('/api/forms/:id/view', renderFormHTML); app.get('/forms/:id/view', renderFormHTML);

// ===== EMBED SCRIPT =====
const embedScript = (req, res) => {
  const API_BASE = `https://${req.get('host')}`;
  const js = `(function(){
  var el=document.querySelector('[data-floumate-id]')||document.querySelector('[data-form-id]')||document.querySelector('div[id^="floumate-"]')||document.querySelector('div[id^="leadflow-"]');
  if(!el)return;
  var formId=el.getAttribute('data-floumate-id')||el.getAttribute('data-form-id')||el.id.replace('floumate-','').replace('leadflow-','');
  var iframe=document.createElement('iframe');
  var params=window.location.search||'';
  iframe.src='${API_BASE}/forms/'+formId+'/view'+params;
  iframe.style.cssText='width:100%;border:none;min-height:500px;';
  iframe.setAttribute('scrolling','no');
  el.appendChild(iframe);
  window.addEventListener('message',function(e){
    if(e.data&&(e.data.type==='floumate-resize'||e.data.type==='leadflow-resize'))iframe.style.height=e.data.height+'px';
  });
})();`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(js);
};

app.get('/api/embed.js', embedScript); app.get('/embed.js', embedScript);

app.listen(PORT, () => console.log(`Floumate API v4.0.0 on port ${PORT}`));
