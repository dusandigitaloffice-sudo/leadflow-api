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

// ===== PUBLIC FORM VIEW (HTML) =====
const renderFormHTML = async (req, res) => {
  try {
    const { data: form, error } = await supabase.from('forms').select('id, name, steps, theme').eq('id', req.params.id).single();
    if (error || !form) return res.status(404).send('<h1>Form not found</h1>');
    
    const t = form.theme || {};
    const isDark = (t.mode || 'dark') === 'dark';
    const pc = t.primaryColor || '#6c5ce7';
    const br = t.borderRadius || 10;
    const ff = t.fontFamily || 'Outfit';
    const btnText = t.buttonText || 'Submit';
    const successMsg = t.successMessage || 'Thanks! We\\'ll be in touch.';
    const steps = form.steps || [];
    const isMultiStep = steps.length > 1;
    const API_BASE = `https://${req.get('host')}`;

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
      const ph = f.placeholder || '';
      const inputStyle = `width:100%;padding:10px 13px;background:${inBg};border:1px solid ${inBrd};border-radius:${br}px;color:${txH};font-size:14px;font-family:'${ff}',sans-serif;outline:none;transition:border-color .2s;`;
      
      if (f.type === 'textarea') return `<textarea name="${f.id}" placeholder="${ph}" rows="3" ${req_attr} style="${inputStyle}resize:vertical;"></textarea>`;
      if (f.type === 'select') return `<select name="${f.id}" ${req_attr} style="${inputStyle}"><option value="">${ph || 'Select...'}</option>${(f.options||[]).map(o=>`<option value="${o}">${o}</option>`).join('')}</select>`;
      if (f.type === 'checkbox') return `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:${txM};cursor:pointer;"><input type="checkbox" name="${f.id}" style="accent-color:${pc};" ${req_attr}/>${ph || f.label}</label>`;
      return `<input type="${f.type}" name="${f.id}" placeholder="${ph}" ${req_attr} style="${inputStyle}"/>`;
    };

    const stepsHTML = steps.map((s, si) => {
      const fieldsHTML = (s.fields || []).map(f => `
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:13px;font-weight:500;margin-bottom:5px;color:${txM};font-family:'${ff}',sans-serif;">
            ${f.label}${f.required ? `<span style="color:${pc};"> *</span>` : ''}
          </label>
          ${renderField(f)}
        </div>
      `).join('');

      return `<div class="lf-step" data-step="${si}" style="display:${si === 0 ? 'block' : 'none'};">${fieldsHTML}</div>`;
    }).join('');

    // Step indicator
    const stepIndicator = isMultiStep ? `
      <div id="lf-step-indicator" style="display:flex;align-items:center;gap:6px;margin:14px 0 18px;">
        ${steps.map((s, i) => `
          <div style="display:flex;align-items:center;gap:6px;${i < steps.length - 1 ? 'flex:1;' : ''}">
            <div class="lf-dot" data-dot="${i}" style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;background:${i === 0 ? pc : (isDark ? '#1a1a25' : '#eee')};color:${i === 0 ? '#fff' : (isDark ? '#65657a' : '#999')};">${i+1}</div>
            ${i < steps.length - 1 ? `<div style="flex:1;height:2px;background:${brd};border-radius:1px;"></div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    // Navigation buttons
    const navButtons = isMultiStep ? `
      <div id="lf-nav" style="display:flex;gap:8px;margin-top:6px;">
        <button type="button" id="lf-back" onclick="lfPrev()" style="display:none;flex:1;padding:11px 0;background:${isDark ? '#1a1a25' : '#eee'};color:${isDark ? '#9a9ab0' : '#555'};border:none;border-radius:${br}px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">Back</button>
        <button type="button" id="lf-next" onclick="lfNext()" style="flex:1;padding:11px 0;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">Next</button>
        <button type="submit" id="lf-submit" style="display:none;flex:1;padding:11px 0;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">${btnText}</button>
      </div>
    ` : `
      <button type="submit" style="width:100%;padding:11px 0;margin-top:6px;background:${pc};color:#fff;border:none;border-radius:${br}px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:'${ff}',sans-serif;">${btnText}</button>
    `;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${form.name} | LeadFlow</title>
  <link href="https://fonts.googleapis.com/css2?family=${ff.replace(/ /g,'+')}:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:${bg};padding:20px;font-family:'${ff}',sans-serif;}
    input:focus,textarea:focus,select:focus{border-color:${pc}!important;box-shadow:0 0 0 3px ${pc}20;}
    #lf-success{display:none;text-align:center;padding:40px 20px;}
    #lf-success svg{margin:0 auto 16px;}
    .lf-shake{animation:shake .4s ease-in-out;}
    @keyframes shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}75%{transform:translateX(4px);}}
  </style>
</head>
<body>
  <div style="width:100%;max-width:480px;">
    <div style="background:${cardBg};border:1px solid ${brd};border-radius:${br+4}px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,${isDark?'0.4':'0.06'});">
      
      <div id="lf-form-content">
        <h3 style="font-size:20px;font-weight:700;margin-bottom:4px;color:${txH};">${form.name}</h3>
        ${isMultiStep ? stepIndicator : `<p style="font-size:13px;margin-bottom:22px;color:${txD};">Fill in the details below</p>`}
        
        <form id="lf-form" onsubmit="return lfSubmit(event)">
          ${stepsHTML}
          ${navButtons}
        </form>
      </div>

      <div id="lf-success">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="24" fill="${pc}20"/><path d="M15 24l6 6 12-12" stroke="${pc}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h3 style="font-size:18px;font-weight:700;color:${txH};margin-bottom:6px;">${successMsg}</h3>
      </div>
      
      <p style="text-align:center;margin-top:14px;font-size:10.5px;color:${isDark?'#3e3e52':'#bbb'};">
        Powered by <span style="color:${pc};font-weight:600;">LeadFlow</span>
      </p>
    </div>
  </div>

  <script>
    let lfStep = 0;
    const lfTotal = ${steps.length};
    
    function lfShowStep(n) {
      document.querySelectorAll('.lf-step').forEach((el,i) => el.style.display = i===n ? 'block' : 'none');
      document.querySelectorAll('.lf-dot').forEach((el,i) => {
        el.style.background = i===n ? '${pc}' : '${isDark ? '#1a1a25' : '#eee'}';
        el.style.color = i===n ? '#fff' : '${isDark ? '#65657a' : '#999'}';
      });
      if (lfTotal > 1) {
        document.getElementById('lf-back').style.display = n > 0 ? 'block' : 'none';
        document.getElementById('lf-next').style.display = n < lfTotal-1 ? 'block' : 'none';
        document.getElementById('lf-submit').style.display = n === lfTotal-1 ? 'block' : 'none';
      }
    }
    
    function lfNext() {
      const step = document.querySelector('.lf-step[data-step="'+lfStep+'"]');
      const inputs = step.querySelectorAll('[required]');
      let valid = true;
      inputs.forEach(inp => { if (!inp.value.trim()) { inp.style.borderColor='#ff4757'; valid=false; } else { inp.style.borderColor='${inBrd}'; }});
      if (!valid) { step.classList.add('lf-shake'); setTimeout(()=>step.classList.remove('lf-shake'),400); return; }
      if (lfStep < lfTotal-1) { lfStep++; lfShowStep(lfStep); }
    }
    
    function lfPrev() { if (lfStep > 0) { lfStep--; lfShowStep(lfStep); } }
    
    async function lfSubmit(e) {
      e.preventDefault();
      const fd = {};
      new FormData(document.getElementById('lf-form')).forEach((v,k) => fd[k]=v);
      document.querySelectorAll('#lf-form input[type=checkbox]').forEach(cb => { fd[cb.name] = cb.checked; });
      
      try {
        const r = await fetch('${API_BASE}/api/public/submit/${form.id}', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({formData:fd})
        });
        if (r.ok) {
          document.getElementById('lf-form-content').style.display='none';
          document.getElementById('lf-success').style.display='block';
        }
      } catch(e) { console.error(e); }
      return false;
    }
  </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { res.status(500).send('<h1>Error loading form</h1>'); }
};

app.get('/api/forms/:id/view', renderFormHTML);
app.get('/forms/:id/view', renderFormHTML);

// ===== EMBED SCRIPT =====
const embedScript = (req, res) => {
  const API_BASE = `https://${req.get('host')}`;
  const js = `(function(){
  var el = document.querySelector('[data-form-id]') || document.querySelector('div[id^="leadflow-"]');
  if (!el) return;
  var formId = el.getAttribute('data-form-id') || el.id.replace('leadflow-','');
  var iframe = document.createElement('iframe');
  iframe.src = '${API_BASE}/forms/' + formId + '/view';
  iframe.style.cssText = 'width:100%;border:none;min-height:500px;';
  iframe.setAttribute('scrolling','no');
  el.appendChild(iframe);
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'leadflow-resize') iframe.style.height = e.data.height + 'px';
  });
})();`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(js);
};

app.get('/api/embed.js', embedScript);
app.get('/embed.js', embedScript);

app.listen(PORT, () => console.log(`LeadFlow API v2.2 on port ${PORT}`));
