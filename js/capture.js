/* ============================================================
   Hawk Eye AI - Business Card Capture Logic
   Handles camera, OCR, form, and Supabase save
   ============================================================ */

// OCR Worker URL - update after deploying the Cloudflare Worker
const OCR_WORKER_URL = 'https://hawkeye-networking-ocr.anthony-419.workers.dev/ocr';

let capturedImageBase64 = null;

// ---- Init ----
(async function init() {
  var session = await Auth.getSession();
  if (!session) {
    window.location.href = 'index.html?returnTo=capture.html';
    return;
  }

  var navEmail = document.getElementById('navUserEmail');
  if (navEmail) navEmail.textContent = session.user.email;

  document.getElementById('logoutBtn').addEventListener('click', function() {
    Auth.signOut();
  });

  document.getElementById('pageLoading').classList.add('hidden');
  document.getElementById('captureContent').classList.remove('hidden');

  initCamera();
  initForm();
  setDefaultDate();
})();

// ---- Camera ----
function initCamera() {
  var cameraBtn = document.getElementById('cameraBtn');
  var fileInput = document.getElementById('cardFileInput');
  var retakeBtn = document.getElementById('retakeBtn');
  var extractBtn = document.getElementById('extractBtn');

  cameraBtn.addEventListener('click', function() {
    fileInput.click();
  });

  fileInput.addEventListener('change', handleImageCapture);
  retakeBtn.addEventListener('click', resetCamera);
  extractBtn.addEventListener('click', extractFromCard);
}

function handleImageCapture(e) {
  var file = e.target.files[0];
  if (!file) return;

  // Resize image to reduce payload size
  var reader = new FileReader();
  reader.onload = function(ev) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxW = 1200;
      var scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      capturedImageBase64 = canvas.toDataURL('image/jpeg', 0.85);

      document.getElementById('cardPreview').src = capturedImageBase64;
      document.getElementById('previewContainer').classList.remove('hidden');
      document.getElementById('cameraUpload').classList.add('hidden');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function resetCamera() {
  capturedImageBase64 = null;
  document.getElementById('cardFileInput').value = '';
  document.getElementById('previewContainer').classList.add('hidden');
  document.getElementById('extractingState').classList.add('hidden');
  document.getElementById('cameraUpload').classList.remove('hidden');
}

// ---- OCR Extraction ----
async function extractFromCard() {
  document.getElementById('previewContainer').classList.add('hidden');
  document.getElementById('extractingState').classList.remove('hidden');

  try {
    var response = await fetch(OCR_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: capturedImageBase64 })
    });

    if (!response.ok) throw new Error('OCR request failed');

    var data = await response.json();
    fillFormFromOCR(data);
    showToast('Card data extracted! Please review the fields below.', 'success');
  } catch (err) {
    console.error('OCR error:', err);
    showToast('Could not read card automatically. Please enter details manually.', 'error');
  } finally {
    document.getElementById('extractingState').classList.add('hidden');
    document.getElementById('previewContainer').classList.remove('hidden');
  }
}

function fillFormFromOCR(data) {
  if (data.first_name) document.getElementById('firstName').value = data.first_name;
  if (data.last_name) document.getElementById('lastName').value = data.last_name;
  if (data.email) document.getElementById('email').value = data.email;
  if (data.phone) document.getElementById('phone').value = data.phone;
  if (data.company) document.getElementById('company').value = data.company;
  if (data.job_title) document.getElementById('jobTitle').value = data.job_title;
  if (data.website) document.getElementById('website').value = data.website;
}

// ---- Form ----
function initForm() {
  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
}

function setDefaultDate() {
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('eventDate').value = today;
}

