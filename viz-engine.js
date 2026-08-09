/* ==========================================================
   deadbeat0nline — gore visualizer engine
   WebGL flesh-tunnel + VHS degradation, audio reactive.

   Two drive modes:
     'live'    -> Web Audio AnalyserNode (browser, real playback)
     'offline' -> pre-baked FFT frames + manual clock (video render)
   ========================================================== */
(function (global) {
'use strict';

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreb;
uniform float uLevel;
uniform float uBeat;   // decaying 0..1 impulse on kick
uniform float uWarpKick;

/* ---------- noise kit ---------- */
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){
    v += a * vnoise(p);
    p = p * 2.03 + vec2(3.7, 1.9);
    a *= 0.5;
  }
  return v;
}
/* ridged noise -> veins / sinew */
float ridge(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i = 0; i < 4; i++){
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v += a * n * n;
    p = p * 2.11 + vec2(1.3, 4.1);
    a *= 0.5;
  }
  return v;
}

/* ---------- domain warp: the meat ---------- */
vec2 warp(vec2 p, float t, out float fold){
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.06)),
                fbm(p + vec2(5.2, 1.3) - t * 0.05));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.04),
                fbm(p + 3.4 * q + vec2(8.3, 2.8) - t * 0.03));
  /* single octave is plenty here — it only drives the wet sheen */
  fold = vnoise(p + 4.0 * r);
  return r;
}

/* ---------- ornate damask motif fused into the flesh ----------
   odd segment count + slow rotation + noise perturbation, so it
   never resolves into a symmetric Rorschach blot                */
float ornate(vec2 p, float t){
  float a = atan(p.y, p.x) + t * 0.06;
  float r = length(p);
  a += 0.35 * (vnoise(p * 1.7 + t * 0.05) - 0.5);   // break the regularity
  float seg = 5.0;
  a = mod(a, 6.2831853 / seg) - 3.14159265 / seg;
  vec2 k = vec2(cos(a), sin(a)) * r;
  float m = 0.0;
  m += sin(k.x * 20.0 + t * 0.35) * sin(k.y * 26.0 - t * 0.25);
  m += 0.55 * sin(r * 30.0 - t * 0.7);
  m = m * 0.5 + 0.5;
  return smoothstep(0.58, 0.96, m);
}

/* ---------- floating viscera: irregular lumps, never circles ---------- */
float blob(vec2 uv, vec2 c, float rad, float t, float seed){
  vec2  d   = uv - c;
  float ang = atan(d.y, d.x);
  /* radius modulated around the circumference -> torn, organic outline.
     Stacked harmonics rather than fbm: same broken silhouette, ~20x cheaper. */
  float lobe = 0.24 * sin(ang * 2.0 + seed * 11.0 + t * 0.23)
             + 0.17 * sin(ang * 3.0 + seed *  5.0 + t * 0.50)
             + 0.11 * sin(ang * 5.0 - seed *  3.0 - t * 0.31)
             + 0.07 * sin(ang * 8.0 + seed *  7.0 + t * 0.17);
  float rr  = rad * (1.00 + lobe);
  float r   = length(d) / max(rr, 1e-4);
  return 1.0 - smoothstep(0.55, 1.05, r);
}

