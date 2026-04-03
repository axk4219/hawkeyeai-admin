/* ============================================================
   Hawk Eye AI - Networking Follow-ups Dashboard Logic
   ============================================================ */

// n8n webhook for sending approved emails via Gmail
const SEND_EMAIL_URL = 'https://ddoglggqvtdzjtiruomq.supabase.co/functions/v1/send-networking-email';

// ---- State ----
var contacts = [];
var emails = [];
var currentPreviewEmailId = null;
var currentPreviewContactId = null;

// ---- Init ----
(async function initNetworking() {
  var session = await Auth.getSession();
  if (!session) return;

  await loadAllData();
  initTabs();
  initModals();
})();

// ---- Data Loading ----
async function loadAllData() {
  try {
    var results = await Promise.all([
      supabase.from('networking_contacts').select('*').order('created_at', { ascending: false }),
      supabase.from('networking_emails').select('*').order('created_at', { ascending: false })
    ]);

    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;

    contacts = results[0].data || [];
    emails = results[1].data || [];

    renderStats();
    renderPending();
    renderNeedsEmail();
    renderSent();
    updateTabCounts();
  } catch (err) {
    console.error('Failed to load data:', err);
    showToast('Failed to load networking data.', 'error');
  }
}

// ---- Stats ----
function renderStats() {
  var total = contacts.length;
  var pending = contacts.filter(function(c) { return c.status === 'draft_ready'; }).length;
  var needsEmail = contacts.filter(function(c) { return c.status === 'needs_email'; }).length;
  var sent = contacts.filter(function(c) { return c.status === 'sent'; }).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statNeedsEmail').textContent = needsEmail;
  document.getElementById('statSent').textContent = sent;
}

function updateTabCounts() {
  var pending = contacts.filter(function(c) { return c.status === 'draft_ready'; }).length;
  var needs = contacts.filter(function(c) { return c.status === 'needs_email'; }).length;
  var sent = contacts.filter(function(c) { return c.status === 'sent'; }).length;

  document.getElementById('tabPendingCount').textContent = pending;
  document.getElementById('tabNeedsCount').textContent = needs;
  document.getElementById('tabSentCount').textContent = sent;
}

// ---- Tabs ----
function initTabs() {
  var tabs = document.querySelectorAll('.net-tab');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = tab.dataset.tab;
      tabs.forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');

      document.getElementById('tab-pending').classList.add('hidden');
      document.getElementById('tab-needs-email').classList.add('hidden');
      document.getElementById('tab-sent').classList.add('hidden');
      document.getElementById('tab-' + target).classList.remove('hidden');
    });
  });
}

