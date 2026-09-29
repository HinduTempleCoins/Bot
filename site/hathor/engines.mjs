// engines.mjs — "Your engines" + "Make it yourself" for Hathor Studio.
//
// The Studio makes images on OUR servers' CPU by default (free). A user can instead plug in their OWN engine:
//   • My own worker — the same worker we run (integrations/genai_cpu_worker.py) on their PC, a Colab, or their
//     Modal GPU (integrations/genai_worker_modal.py). Same /jobs API as ours; they paste its URL + password.
//   • fal.ai key  — GPU FLUX, called straight from the browser with @fal-ai/client.
//   • Gemini key  — Google's image model, called straight from the browser.
// KEYS STAY IN THE USER'S BROWSER (localStorage) and go only to the provider they chose — never to our server.
// /learn/make teaches the whole process (characters -> things -> compose, remakes in three looks) and how to run
// the worker yourself. Pure HTML builders; the server wraps them in pageShell. esc() on every interpolation.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Where users keep provider keys on their ACCOUNT (Pentecaust is the custodian; the Studio never holds a key).
export const CONNECT_ORIGIN = (process.env.PENTECAUST_CONNECT_URL || 'https://connect.pentecaust.com').replace(/\/+$/, '');

export const ENGINES = [
  { id: 'ours', name: 'Hathor Studio (our servers)', cost: 'Free', speed: '~2 min an image (CPU)',
    note: 'The default. Made on our own servers — no key, no account.' },
  { id: 'pentecaust', name: 'My keys on Pentecaust (saved to my account)', cost: 'Whatever your saved provider charges', speed: 'Depends on the provider',
    note: 'Keep your fal / Gemini / own-worker keys in your Pentecaust account. They work on any device, and this site never sees them.' },
  { id: 'worker', name: 'My own worker (PC · Colab · Modal GPU)', cost: 'Your hardware / your Modal credit', speed: '~2 s on a GPU',
    note: 'Run the exact worker we run — characters, remakes and all — on your own machine or GPU, then paste its URL and password.' },
  { id: 'fal', name: 'fal.ai (your key)', cost: 'Pay-per-image on your fal account', speed: '~2–5 s (GPU)',
    note: 'FLUX on fal\'s GPUs. Works right in the browser.' },
  { id: 'gemini', name: 'Google Gemini (your key)', cost: 'Your Google AI Studio quota', speed: '~5–10 s',
    note: 'Google\'s image model, called from your browser with your key.' },
];

export const DOWNLOADS = {
  'genai_cpu_worker.py': 'integrations/genai_cpu_worker.py',
  'genai_worker_modal.py': 'integrations/genai_worker_modal.py',
};

