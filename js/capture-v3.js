/* ============================================================
   Hawk Eye AI - Business Card Capture Logic
   Handles camera, OCR, form, and Supabase save
   ============================================================ */

// OCR via Supabase Edge Function (Claude Vision) - window.OCR_OVERRIDE_URL set in HTML takes priority
const OCR_WORKER_URL = window.OCR_OVERRIDE_URL || 'https://ddoglggqvtdzjtiruomq.supabase.co/functions/v1/ocr-business-card';

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
    console.log('OCR response:', JSON.stringify(data));
    fillFormFromOCR(data);
    var filledCount = [data.first_name, data.last_name, data.email, data.phone, data.company, data.job_title].filter(Boolean).length;
    if (filledCount > 0) {
      showToast('Extracted ' + filledCount + ' fields! Please review below.', 'success');
    } else {
      showToast('Could not read card clearly. Please enter details manually.', 'error');
    }
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
  // Click handler is on the button's onclick attribute in HTML
  // No addEventListener needed - that caused duplicate submissions
}

function setDefaultDate() {
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('eventDate').value = today;
}

var isSubmitting = false;
async function handleSubmit() {
  if (isSubmitting) return;

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

  isSubmitting = true;

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

    // Email draft is generated server-side by the trg_generate_email_draft trigger
    // (see project.md). Calling generateEmailDraft from the client too caused
    // duplicate drafts because the trigger fires in parallel.
    if (hasEmail) {
      showToast('Contact saved! Email draft will be ready for review in a few seconds.', 'success');
    } else {
      showToast('Contact saved! Flagged for email lookup.', 'success');
    }

    resetForm();
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Contact & Generate Email';
  }
}

// ---- Helpers ----
function resetForm() {
  document.getElementById('contactForm').reset();
  resetCamera();
  setDefaultDate();
}

function showToast(message, type) {
  var toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast toast--' + (type || 'success') + ' active';
  setTimeout(function() {
    toast.classList.remove('active');
  }, 4000);
}
