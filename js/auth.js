/* ============================================================
   Hawk Eye AI Dashboard - Auth Module (shared by dashboard.html)
   ============================================================ */

var SUPABASE_URL = 'https://ddoglggqvtdzjtiruomq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkb2dsZ2dxdnRkemp0aXJ1b21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTk5ODQsImV4cCI6MjA4ODMzNTk4NH0.mdog6MhpVGpJTrIkuROb3AdsSLoUEC8Pp7eWG4ysMeE';

var supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch(e) {
  console.error('Supabase init failed:', e);
}

var Auth = {
  getSession: async function() {
    if (!supabase) return null;
    try {
      var result = await supabase.auth.getSession();
      return (result.data && result.data.session) ? result.data.session : null;
    } catch(e) {
      console.error('getSession error:', e);
      return null;
    }
  },

  signOut: async function() {
    if (supabase) await supabase.auth.signOut();
    window.location.href = 'index.html';
  }
};