// ── browser runtime shared by /engines and the home-page intercept ─────────────────────────────────
// Everything a page needs to run a generation on the user's chosen engine. No server round-trip.
export const ENGINE_CLIENT_JS = `
var HE = (function(){
  var K='hathor.engines', CONNECT=${JSON.stringify(CONNECT_ORIGIN)};
  function load(){ try{ return JSON.parse(localStorage.getItem(K)||'{}')||{}; }catch(e){ return {}; } }
  function save(c){ try{ localStorage.setItem(K, JSON.stringify(c)); return true; }catch(e){ return false; } }
  function forget(){ try{ localStorage.removeItem(K); }catch(e){} }
  function selected(){ var c=load(); return c.selected||'ours'; }
  function sizeWH(size){ var m=String(size||'').match(/(\\d+)\\s*x\\s*(\\d+)/); return m?{width:+m[1],height:+m[2]}:{width:768,height:768}; }
  function toB64(dataUrl){ return String(dataUrl||'').split(',')[1]||''; }
  var sleep=function(ms){ return new Promise(function(r){ setTimeout(r,ms); }); };
  async function viaWorker(c, job, onStatus){
    var base=String(c.url||'').replace(/\\/+$/,''); if(!base) throw new Error('Add your worker URL on the Engines page.');
    var h={'content-type':'application/json'}; if(c.token) h.authorization='Bearer '+c.token;
    var body={prompt:job.prompt, size:job.size, steps:6}; if(job.image) body.image={base64:toB64(job.image)};
    var s=await fetch(base+'/jobs',{method:'POST',headers:h,body:JSON.stringify(body)});
    var sj=await s.json().catch(function(){return null;});
    if(!s.ok||!sj||!sj.id) throw new Error((sj&&sj.error)||('worker said HTTP '+s.status));
    for(var i=0;i<600;i++){ await sleep(2000);
      var p=await fetch(base+'/jobs/'+encodeURIComponent(sj.id),{headers:h}).then(function(r){return r.json();}).catch(function(){return null;});
      if(!p) continue; if(onStatus) onStatus('Your worker: '+p.status+'…');
      if(p.status==='done'&&p.result&&p.result.base64) return {src:'data:'+(p.result.mime||'image/png')+';base64,'+p.result.base64, note:'your worker ('+p.result.mode+', '+Math.round((p.result.ms||0)/1000)+'s)'};
      if(p.status==='error') throw new Error((p.result&&p.result.error)||'render failed');
    }
    throw new Error('your worker timed out');
  }
  async function viaFal(c, job){
    if(!c.key) throw new Error('Add your fal.ai key on the Engines page.');
    var mod=await import('https://cdn.jsdelivr.net/npm/@fal-ai/client/+esm'); var fal=mod.fal; fal.config({credentials:c.key});
    var wh=sizeWH(job.size), model='fal-ai/flux/schnell', input={prompt:job.prompt, image_size:wh};
    if(job.image){ model='fal-ai/flux/dev/image-to-image'; input={prompt:job.prompt, image_url:job.image, strength:0.85}; }
    var r=await fal.subscribe(model,{input:input}); var im=r&&r.data&&r.data.images&&r.data.images[0];
    if(!im||!im.url) throw new Error('fal returned no image — check your key / credit');
    return {src:im.url, note:'your fal.ai key ('+model+')'};
  }
  async function viaGemini(c, job){
    if(!c.key) throw new Error('Add your Gemini key on the Engines page.');
    var parts=[{text:job.prompt}]; if(job.image) parts.push({inline_data:{mime_type:(job.image.match(/^data:([^;]+)/)||[])[1]||'image/png', data:toB64(job.image)}});
    var r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+(c.model||'gemini-2.5-flash-image')+':generateContent',
      {method:'POST',headers:{'content-type':'application/json','x-goog-api-key':c.key},body:JSON.stringify({contents:[{parts:parts}]})});
    var j=await r.json().catch(function(){return null;});
    if(!r.ok) throw new Error((j&&j.error&&j.error.message)||('Gemini HTTP '+r.status));
    var ps=(j&&j.candidates&&j.candidates[0]&&j.candidates[0].content&&j.candidates[0].content.parts)||[];
    for(var i=0;i<ps.length;i++){ var d=ps[i].inlineData||ps[i].inline_data; if(d&&d.data) return {src:'data:'+(d.mimeType||d.mime_type||'image/png')+';base64,'+d.data, note:'your Gemini key'}; }
    throw new Error('Gemini returned no image (it may have declined the prompt)');
  }
  async function viaPentecaust(c, job){
    if(!c.token) throw new Error('Press "Link Pentecaust" on the Engines page first.');
    if(!c.provider) throw new Error('Pick which of your saved keys to use on the Engines page.');
    var body={provider:c.provider, prompt:job.prompt, size:job.size}; if(job.image) body.image=job.image;
    var r=await fetch(CONNECT+'/v1/genai/image',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.token},body:JSON.stringify(body)});
    var j=await r.json().catch(function(){return null;});
    if(r.status===401) throw new Error('Your Pentecaust link expired — press "Link Pentecaust" again.');
    if(!r.ok||!j||!j.ok) throw new Error((j&&j.reason)||('Pentecaust HTTP '+r.status));
    return {src:j.src, note:j.note+' (kept on Pentecaust)'};
  }
  async function run(job, onStatus){
    var c=load(), id=c.selected||'ours';
    if(id==='pentecaust') return viaPentecaust(c.pentecaust||{}, job);
    if(id==='worker') return viaWorker(c.worker||{}, job, onStatus);
    if(id==='fal') return viaFal(c.fal||{}, job);
    if(id==='gemini') return viaGemini(c.gemini||{}, job);
    throw new Error('ours');
  }
  function fileToDataUrl(f){ return new Promise(function(r){ var rd=new FileReader(); rd.onload=function(){ r(rd.result); }; rd.readAsDataURL(f); }); }
  function linkPentecaust(){ // popup to Pentecaust; it posts back a short-lived "generate images" token
    return new Promise(function(resolve, reject){
      var w=window.open(CONNECT+'/studio-link?origin='+encodeURIComponent(location.origin),'pentecaust','width=520,height=640');
      if(!w) return reject(new Error('Allow pop-ups for this site, then try again.'));
      function on(e){ if(e.origin!==CONNECT||!e.data||e.data.type!=='pentecaust-link') return;
        window.removeEventListener('message',on); resolve({token:e.data.token, account:e.data.account, providers:e.data.providers||[]}); }
      window.addEventListener('message',on);
    });
  }
  return {load:load, save:save, forget:forget, selected:selected, run:run, fileToDataUrl:fileToDataUrl, linkPentecaust:linkPentecaust, CONNECT:CONNECT};
})();`;

