// EFFACED — entry: setup → loader (music render + shader compile) → demo.
// Dev: ?go skips the setup screen (click/space to start audio), ?scene=S08 / ?pos=0F&row=0 / ?t=… jump.

import { runSetup, type SetupResult, type SoundDevice } from './boot/setup.ts';
import { startLoader } from './boot/loader.ts';
import { Demo } from './demo.ts';
import { Clock } from './timeline/clock.ts';
import { DURATION, SCRIPT, cueStart } from './timeline/script.ts';
import { renderMusic } from './timeline/music.ts';
import { devUI, startTimeFromUrl } from './dev/devui.ts';

const DEV = import.meta.env.DEV;
const q = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;

// the document is a channel of the story too (PLAN §8)
document.title = 'EFFACED';
console.log('%cFA CA DE · DE CA DE · EF FA CE D', 'color:#decade;font:12px ui-monospace');

async function main() {
  const skip = DEV && (q.has('go') || q.has('scene') || q.has('pos') || q.has('t') || q.has('bench'));

  // The context can be created before any gesture (it stays suspended until START resumes it), so
  // the offline music render starts right away, hidden behind the setup screen.
  const ctx = new AudioContext({ latencyHint: 'playback' });
  let pa = 0;
  let onMusic: (label: string) => void = () => {};
  const render = (device: SoundDevice) =>
    renderMusic(ctx.sampleRate, device, (p) => {
      pa = p;
      onMusic('rendering music');
    }).catch((e) => {
      console.error('[music] render failed', e);
      return null;
    });
  let music = render('webaudio');

  const setup: SetupResult = skip
    ? { height: 0, quality: 1, sound: 'webaudio', fullscreen: false }
    : await runSetup($('setup'));

  // START was the user gesture: sound + fullscreen now
  ctx.resume().catch(() => {});
  if (setup.fullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
  if (setup.sound !== 'webaudio') {
    pa = 0;
    music = render(setup.sound); // the GUS / SB16 joke modes need their own render
  }

  const clock = new Clock(DURATION);
  let demo: Demo;
  try {
    demo = new Demo($('gl') as HTMLCanvasElement, clock, { height: setup.height, quality: setup.quality });
  } catch (e) {
    $('setup').hidden = false;
    $('setup').className = 'textmode';
    $('setup').innerHTML = `<div class="ln"><span class="tw">${(e as Error).message}</span></div>`;
    throw e;
  }

  const loader = skip ? null : startLoader($('loader'));
  let pg = 0, pw = 0;
  const report = (label: string) => loader?.progress(pa * 0.7 + pg * 0.15 + pw * 0.15, label);
  onMusic = report;
  const [audio] = await Promise.all([
    music,
    demo
      .compile((d, n) => {
        pg = d / n;
        report('compiling shaders');
      })
      .then(() =>
        demo.warmup((d, n) => {
          pw = d / n;
          report('building pipelines');
        }),
      ),
  ]);
  pa = 1;
  report('');

  demo.audio = audio;
  if (audio) {
    // GUS / SB16 modes render at their own rate (38.6 / 22.05 kHz); the browser resamples on playback
    const buf = ctx.createBuffer(2, audio.left.length, audio.sampleRate);
    buf.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
    clock.attach(ctx, buf);
  } else clock.attach(ctx, null);

  await loader?.finish();
  // from the cut to white (S15) the tab is '#FACE'
  const faceAt = cueStart(SCRIPT.find((c) => c.scene === 'S15')!);
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? '…' : clock.time() >= faceAt ? '#FACE' : 'EFFACED';
  });

  if (DEV || q.has('dev')) {
    devUI(demo);
    const st = startTimeFromUrl();
    demo.solo = st.solo;
    clock.seek(st.t);
  }
  if (DEV) (window as unknown as { __demo: Demo }).__demo = demo;
  if (DEV && q.has('bench')) {
    // performance sweep instead of the show: nothing is played (see dev/bench.ts)
    const { runBench } = await import('./dev/bench.ts');
    return runBench(demo, q.get('bench'));
  }
  demo.start();
  if (ctx.state === 'running') clock.play();
  else {
    // no gesture yet (dev ?go): first click or key starts the sound
    const go = () => {
      ctx.resume().then(() => clock.play());
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }
}

main();