// ---- Pending Review ----
function renderPending() {
  var grid = document.getElementById('pendingGrid');
  var empty = document.getElementById('pendingEmpty');
  var pendingContacts = contacts.filter(function(c) { return c.status === 'draft_ready'; });

  if (pendingContacts.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty.classList.add('hidden');

  grid.innerHTML = pendingContacts.map(function(contact) {
    var email = emails.find(function(e) { return e.contact_id === contact.id && e.status === 'draft'; });
    var subject = email ? escapeHtml(email.subject) : 'No draft generated';

    return '<div class="net-card" data-contact-id="' + contact.id + '">' +
      '<div class="net-card-name">' + escapeHtml(contact.first_name + ' ' + contact.last_name) + '</div>' +
      '<div class="net-card-details">' +
        (contact.company ? '<span class="net-card-detail"><strong>' + escapeHtml(contact.company) + '</strong></span>' : '') +
        (contact.job_title ? '<span class="net-card-detail">' + escapeHtml(contact.job_title) + '</span>' : '') +
      '</div>' +
      '<div class="net-card-event">' + escapeHtml(contact.event_name) + ' - ' + formatDate(contact.event_date) + '</div>' +
      '<div class="net-card-subject">' + subject + '</div>' +
      '<div class="net-card-actions">' +
        '<button class="btn btn-outline btn-small" onclick="openPreviewModal(\'' + contact.id + '\')">Preview</button>' +
        '<button class="btn btn-primary btn-small" onclick="approveEmail(\'' + contact.id + '\')">Approve & Send</button>' +
        '<button class="btn btn-danger btn-small" onclick="rejectEmail(\'' + contact.id + '\')">Reject</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ---- Needs Email ----
function renderNeedsEmail() {
  var list = document.getElementById('needsEmailList');
  var empty = document.getElementById('needsEmailEmpty');
  var needsList = contacts.filter(function(c) { return c.status === 'needs_email'; });

  if (needsList.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');

  list.innerHTML = needsList.map(function(contact) {
    return '<div class="needs-email-card">' +
      '<div class="needs-email-info">' +
        '<div class="needs-email-name">' + escapeHtml(contact.first_name + ' ' + contact.last_name) + '</div>' +
        '<div class="needs-email-meta">' +
          (contact.company ? escapeHtml(contact.company) + ' | ' : '') +
          escapeHtml(contact.event_name) + ' - ' + formatDate(contact.event_date) +
        '</div>' +
      '</div>' +
      '<button class="btn btn-outline btn-small" onclick="openAddEmailModal(\'' + contact.id + '\')">Add Email</button>' +
    '</div>';
  }).join('');
}

// ---- Sent Table ----
function renderSent() {
  var tbody = document.getElementById('sentTableBody');
  var tableWrapper = document.getElementById('sentTableWrapper');
  var empty = document.getElementById('sentEmpty');
  var sentContacts = contacts.filter(function(c) { return c.status === 'sent'; });

  if (sentContacts.length === 0) {
    tableWrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  tableWrapper.classList.remove('hidden');
  empty.classList.add('hidden');

  tbody.innerHTML = sentContacts.map(function(contact) {
    var email = emails.find(function(e) { return e.contact_id === contact.id && e.status === 'sent'; });
    var sentAt = email && email.sent_at ? formatDate(email.sent_at) : '-';

    return '<tr>' +
      '<td class="name-cell">' + escapeHtml(contact.first_name + ' ' + contact.last_name) + '</td>' +
      '<td>' + escapeHtml(contact.company || '-') + '</td>' +
      '<td>' + escapeHtml(contact.event_name) + '</td>' +
      '<td>' + sentAt + '</td>' +
      '<td><button class="btn btn-ghost btn-small" onclick="openPreviewModal(\'' + contact.id + '\')">View</button></td>' +
    '</tr>';
  }).join('');
}

// ---- Actions ----
async function approveEmail(contactId) {
  var email = emails.find(function(e) { return e.contact_id === contactId && e.status === 'draft'; });
  var contact = contacts.find(function(c) { return c.id === contactId; });
  if (!email || !contact) {
    showToast('No draft email found for this contact.', 'error');
    return;
  }

  // Disable the approve button
  var card = document.querySelector('[data-contact-id="' + contactId + '"]');
  if (card) {
    var btn = card.querySelector('.btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  }

  try {
    // Send email first, only update status if it succeeds
    var sendResult = await fetch(SEND_EMAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_id: email.id,
        contact_id: contact.id,
        to: contact.email,
        subject: email.subject,
        body_html: email.body_html,
        contact_name: contact.first_name + ' ' + contact.last_name
      })
    });

    if (!sendResult.ok) {
      var errBody = await sendResult.json().catch(function() { return {}; });
      throw new Error(errBody.details || errBody.error || 'Send failed');
    }

    // Only update statuses after successful send
    await supabase.from('networking_emails').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', email.id);
    await supabase.from('networking_contacts').update({ status: 'sent' }).eq('id', contactId);

    showToast('Email sent to ' + contact.first_name + '!', 'success');
    await loadAllData();
  } catch (err) {
    console.error('Send failed:', err);
    showToast('Failed to send: ' + err.message, 'error');
    if (card) {
      var btn2 = card.querySelector('.btn-primary');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Approve & Send'; }
    }
  }
}

async function rejectEmail(contactId) {
  var email = emails.find(function(e) { return e.contact_id === contactId && e.status === 'draft'; });
  if (!email) return;

  try {
    await supabase.from('networking_emails').update({ status: 'rejected' }).eq('id', email.id);
    await supabase.from('networking_contacts').update({ status: 'pending_email' }).eq('id', contactId);
    showToast('Email rejected.', 'success');
    await loadAllData();
  } catch (err) {
    console.error('Reject failed:', err);
    showToast('Failed to reject: ' + err.message, 'error');
  }
}

// ---- Preview Modal ----
function initModals() {
  // Preview modal
  var previewOverlay = document.getElementById('previewModal');
  document.getElementById('previewClose').addEventListener('click', closePreviewModal);
  previewOverlay.addEventListener('click', function(e) {
    if (e.target === previewOverlay) closePreviewModal();
  });
  document.getElementById('previewApprove').addEventListener('click', function() {
    if (currentPreviewContactId) {
      closePreviewModal();
      approveEmail(currentPreviewContactId);
    }
  });
  document.getElementById('previewReject').addEventListener('click', function() {
    if (currentPreviewContactId) {
      closePreviewModal();
      rejectEmail(currentPreviewContactId);
    }
  });
  document.getElementById('previewEdit').addEventListener('click', handleEditSubject);

  // Add email modal
  var addEmailOverlay = document.getElementById('addEmailModal');
  document.getElementById('addEmailCancel').addEventListener('click', closeAddEmailModal);
  addEmailOverlay.addEventListener('click', function(e) {
    if (e.target === addEmailOverlay) closeAddEmailModal();
  });
  document.getElementById('addEmailSave').addEventListener('click', handleAddEmail);
}

function openPreviewModal(contactId) {
  var contact = contacts.find(function(c) { return c.id === contactId; });
  var email = emails.find(function(e) { return e.contact_id === contactId && (e.status === 'draft' || e.status === 'sent'); });
  if (!contact || !email) return;

  currentPreviewEmailId = email.id;
  currentPreviewContactId = contactId;

  document.getElementById('previewModalTitle').textContent = 'Email to ' + contact.first_name + ' ' + contact.last_name;
  document.getElementById('previewSubject').textContent = email.subject;
  document.getElementById('previewTo').textContent = contact.email;

  // Render HTML email in iframe
  var frame = document.getElementById('previewFrame');
  var iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '450px';
  iframe.style.border = 'none';
  frame.innerHTML = '';
  frame.appendChild(iframe);

  var doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(email.body_html);
  doc.close();

  // Show/hide approve buttons based on email status
  if (email.status === 'sent') {
    document.getElementById('previewApprove').classList.add('hidden');
    document.getElementById('previewReject').classList.add('hidden');
    document.getElementById('previewEdit').classList.add('hidden');
  } else {
    document.getElementById('previewApprove').classList.remove('hidden');
    document.getElementById('previewReject').classList.remove('hidden');
    document.getElementById('previewEdit').classList.remove('hidden');
  }

  document.getElementById('previewModal').classList.add('active');
}

function closePreviewModal() {
  document.getElementById('previewModal').classList.remove('active');
  currentPreviewEmailId = null;
  currentPreviewContactId = null;
}

async function handleEditSubject() {
  if (!currentPreviewEmailId) return;
  var current = document.getElementById('previewSubject').textContent;
  var newSubject = prompt('Edit subject line:', current);
  if (newSubject && newSubject !== current) {
    try {
      await supabase.from('networking_emails').update({ subject: newSubject }).eq('id', currentPreviewEmailId);
      document.getElementById('previewSubject').textContent = newSubject;
      await loadAllData();
      showToast('Subject updated.', 'success');
    } catch (err) {
      showToast('Failed to update subject.', 'error');
    }
  }
}

// ---- Add Email Modal ----
function openAddEmailModal(contactId) {
  var contact = contacts.find(function(c) { return c.id === contactId; });
  if (!contact) return;

  document.getElementById('addEmailContactId').value = contactId;
  document.getElementById('addEmailContactName').textContent = contact.first_name + ' ' + contact.last_name + (contact.company ? ' at ' + contact.company : '');
  document.getElementById('addEmailInput').value = '';
  document.getElementById('addEmailModal').classList.add('active');
  document.getElementById('addEmailInput').focus();
}

function closeAddEmailModal() {
  document.getElementById('addEmailModal').classList.remove('active');
}

async function handleAddEmail() {
  var contactId = document.getElementById('addEmailContactId').value;
  var emailAddress = document.getElementById('addEmailInput').value.trim();

  if (!emailAddress) {
    showToast('Please enter an email address.', 'error');
    return;
  }

  var btn = document.getElementById('addEmailSave');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    // Update contact with email
    var result = await supabase
      .from('networking_contacts')
      .update({ email: emailAddress, status: 'pending_email' })
      .eq('id', contactId)
      .select()
      .single();

    if (result.error) throw result.error;

    // Generate email draft
    await generateEmailDraftFromContact(result.data);

    closeAddEmailModal();
    showToast('Email added and draft generated!', 'success');
    await loadAllData();
  } catch (err) {
    console.error('Add email failed:', err);
    showToast('Failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Generate Draft';
  }
}

async function generateEmailDraftFromContact(contact) {
  var subject = 'Great meeting you at ' + contact.event_name + ', ' + contact.first_name + '!';
  var bodyHtml = buildEmailHtml(contact);

  var result = await supabase
    .from('networking_emails')
    .insert({
      contact_id: contact.id,
      subject: subject,
      body_html: bodyHtml,
      status: 'draft'
    });
  if (result.error) throw result.error;

  await supabase
    .from('networking_contacts')
    .update({ status: 'draft_ready' })
    .eq('id', contact.id);
}

// ---- Email Template Builder (same as capture.js) ----
function buildEmailHtml(contact) {
  var props = getIndustryProps(contact);
  var propsHtml = props.map(function(p) {
    return '<tr><td style="padding:6px 0 6px 0;font-size:15px;color:#A0A0B5;line-height:1.5;"><span style="color:#00FFFF;margin-right:8px;">&#9656;</span>' + escapeHtml(p) + '</td></tr>';
  }).join('');

  var companyRef = contact.company ? ' like ' + escapeHtml(contact.company) : '';
  var companyCtaRef = contact.company ? escapeHtml(contact.company) : 'your business';
  var notesLine = contact.notes ? ' I really enjoyed our conversation.' : '';

  return '<!DOCTYPE html>\n' +
'<html>\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>\n' +
'<body style="margin:0;padding:0;background:#0A0A0F;font-family:Arial,Helvetica,sans-serif;">\n' +
'<table role="presentation" width="100%" style="background:#0A0A0F;padding:20px 0;">\n<tr><td align="center">\n' +
'<table role="presentation" width="600" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;">\n' +
'<tr><td style="background:#0A0A0F;padding:40px 40px 20px;text-align:center;">' +
'<img src="https://www.hawkeyeai.io/admin.hawkeyeai.io/assets/optimized/pwa-icon.jpg" alt="Hawk Eye AI" width="100" style="display:block;margin:0 auto;border-radius:16px;">' +
'</td></tr>\n' +
'<tr><td style="padding:0 40px;"><table role="presentation" width="100%"><tr><td style="height:2px;background:linear-gradient(90deg,#00FFFF,#FF00FF);border-radius:2px;"></td></tr></table></td></tr>\n' +
'<tr><td style="background:#0A0A0F;padding:30px 40px;">' +
'<p style="font-size:17px;color:#F0F0F5;line-height:1.7;margin:0 0 20px;">Hi ' + escapeHtml(contact.first_name) + ',</p>' +
'<p style="font-size:16px;color:#A0A0B5;line-height:1.7;margin:0 0 20px;">' +
'It was great connecting with you at <strong style="color:#F0F0F5;">' + escapeHtml(contact.event_name) + '</strong>!' + notesLine + '</p>' +
'<p style="font-size:16px;color:#A0A0B5;line-height:1.7;margin:0 0 25px;">' +
"I'm Anthony, founder of <strong style=\"color:#00FFFF;\">Hawk Eye AI</strong> - we build custom AI solutions that help businesses" + companyRef + ' automate their operations and scale without scaling headcount.</p>' +
'<table role="presentation" width="100%" style="margin:0 0 25px;background:#14141F;border-radius:10px;border:1px solid #1E1E30;">' +
'<tr><td style="padding:24px 28px;">' +
'<p style="font-size:12px;font-weight:bold;color:#00FFFF;margin:0 0 14px;text-transform:uppercase;letter-spacing:1.5px;">What we can do for you</p>' +
'<table role="presentation" width="100%">' + propsHtml + '</table>' +
'</td></tr></table>' +
'<p style="font-size:16px;color:#A0A0B5;line-height:1.7;margin:0 0 30px;">' +
"I'd love to show you what we could build for <strong style=\"color:#F0F0F5;\">" + companyCtaRef + "</strong>. Would you be open to a quick 15-minute call?</p>" +
'<table role="presentation" width="100%"><tr><td align="center" style="padding:5px 0 30px;">' +
'<a href="https://www.hawkeyeai.io/contact" style="display:inline-block;background:linear-gradient(135deg,#00FFFF 0%,#2E8BFF 50%,#FF00FF 100%);color:#0A0A0F;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Book a Quick Call</a>' +
'</td></tr></table>' +
'<p style="font-size:16px;color:#A0A0B5;line-height:1.7;margin:0;">Looking forward to staying in touch,</p>' +
'</td></tr>\n' +
'<tr><td style="background:#0A0A0F;padding:0 40px 30px;">' +
'<table role="presentation" width="100%" style="border-top:1px solid #1E1E30;padding-top:20px;"><tr>' +
'<td>' +
'<p style="font-size:16px;font-weight:bold;color:#F0F0F5;margin:0;">Anthony Kamycki Jr.</p>' +
'<p style="font-size:14px;color:#A0A0B5;margin:4px 0 0;">Founder, Hawk Eye AI</p>' +
'<p style="font-size:14px;margin:8px 0 0;">' +
'<a href="mailto:anthony@hawkeyeai.io" style="color:#00FFFF;text-decoration:none;">anthony@hawkeyeai.io</a>' +
' <span style="color:#1E1E30;">&nbsp;|&nbsp;</span> ' +
'<a href="https://www.hawkeyeai.io" style="color:#00FFFF;text-decoration:none;">hawkeyeai.io</a></p>' +
'<p style="font-size:13px;color:#606075;margin:4px 0 0;">New York, NY</p>' +
'</td></tr></table></td></tr>\n' +
'<tr><td style="background:#111118;padding:20px 40px;text-align:center;border-top:1px solid #1E1E30;">' +
'<p style="font-size:12px;color:#606075;margin:0;">Hawk Eye AI - Custom AI Automation for Growing Businesses</p>' +
'<p style="font-size:11px;color:#606075;margin:8px 0 0;">New York, NY</p>' +
'</td></tr>\n' +
'</table>\n</td></tr></table>\n</body>\n</html>';
}

function getIndustryProps(contact) {
  var title = (contact.job_title || '').toLowerCase();
  var company = (contact.company || '').toLowerCase();
  var notes = (contact.notes || '').toLowerCase();

  if (title.includes('real estate') || title.includes('broker') || title.includes('agent') ||
      company.includes('real estate') || company.includes('realty') || notes.includes('real estate')) {
    return [
      'AI chatbots that capture and qualify leads around the clock',
      'Automated showing scheduling and follow-up sequences',
      'Smart lead routing so no prospect falls through the cracks'
    ];
  }

  if (title.includes('doctor') || title.includes('medical') || title.includes('health') ||
      company.includes('health') || company.includes('medical') || company.includes('dental') ||
      notes.includes('healthcare') || notes.includes('medical')) {
    return [
      'AI-powered patient intake that reduces front desk workload by 60%',
      'Automated appointment booking and reminders',
      'HIPAA-conscious chatbots for patient FAQ handling'
    ];
  }

  if (title.includes('attorney') || title.includes('lawyer') || title.includes('legal') ||
      company.includes('law') || company.includes('legal') || notes.includes('legal') || notes.includes('law firm')) {
    return [
      'AI-powered client intake that qualifies prospects 24/7',
      'Automated document processing and case routing',
      'Smart scheduling that eliminates back-and-forth emails'
    ];
  }

  if (title.includes('ecommerce') || title.includes('e-commerce') || title.includes('retail') ||
      company.includes('shop') || company.includes('store') || notes.includes('ecommerce') || notes.includes('e-commerce')) {
    return [
      'AI customer support that handles order inquiries instantly',
      'Automated product recommendations that boost average order value',
      'Workflow automation for inventory and fulfillment'
    ];
  }

  if (title.includes('contractor') || title.includes('plumber') || title.includes('hvac') ||
      company.includes('plumbing') || company.includes('hvac') || company.includes('roofing') ||
      notes.includes('home service') || notes.includes('contractor')) {
    return [
      'AI receptionist that books jobs and qualifies leads 24/7',
      'Automated follow-up sequences that close more estimates',
      'Workflow automation that eliminates manual scheduling'
    ];
  }

  return [
    'AI chatbots that handle customer inquiries 24/7',
    'Workflow automation that saves 20+ hours per week',
    'Custom integrations tailored to your specific business needs'
  ];
}

// ---- Helpers ----
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  var d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast--' + (type || 'success') + ' active';
  setTimeout(function() {
    toast.classList.remove('active');
  }, 4000);
}