// Home page: when the user picked their own engine, run the prompt there instead of posting to our server.
export function homeInterceptScript() {
  return `<script>${ENGINE_CLIENT_JS}
  (function(){
    var form=document.getElementById('genform'); if(!form) return;
    var id=HE.selected(); var names={pentecaust:'your keys on Pentecaust',worker:'your own worker',fal:'your fal.ai key',gemini:'your Gemini key'};
    var badge=document.createElement('p'); badge.className='muted'; badge.style.fontSize='12px';
    badge.innerHTML = id==='ours' ? 'Engine: <b>Hathor Studio (our servers, free)</b> · <a href="/engines">use your own engine</a>'
                                 : 'Engine: <b>'+names[id]+'</b> (runs from your browser) · <a href="/engines">change</a>';
    form.appendChild(badge);
    if(id==='ours') return;
    var out=document.createElement('div'); form.parentNode.insertBefore(out, form.nextSibling);
    form.addEventListener('submit', async function(e){
      e.preventDefault(); e.stopImmediatePropagation();
      var btn=document.getElementById('genbtn'), prompt=(form.prompt&&form.prompt.value||'').trim(); if(!prompt) return;
      var f=document.getElementById('refimg'); f=f&&f.files&&f.files[0];
      var job={prompt:prompt, size:(form.size&&form.size.value)||'768x768', image: f ? await HE.fileToDataUrl(f) : null};
      btn.disabled=true; var ot=btn.textContent; btn.textContent='Generating on '+names[id]+'…'; out.innerHTML='';
      try{ var r=await HE.run(job, function(s){ btn.textContent=s; });
        var card=document.createElement('div'); card.className='card';
        var img=document.createElement('img'); img.src=r.src; img.alt=prompt; img.style.maxWidth='100%'; img.style.borderRadius='10px';
        var p=document.createElement('p'); p.className='muted'; p.style.fontSize='12px';
        p.textContent='Made with '+r.note+'. Not stored on our servers — download it to keep it. ';
        var a=document.createElement('a'); a.href=r.src; a.download='hathor-'+Date.now()+'.png'; a.textContent='download';
        p.appendChild(a); card.appendChild(img); card.appendChild(p); out.appendChild(card);
      }catch(err){ out.innerHTML=''; var m=document.createElement('div'); m.className='card'; m.textContent='Your engine could not make it: '+(err&&err.message||err)+' — fix it on the Engines page, or switch back to ours.'; out.appendChild(m); }
      btn.disabled=false; btn.textContent=ot;
    }, true);
  })();</script>`;
}