/* ---------- tonal ramp: black -> clot -> blood -> raw -> fat ---------- */
vec3 fleshPal(float x){
  x = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.006, 0.001, 0.003);
  vec3 b = vec3(0.105, 0.006, 0.012);
  vec3 c = vec3(0.330, 0.024, 0.030);
  vec3 d = vec3(0.660, 0.095, 0.080);
  vec3 e = vec3(0.880, 0.420, 0.330);
  if(x < 0.28) return mix(a, b, x / 0.28);
  if(x < 0.58) return mix(b, c, (x - 0.28) / 0.30);
  if(x < 0.85) return mix(c, d, (x - 0.58) / 0.27);
  return mix(d, e, (x - 0.85) / 0.15);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv   = (frag - 0.5 * uRes) / uRes.y;
  float t   = uTime;

  /* ---- VHS tracking band: a horizontal tear that crawls up ---- */
  float bandY   = fract(t * 0.13);
  float bandD   = abs(fract(uv.y * 0.5 + 0.5 - bandY) - 0.5) * 2.0;
  float band    = smoothstep(0.965, 1.0, 1.0 - bandD);
  float tear    = band * (0.035 + 0.05 * uBeat);

  /* per-scanline horizontal jitter (tape instability) */
  float lineJit = (hash21(vec2(floor(frag.y * 0.7), floor(t * 24.0))) - 0.5);
  float jitter  = lineJit * (0.0022 + 0.010 * uBeat + 0.02 * uWarpKick);

  vec2 suv = uv;
  suv.x += tear * sign(lineJit) + jitter;

  /* ---- breathing: the whole tunnel inhales on the bass ---- */
  float breath = 1.0 + 0.13 * sin(t * 0.9) + 0.30 * uBass + 0.22 * uBeat;
  vec2  puv    = suv / breath;

  /* barrel-ish pull toward the centre so it reads as a throat */
  float rr = length(puv);
  puv *= 1.0 + 0.28 * rr * rr;

  /* ---- flesh: high-frequency so it reads as tissue, not a blob ---- */
  float fold;
  vec2  w = warp(puv * 5.2 + vec2(0.0, -t * 0.11), t, fold);
  float meat = dot(w, vec2(0.78, 0.62));

  /* sinew / capillaries */
  float veins = ridge(puv * 11.0 + w * 3.0 - vec2(0.0, t * 0.18));
  veins = pow(clamp(veins, 0.0, 1.0), 3.0);

  /* damask motif burnt into the tissue */
  float orn = ornate(puv * (1.0 + 0.12 * uMid), t) * smoothstep(1.30, 0.22, rr);

  /* build a single density field, THEN tone-map it -> real contrast */
  float dens = meat * 1.25;
  dens += fold * 0.42;
  dens -= 0.30 * (1.0 - veins);            // crevices go black
  dens += 0.13 * orn;
  dens += 0.16 * (vnoise(puv * 17.0 - t * 0.22) - 0.5); // fine tissue grain
  dens = pow(clamp(dens, 0.0, 1.0), 1.55); // push midtones down

  /* the track opens the tissue up; stays dark and sullen when it's quiet */
  dens *= 0.58 + 0.46 * uBass + 0.26 * uBeat;
  dens += 0.07 * uLevel;

  vec3 col = fleshPal(dens);

  /* wet specular sheen crawling the ridges */
  float sheen = pow(max(fold - 0.60, 0.0) * 2.6, 3.5);
  col += vec3(0.85, 0.62, 0.52) * sheen * (0.10 + 0.30 * uTreb);

  /* faint cold light in the damask so it separates from the meat */
  col += vec3(0.16, 0.03, 0.05) * orn * (0.25 + 0.45 * uTreb);

  /* ---- floating viscera drifting through frame ---- */
  for(int i = 0; i < 4; i++){
    float fi = float(i);
    float sp = 0.10 + fi * 0.045;
    vec2  c  = vec2(
      sin(t * sp + fi * 2.3) * (0.62 + 0.10 * fi),
      cos(t * sp * 0.83 + fi * 1.7) * 0.40
    );
    float b = blob(suv, c, 0.125 + 0.035 * sin(fi * 3.0), t, fi);
    /* reuse the tissue field for each lump's surface instead of new noise */
    float bs = fract(fold * 1.7 + meat * 1.3 + fi * 0.41);
    vec3  bc = fleshPal(0.34 + 0.42 * bs + 0.16 * uBass);
    col = mix(col, bc, b * 0.85);
    /* clotted dark edge, soft so it never reads as an outlined disc */
    float rim = smoothstep(0.02, 0.30, b) * (1.0 - smoothstep(0.30, 0.85, b));
    col = mix(col, vec3(0.014, 0.001, 0.003), rim * 0.40);
  }

  /* ---- centre orifice: dark throat that dilates on the kick ---- */
  float pr = 0.30 + 0.16 * uBeat + 0.09 * uBass;
  float pupil = smoothstep(pr, pr * 0.15, rr);
  col = mix(col, vec3(0.004, 0.001, 0.002), pupil * 0.96);
  /* wet ring catching the light */
  float ring = smoothstep(0.045, 0.0, abs(rr - pr));
  col += vec3(0.72, 0.14, 0.11) * ring * (0.25 + 0.75 * uBeat);

  /* ---- VHS post ---- */
  /* scanlines */
  float scan = 0.86 + 0.14 * sin(frag.y * 3.14159 - t * 30.0);
  col *= scan;
  /* every-other-field darkening */
  col *= 0.90 + 0.10 * step(0.5, fract(frag.y * 0.5));

  /* tape grain */
  float g = hash21(frag + vec2(t * 60.0, t * 37.0));
  col += (g - 0.5) * (0.045 + 0.07 * uBeat);

  /* dropout specks */
  float drop = step(0.9995, hash21(floor(frag * 0.5) + floor(t * 20.0) * 7.13));
  col = mix(col, vec3(0.62, 0.60, 0.58), drop * 0.45);

  /* head-switching noise strip along the very bottom (monochrome, not rainbow) */
  float hs  = smoothstep(0.026, 0.0, frag.y / uRes.y);
  float hsn = hash21(vec2(floor(frag.x * 0.35), floor(t * 30.0)));
  col = mix(col, vec3(hsn * 0.55), hs * 0.80);

  /* vignette: rectangular falloff, so it burns the edges without balling up */
  vec2  vc  = abs(frag / uRes - 0.5) * 2.0;
  float vig = (1.0 - pow(vc.x, 3.2) * 0.72) * (1.0 - pow(vc.y, 3.0) * 0.80);
  col *= clamp(vig, 0.0, 1.0) * 0.92 + 0.08;

  /* crush blacks, lift into that muddy tape gamma */
  col = max(col - 0.012, 0.0);
  col = pow(col, vec3(0.92, 1.02, 1.06));

  gl_FragColor = vec4(col, 1.0);
}
`;

/* chromatic aberration + bleed done as a second pass so the
   RGB split smears the *finished* frame, like a real tape dub */
const FRAG_POST = `
precision highp float;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime;
uniform float uBeat;
uniform float uBass;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c  = uv - 0.5;

  float amt = (0.0022 + 0.0075 * uBeat + 0.0030 * uBass) * (0.35 + length(c) * 1.8);

  /* luma-chroma smear: sample red/blue displaced along x, like composite */
  float r = texture2D(uTex, uv + vec2( amt, 0.0)).r;
  float g = texture2D(uTex, uv).g;
  float b = texture2D(uTex, uv - vec2( amt, 0.0)).b;

  /* horizontal chroma bleed (composite has ~1/4 chroma bandwidth).
     Kept to the CHROMA only so luma detail survives the dub. */
  vec3 bleed = vec3(0.0);
  for(int i = 1; i <= 3; i++){
    float o = float(i) / uRes.x * 2.2;
    bleed += texture2D(uTex, uv - vec2(o, 0.0)).rgb;
  }
  bleed /= 3.0;

  vec3 col  = vec3(r, g, b);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 chroma = mix(col - luma, bleed - dot(bleed, vec3(0.299,0.587,0.114)), 0.62);
  col = clamp(luma + chroma, 0.0, 1.0);

  /* occasional full-frame dub glitch */
  float gl = step(0.9975, hash21(vec2(floor(uTime * 12.0), 3.7)));
  if(gl > 0.5){
    float sh = (hash21(vec2(floor(uv.y * 40.0), floor(uTime * 12.0))) - 0.5) * 0.06;
    col = texture2D(uTex, uv + vec2(sh, 0.0)).rgb;
    col.r = texture2D(uTex, uv + vec2(sh + 0.012, 0.0)).r;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}
