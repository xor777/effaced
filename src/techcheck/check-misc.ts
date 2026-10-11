// K. Misc: Fullscreen (size check behind a button), WebCodecs encoders for capture, document title/favicon channel.
import type { Ctx } from './main.ts';
import { TARGET_W, TARGET_H } from './check-gpu.ts';
import { cadence, errMsg, fmt, rafSamples, sleep } from './util.ts';

export async function checkMisc(c: Ctx) {
  // ---------------------------------------------------------------- fullscreen API presence
  c.add(
    'Fullscreen API',
    `fullscreenEnabled=${document.fullscreenEnabled} · requestFullscreen=${typeof document.documentElement.requestFullscreen === 'function'}`,
    document.fullscreenEnabled ? 'PASS' : 'FAIL',
    'actual fullscreen size: click "Test fullscreen" (needs a gesture)',
  );
  const kb = (navigator as any).keyboard;
  c.add('navigator.keyboard.lock (Esc capture in fullscreen)', kb && typeof kb.lock === 'function' ? 'available' : 'missing', 'INFO');
  c.add('Screen Wake Lock', 'wakeLock' in navigator ? 'available' : 'missing', 'INFO', 'keep display awake for long fixation scenes (S8, S14)');

  // ---------------------------------------------------------------- WebCodecs (for later frame-accurate capture)
  if (typeof VideoEncoder === 'undefined') c.add('WebCodecs VideoEncoder', 'missing', 'WARN');
  else {
    const cfgs: [string, string, number, number, number][] = [
      ['H.264 High L4.2 1920×1080@60', 'avc1.64002A', 1920, 1080, 60],
      ['H.264 High L5.2 3024×1890@60', 'avc1.640034', TARGET_W, TARGET_H, 60],
      ['AV1 Main L4.1 1920×1080@60', 'av01.0.09M.08', 1920, 1080, 60],
      ['AV1 Main L5.1 3024×1890@60', 'av01.0.13M.08', TARGET_W, TARGET_H, 60],
      ['HEVC Main L4.1 1920×1080@60', 'hvc1.1.6.L123.B0', 1920, 1080, 60],
      ['VP9 P0 1920×1080@60', 'vp09.00.41.08', 1920, 1080, 60],
    ];
    for (const [label, codec, width, height, framerate] of cfgs) {
      const res: string[] = [];
      let any = false;
      for (const hw of ['prefer-hardware', 'prefer-software'] as const) {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width, height, framerate, bitrate: 40e6, hardwareAcceleration: hw });
          res.push(`${hw.replace('prefer-', '')}: ${r.supported ? 'yes' : 'no'}`);
          any ||= !!r.supported;
        } catch (e) {
          res.push(`${hw}: ${errMsg(e)}`);
        }
      }
      const vital = codec.startsWith('avc1') || codec.startsWith('av01');
      c.add(`VideoEncoder ${label}`, res.join(' · '), any ? 'PASS' : vital ? 'WARN' : 'INFO', codec);
    }
  }
  if (typeof AudioEncoder !== 'undefined') {
    const res: string[] = [];
    for (const [nm, codec] of [
      ['Opus', 'opus'],
      ['AAC-LC', 'mp4a.40.2'],
    ]) {
      try {
        const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 256000 });
        res.push(`${nm}: ${r.supported ? 'yes' : 'no'}`);
      } catch (e) {
        res.push(`${nm}: ${errMsg(e)}`);
      }
    }
    c.add('AudioEncoder 48 kHz stereo', res.join(' · '), 'INFO', 'muxing the pre-rendered track into the capture');
  }

  // ---------------------------------------------------------------- document as a narrative channel
  const orig = document.title;
  const seq = ['65537', '…', '#FACE'];
  const got: string[] = [];
  for (const s of seq) {
    document.title = s;
    await sleep(60);
    got.push(document.title);
  }
  document.title = orig;
  c.add('document.title swap', got.join(' → '), got.join() === seq.join() ? 'PASS' : 'FAIL', 'eyeball the tab during the run for the visible effect');
  try {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="#BEADED"/></svg>`;
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    c.add('Favicon swap (SVG data URI, #BEADED dot)', 'set', 'PASS', 'eyeball: the tab icon should now be a lilac dot');
  } catch (e) {
    c.add('Favicon swap', errMsg(e), 'FAIL');
  }
  c.add('Page Visibility', `visibilityState=${document.visibilityState}`, 'INFO', 'for the "…" title when the tab is left');
  try {
    const k = '__tc_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    c.add('localStorage (visit counter)', 'writable', 'PASS');
  } catch (e) {
    c.add('localStorage (visit counter)', errMsg(e), 'WARN', 'must be wrapped in try/catch');
  }
}

/** Button handler. Must be invoked synchronously from the click (gesture). */
export function testFullscreen(c: Ctx): Promise<void> {
  const el = document.documentElement;
  const before = { screen: `${screen.width}×${screen.height}`, inner: `${innerWidth}×${innerHeight}` };
  let req: Promise<void>;
  try {
    req = el.requestFullscreen({ navigationUI: 'hide' });
  } catch (e) {
    c.add('requestFullscreen()', errMsg(e), 'FAIL');
    return Promise.resolve();
  }
  return (async () => {
    try {
      await req;
    } catch (e) {
      c.add('requestFullscreen()', errMsg(e), 'FAIL', 'denied (embedded browser / permissions policy?)');
      return;
    }
    await sleep(1200); // macOS fullscreen animation
    const dpr = window.devicePixelRatio;
    const vv = window.visualViewport;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;pointer-events:none;opacity:0.0';
    document.body.appendChild(cv);
    const rect = cv.getBoundingClientRect();
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    const gl = cv.getContext('webgl2');
    const db = gl ? `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}` : 'n/a';
    const r = await rafSamples(1500);
    const cs = cadence(r.stamps);
    cv.remove();
    const innerPx = `${Math.round(innerWidth * dpr)}×${Math.round(innerHeight * dpr)}`;
    const target = innerPx === `${TARGET_W}×${TARGET_H}`;
    c.add(
      'Fullscreen: screen / avail / inner (CSS px)',
      `${screen.width}×${screen.height} / ${screen.availWidth}×${screen.availHeight} / ${innerWidth}×${innerHeight}`,
      'INFO',
      `before: screen ${before.screen}, inner ${before.inner} · visualViewport ${vv ? `${vv.width}×${vv.height}` : 'n/a'} · dpr ${dpr}`,
    );
    c.add(
      'Fullscreen: canvas drawing buffer at 100vw×100vh',
      `${db} (inner×dpr = ${innerPx})`,
      target ? 'PASS' : 'WARN',
      `expect ${TARGET_W}×${TARGET_H} (16:10 below the notch) on the user's Chrome`,
    );
    c.add('Fullscreen: rAF rate', `${fmt(cs.hz, 1)} Hz · σ ${fmt(cs.jitterMs, 2)} ms`, cs.hz > 100 ? 'PASS' : 'INFO');
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  })();
}