// ── /engines ─────────────────────────────────────────────────────────────────────────────────────
export function enginesBody() {
  const rows = ENGINES.map((e) => `<label class=sec style="display:block;cursor:pointer">
      <div class=t><input type=radio name=engine value="${esc(e.id)}"> ${esc(e.name)}</div>
      <div class=d>${esc(e.note)}</div>
      <div class=muted style="font-size:12px;margin-top:6px">Cost: ${esc(e.cost)} · Speed: ${esc(e.speed)}</div></label>`).join('');
  return `<h1>Your engines <span class=muted style="font-size:14px">· make images on ours, or bring your own</span></h1>
    <p class=muted>By default everything is made on <b>our own servers</b>, free. If you have your own GPU, a Modal account, or an
      API key, plug it in here and the Studio's Generate box uses it instead. <b>Your keys stay in this browser</b> and go only
      to the provider you picked — never to our server. New to this? <a href="/learn/make">Learn to make it yourself →</a></p>
    <div class=card><div class=grid>${rows}</div></div>
    <div class=card id=cfg-pentecaust style="display:none"><b>My keys on Pentecaust</b>
      <p class=muted style="font-size:12px">1. Save your keys at <a href="${esc(CONNECT_ORIGIN)}" target=_blank rel=noopener>${esc(CONNECT_ORIGIN.replace('https://', ''))}</a>
        (sign in with MELEK; choose <b>fal</b>, <b>gemini</b> or <b>worker</b>). 2. Press Link. Pentecaust gives this site a 24-hour
        pass to make images with your saved keys. It never gives out the keys.</p>
      <div class=row style="gap:8px;flex-wrap:wrap;align-items:center"><button type=button class=pill id=p-link>Link Pentecaust</button>
        <select class=q id=p-prov style="width:auto"></select><span class=muted id=p-who style="font-size:12px"></span></div></div>
    <div class=card id=cfg-worker style="display:none"><b>My own worker</b>
      <p class=muted style="font-size:12px">The URL of the worker you run (Modal prints it on deploy; on a PC or Colab it's your tunnel URL) and
        the password you set as <code>CPU_SD_TOKEN</code>. Set <code>CPU_SD_CORS=https://hathor.soapbox.community</code> on it so this page may call it.
        <a href="/learn/make#run">How to run it →</a></p>
      <input class=q id=w-url placeholder="https://you--hathor-studio-worker-serve.modal.run" autocomplete=off>
      <input class=q id=w-token type=password placeholder="worker password (CPU_SD_TOKEN)" autocomplete=off style="margin-top:8px"></div>
    <div class=card id=cfg-fal style="display:none"><b>fal.ai key</b>
      <ol class=muted style="font-size:12px;padding-left:18px"><li>Sign up at fal.ai → Dashboard → Keys → create a key.</li><li>Paste it here. It is stored only in this browser.</li></ol>
      <input class=q id=f-key type=password placeholder="fal key" autocomplete=off></div>
    <div class=card id=cfg-gemini style="display:none"><b>Gemini key</b>
      <ol class=muted style="font-size:12px;padding-left:18px"><li>Get a key at aistudio.google.com/apikey.</li><li>Paste it here. It is stored only in this browser.</li></ol>
      <input class=q id=g-key type=password placeholder="Gemini API key" autocomplete=off></div>
    <div class=card>
      <div class=row style="gap:8px;flex-wrap:wrap"><button type=button id=e-save>Save &amp; use this engine</button>
        <button type=button class=pill id=e-test>Test it</button><button type=button class=pill id=e-forget>Forget my keys</button></div>
      <p class=muted id=e-status style="font-size:12px;margin-top:8px"></p><div id=e-out></div></div>
    <div class=card><p class=muted style="font-size:13px"><b>Want your keys on every device?</b> Choose "My keys on Pentecaust". Your keys are
      kept encrypted in your Pentecaust account. Keys typed into the other options stay in this browser only. This site never stores a provider key.</p></div>
    <script>${ENGINE_CLIENT_JS}
    (function(){
      var $=function(s){return document.querySelector(s);}; var c=HE.load();
      var pick=c.selected||'ours'; var radios=document.querySelectorAll('input[name=engine]');
      function show(){ ['pentecaust','worker','fal','gemini'].forEach(function(k){ $('#cfg-'+k).style.display = pick===k?'':'none'; }); }
      radios.forEach(function(r){ if(r.value===pick) r.checked=true; r.addEventListener('change',function(){ pick=r.value; show(); }); });
      $('#w-url').value=(c.worker&&c.worker.url)||''; $('#w-token').value=(c.worker&&c.worker.token)||'';
      $('#f-key').value=(c.fal&&c.fal.key)||''; $('#g-key').value=(c.gemini&&c.gemini.key)||''; show();
      var pc=c.pentecaust||{};
      function fillProv(){ var sel=$('#p-prov'); sel.innerHTML=''; (pc.providers||[]).forEach(function(p){ var o=document.createElement('option'); o.value=p; o.textContent=p; if(p===pc.provider) o.selected=true; sel.appendChild(o); });
        $('#p-who').textContent = pc.account ? ('linked as @'+pc.account+((pc.providers||[]).length?'':' — no image keys saved there yet')) : 'not linked'; }
      fillProv();
      $('#p-link').addEventListener('click', async function(){ try{ var l=await HE.linkPentecaust(); pc={token:l.token, account:l.account, providers:l.providers, provider:l.providers[0]||''}; fillProv(); $('#e-status').textContent='Linked to Pentecaust as @'+l.account+'.'; }catch(err){ $('#e-status').textContent=err.message||String(err); } });
      function collect(){ pc.provider=$('#p-prov').value||pc.provider||''; return {selected:pick, pentecaust:pc, worker:{url:$('#w-url').value.trim(), token:$('#w-token').value.trim()},
        fal:{key:$('#f-key').value.trim()}, gemini:{key:$('#g-key').value.trim()}}; }
      $('#e-save').addEventListener('click',function(){ $('#e-status').textContent = HE.save(collect()) ? 'Saved. The Generate box now uses: '+pick+'.' : 'This browser blocks storage — the engine can\\'t be remembered here.'; });
      $('#e-forget').addEventListener('click',function(){ HE.forget(); ['#w-url','#w-token','#f-key','#g-key'].forEach(function(s){ $(s).value=''; }); pick='ours'; radios.forEach(function(r){ r.checked=r.value==='ours'; }); show(); $('#e-status').textContent='Keys removed from this browser. Back to our servers.'; });
      $('#e-test').addEventListener('click', async function(){
        if(pick==='ours'){ $('#e-status').textContent='Ours needs no setup — just use the Generate box.'; return; }
        HE.save(collect()); $('#e-status').textContent='Testing…'; $('#e-out').innerHTML='';
        try{ var r=await HE.run({prompt:'a blue lotus flower floating on still water, soft morning light', size:'512x512'}, function(s){ $('#e-status').textContent=s; });
          $('#e-status').textContent='It works — made with '+r.note+'.'; var i=document.createElement('img'); i.src=r.src; i.style.maxWidth='256px'; i.style.borderRadius='8px'; $('#e-out').appendChild(i);
        }catch(err){ $('#e-status').textContent='Not working yet: '+(err&&err.message||err); }
      });
    })();</script>`;
}