function program(gl, vs, fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function Viz(opts){
  opts = opts || {};
  const canvas = opts.canvas;
  // lo-fi internal render scale: looks MORE like tape and runs faster
  const scale  = opts.scale || 0.62;

  const gl = canvas.getContext('webgl', {
    antialias: false, alpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer
  });
  if(!gl) throw new Error('no webgl');

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);

  const progMain = program(gl, VERT, FRAG);
  const progPost = program(gl, VERT, FRAG_POST);

  function bindQuad(prog){
    const loc = gl.getAttribLocation(prog, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  // offscreen target for the main pass
  let tex = gl.createTexture();
  let fbo = gl.createFramebuffer();
  let W = 0, H = 0;

  function resize(){
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.floor(canvas.clientWidth  * dpr * scale));
    const ch = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
    if(cw === W && ch === H) return;
    W = cw; H = ch;
    canvas.width  = Math.max(1, Math.floor(canvas.clientWidth  * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const U = {};
  function u(prog, name){
    const k = prog === progMain ? 'm:' : 'p:';
    if(!(k + name in U)) U[k + name] = gl.getUniformLocation(prog, name);
    return U[k + name];
  }

  const state = { bass:0, mid:0, treb:0, level:0, beat:0, warpKick:0 };

  function draw(time, a){
    resize();
    state.bass  += (a.bass  - state.bass)  * 0.35;
    state.mid   += (a.mid   - state.mid)   * 0.30;
    state.treb  += (a.treb  - state.treb)  * 0.40;
    state.level += (a.level - state.level) * 0.25;
    state.beat   = Math.max(state.beat * 0.86, a.beat || 0);
    state.warpKick = Math.max(state.warpKick * 0.92, a.warpKick || 0);

    // ---- pass 1: the meat, into the low-res target
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progMain);
    bindQuad(progMain);
    gl.uniform2f(u(progMain, 'uRes'), W, H);
    gl.uniform1f(u(progMain, 'uTime'), time);
    gl.uniform1f(u(progMain, 'uBass'), state.bass);
    gl.uniform1f(u(progMain, 'uMid'),  state.mid);
    gl.uniform1f(u(progMain, 'uTreb'), state.treb);
    gl.uniform1f(u(progMain, 'uLevel'),state.level);
    gl.uniform1f(u(progMain, 'uBeat'), state.beat);
    gl.uniform1f(u(progMain, 'uWarpKick'), state.warpKick);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- pass 2: composite-video smear, upscaled to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progPost);
    bindQuad(progPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u(progPost, 'uTex'), 0);
    gl.uniform2f(u(progPost, 'uRes'), canvas.width, canvas.height);
    gl.uniform1f(u(progPost, 'uTime'), time);
    gl.uniform1f(u(progPost, 'uBeat'), state.beat);
    gl.uniform1f(u(progPost, 'uBass'), state.bass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return { draw: draw, gl: gl, state: state };
}

/* ---------- live analyser ---------- */
function LiveAudio(mediaEl){
  const Ctx = global.AudioContext || global.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaElementSource(mediaEl);
  const an  = ctx.createAnalyser();
  an.fftSize = 1024;
  an.smoothingTimeConstant = 0.72;
  src.connect(an);
  an.connect(ctx.destination);
  const bins = new Uint8Array(an.frequencyBinCount);

  let bassAvg = 0, lastBeat = -1e9;

  function band(lo, hi){
    let s = 0, n = 0;
    for(let i = lo; i < hi && i < bins.length; i++){ s += bins[i]; n++; }
    return n ? (s / n) / 255 : 0;
  }

  return {
    ctx: ctx,
    read: function(now){
      an.getByteFrequencyData(bins);
      const bass  = band(1, 8);
      const mid   = band(8, 60);
      const treb  = band(60, 220);
      const level = band(1, 220);

      bassAvg = bassAvg * 0.94 + bass * 0.06;
      let beat = 0;
      if(bass > bassAvg * 1.32 && bass > 0.22 && now - lastBeat > 0.11){
        beat = Math.min(1, (bass - bassAvg) * 3.2);
        lastBeat = now;
      }
      return { bass, mid, treb, level, beat, warpKick: beat > 0.6 ? beat : 0 };
    }
  };
}

/* ---------- offline (pre-baked) ---------- */
function BakedAudio(frames){
  // frames: [{bass,mid,treb,level,beat}] one per rendered video frame
  return {
    read: function(_now, idx){
      return frames[Math.min(idx, frames.length - 1)] || {bass:0,mid:0,treb:0,level:0,beat:0};
    }
  };
}

global.DBVIZ = { Viz, LiveAudio, BakedAudio };

})(window);