async function handleSubmit() {
  var firstName = document.getElementById('firstName').value.trim();
  var lastName = document.getElementById('lastName').value.trim();
  var eventName = document.getElementById('eventName').value.trim();
  var eventDate = document.getElementById('eventDate').value;

  if (!firstName || !lastName) {
    showToast('First and last name are required.', 'error');
    return;
  }
  if (!eventName) {
    showToast('Event name is required.', 'error');
    return;
  }

  var email = document.getElementById('email').value.trim();
  var hasEmail = email && email.length > 0;

  var contact = {
    first_name: firstName,
    last_name: lastName,
    email: hasEmail ? email : null,
    phone: document.getElementById('phone').value.trim() || null,
    company: document.getElementById('company').value.trim() || null,
    job_title: document.getElementById('jobTitle').value.trim() || null,
    website: document.getElementById('website').value.trim() || null,
    event_name: eventName,
    event_date: eventDate,
    notes: document.getElementById('notes').value.trim() || null,
    card_image_url: capturedImageBase64 || null,
    status: hasEmail ? 'pending_email' : 'needs_email'
  };

  var submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  try {
    // Save contact
    var result = await supabase
      .from('networking_contacts')
      .insert(contact)
      .select()
      .single();

    if (result.error) throw result.error;
    var saved = result.data;

    // Generate email draft if email exists
    if (hasEmail) {
      await generateEmailDraft(saved);
      showToast('Contact saved! Email draft ready for review.', 'success');
    } else {
      showToast('Contact saved! Flagged for email lookup.', 'success');
    }

    resetForm();
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Contact & Generate Email';
  }
}

// ---- Email Draft Generation ----
async function generateEmailDraft(contact) {
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

  // Update contact status
  await supabase
    .from('networking_contacts')
    .update({ status: 'draft_ready' })
    .eq('id', contact.id);
}

function buildEmailHtml(contact) {
  var props = getIndustryProps(contact);
  var propsHtml = props.map(function(p) {
    return '<p style="font-size:15px;color:#555;line-height:1.5;margin:0 0 8px;padding-left:15px;">&#8226; ' + escapeHtml(p) + '</p>';
  }).join('');

  var companyRef = contact.company ? ' like ' + escapeHtml(contact.company) : '';
  var companyCtaRef = contact.company ? escapeHtml(contact.company) : 'your business';
  var notesLine = contact.notes ? ' I really enjoyed our conversation.' : '';

  return '<!DOCTYPE html>\n' +
'<html>\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>\n' +
'<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">\n' +
'<table role="presentation" width="100%" style="background:#f4f4f4;padding:20px 0;">\n<tr><td align="center">\n' +
'<table role="presentation" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">\n' +

// Header
'<tr><td style="background:linear-gradient(135deg,#0A0A0F 0%,#14141F 100%);padding:30px 40px;text-align:center;">' +
'<img src="https://admin.hawkeyeai.io/assets/optimized/logo-300.png" alt="Hawk Eye AI" width="120" style="display:block;margin:0 auto;">' +
'</td></tr>\n' +

// Body
'<tr><td style="padding:40px;">' +
'<p style="font-size:16px;color:#333;line-height:1.6;margin:0 0 20px;">Hi ' + escapeHtml(contact.first_name) + ',</p>' +
'<p style="font-size:16px;color:#333;line-height:1.6;margin:0 0 20px;">' +
'It was great connecting with you at <strong>' + escapeHtml(contact.event_name) + '</strong>!' + notesLine + '</p>' +
'<p style="font-size:16px;color:#333;line-height:1.6;margin:0 0 20px;">' +
"I'm Anthony, founder of <strong>Hawk Eye AI</strong> - we build custom AI solutions that help businesses" + companyRef + ' automate their operations and scale without scaling headcount.</p>' +

// Value Props
'<table role="presentation" width="100%" style="margin:25px 0;background:#f8f9fa;border-radius:8px;border-left:4px solid #00CCCC;">' +
'<tr><td style="padding:20px 25px;">' +
'<p style="font-size:14px;font-weight:bold;color:#0A0A0F;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;">Here\'s what we can do for you:</p>' +
propsHtml +
'</td></tr></table>' +

'<p style="font-size:16px;color:#333;line-height:1.6;margin:0 0 30px;">' +
"I'd love to show you what we could build for " + companyCtaRef + ". Would you be open to a quick 15-minute call?</p>" +

// CTA
'<table role="presentation" width="100%"><tr><td align="center">' +
'<a href="https://www.hawkeyeai.io/contact" style="display:inline-block;background:linear-gradient(135deg,#00CCCC,#2E8BFF);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Book a Quick Call</a>' +
'</td></tr></table>' +

'<p style="font-size:16px;color:#333;line-height:1.6;margin:30px 0 0;">Looking forward to staying in touch,</p>' +
'</td></tr>\n' +

// Signature
'<tr><td style="padding:0 40px 30px;">' +
'<table role="presentation" width="100%" style="border-top:1px solid #eee;padding-top:20px;"><tr><td>' +
'<p style="font-size:16px;font-weight:bold;color:#0A0A0F;margin:0;">Anthony Kamycki Jr.</p>' +
'<p style="font-size:14px;color:#666;margin:4px 0 0;">Founder, Hawk Eye AI</p>' +
'<p style="font-size:14px;color:#666;margin:4px 0 0;">' +
'<a href="mailto:anthony@hawkeyeai.io" style="color:#00CCCC;text-decoration:none;">anthony@hawkeyeai.io</a>' +
' &nbsp;|&nbsp; ' +
'<a href="https://www.hawkeyeai.io" style="color:#00CCCC;text-decoration:none;">hawkeyeai.io</a></p>' +
'<p style="font-size:14px;color:#666;margin:4px 0 0;">New York, NY</p>' +
'</td></tr></table></td></tr>\n' +

// Footer
'<tr><td style="background:#0A0A0F;padding:20px 40px;text-align:center;">' +
'<p style="font-size:12px;color:#888;margin:0;">Hawk Eye AI - Custom AI Automation for Growing Businesses</p>' +
'<p style="font-size:12px;color:#666;margin:8px 0 0;">New York, NY</p>' +
'</td></tr>\n' +

'</table>\n</td></tr></table>\n</body>\n</html>';
}