// ── /learn/make ──────────────────────────────────────────────────────────────────────────────────
export function learnBody() {
  return `<h1>Make it yourself <span class=muted style="font-size:14px">· how Hathor's images are really made</span></h1>
    <p class=muted>Good images are not one lucky prompt. They are built: <b>characters</b>, then <b>things</b>, then the
      <b>scene</b>, composed together. Everything below runs on this site for free, and every step can also run on your own machine.</p>
    <h2>1 · Make the character</h2>
    <div class=card><p>Start from a reference picture of the character: a face, an outfit, a sketch. On the <a href="/">Generate</a> box, attach it with
      <b>📎 Upload a photo</b> and describe a <i>new</i> scene. The engine keeps who they are and draws them into the new shot. This is not pasting;
      the character is generated into the scene. Keep what never changes (for Hathor: her horns, wings and visor) and let the rest vary: clothes, hair, jewellery.</p></div>
    <h2>2 · Make the things</h2>
    <div class=card><p>Objects and places are made on their own first, on a plain backdrop or as empty landscapes: a wax headcone, an incense stand,
      a litter, the harbour of Carthage. Then they can be reused in any scene. Try a prompt that ends with <i>"plain backdrop, photorealistic"</i>.</p></div>
    <h2>3 · Compose the scene</h2>
    <div class=card><p>Put characters and things together on the <a href="/compose">Reference Studio</a>: upload the character, the objects and the place, tag each, and generate them as one image.</p></div>
    <h2>4 · Remake history in three looks</h2>
    <div class=card><p>A tomb painting, a stele or a fresco can be remade while keeping its layout: the same people, poses and composition, in a new look.
      We do every scene three ways: <b>realistic</b> (as it would have looked), <b>half vaporwave</b>, and the <b>full MELEK aesthetic</b>.
      We also render each scene with several peoples (Egyptian, Nubian, Libyan, Levantine and more), because the ancient world was all of them.</p></div>
    <h2 id=run>5 · Run the engine yourself</h2>
    <div class=card>
      <p>The engine behind this site is one Python file, <a href="/downloads/genai_cpu_worker.py">genai_cpu_worker.py</a>.
        Run it anywhere, then plug it in on <a href="/engines">Your engines</a>.</p>
      <p><b>On your own computer</b> (a GPU is fast; a CPU works but takes about 2 minutes an image):</p>
      <pre style="white-space:pre-wrap;font-size:12px">pip install torch diffusers transformers accelerate peft compel opencv-python-headless pillow
CPU_SD_TOKEN=pick-a-password CPU_SD_CORS=https://hathor.soapbox.community \\
CPU_SD_DEVICE=cuda PORT=8510 HOST=127.0.0.1 python genai_cpu_worker.py      # cuda = NVIDIA · mps = Mac · cpu = anything</pre>
      <p>Then on Your engines, use <code>http://127.0.0.1:8510</code> and your password.</p>
      <p><b>On a free Colab GPU:</b> run the same two lines in a notebook with <code>CPU_SD_DEVICE=cuda</code>, then open a tunnel with
        <code>cloudflared tunnel --url http://127.0.0.1:8510</code> and paste the https URL it prints.</p>
      <p><b>On your own Modal GPU</b> (about 2 seconds an image; you pay Modal for GPU time, and new accounts get monthly credit):
        download <a href="/downloads/genai_worker_modal.py">genai_worker_modal.py</a> next to the worker, then:</p>
      <pre style="white-space:pre-wrap;font-size:12px">pip install modal && modal setup
modal secret create hathor-worker CPU_SD_TOKEN=pick-a-password
modal deploy genai_worker_modal.py</pre>
      <p>Modal prints your URL. Paste it and the password on <a href="/engines">Your engines</a>.</p>
      <p><b>Or just use a key:</b> a fal.ai or Gemini key works right in your browser with no install. Add it on <a href="/engines">Your engines</a>.</p>
    </div>
    <p class=muted>Deeper guides: the <a href="/school">GenAI School</a> (ComfyUI, Hugging Face, Civitai) and the <a href="/tools">tools list</a>.</p>`;
}

export default { ENGINES, DOWNLOADS, ENGINE_CLIENT_JS, homeInterceptScript, enginesBody, learnBody };