function getIndustryProps(contact) {
  var title = (contact.job_title || '').toLowerCase();
  var company = (contact.company || '').toLowerCase();
  var notes = (contact.notes || '').toLowerCase();

  // Real estate
  if (title.includes('real estate') || title.includes('broker') || title.includes('agent') ||
      company.includes('real estate') || company.includes('realty') || notes.includes('real estate')) {
    return [
      'AI chatbots that capture and qualify leads around the clock',
      'Automated showing scheduling and follow-up sequences',
      'Smart lead routing so no prospect falls through the cracks'
    ];
  }

  // Healthcare
  if (title.includes('doctor') || title.includes('medical') || title.includes('health') ||
      company.includes('health') || company.includes('medical') || company.includes('dental') ||
      notes.includes('healthcare') || notes.includes('medical')) {
    return [
      'AI-powered patient intake that reduces front desk workload by 60%',
      'Automated appointment booking and reminders',
      'HIPAA-conscious chatbots for patient FAQ handling'
    ];
  }

  // Legal
  if (title.includes('attorney') || title.includes('lawyer') || title.includes('legal') ||
      company.includes('law') || company.includes('legal') || notes.includes('legal') || notes.includes('law firm')) {
    return [
      'AI-powered client intake that qualifies prospects 24/7',
      'Automated document processing and case routing',
      'Smart scheduling that eliminates back-and-forth emails'
    ];
  }

  // E-commerce
  if (title.includes('ecommerce') || title.includes('e-commerce') || title.includes('retail') ||
      company.includes('shop') || company.includes('store') || notes.includes('ecommerce') || notes.includes('e-commerce')) {
    return [
      'AI customer support that handles order inquiries instantly',
      'Automated product recommendations that boost average order value',
      'Workflow automation for inventory and fulfillment'
    ];
  }

  // Home services
  if (title.includes('contractor') || title.includes('plumber') || title.includes('hvac') ||
      company.includes('plumbing') || company.includes('hvac') || company.includes('roofing') ||
      notes.includes('home service') || notes.includes('contractor')) {
    return [
      'AI receptionist that books jobs and qualifies leads 24/7',
      'Automated follow-up sequences that close more estimates',
      'Workflow automation that eliminates manual scheduling'
    ];
  }

  // Default
  return [
    'AI chatbots that handle customer inquiries 24/7',
    'Workflow automation that saves 20+ hours per week',
    'Custom integrations tailored to your specific business needs'
  ];
}

// ---- Helpers ----
function resetForm() {
  document.getElementById('contactForm').reset();
  resetCamera();
  setDefaultDate();
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast--' + (type || 'success') + ' active';
  setTimeout(function() {
    toast.classList.remove('active');
  }, 4000);
}
