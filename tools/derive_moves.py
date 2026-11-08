#!/usr/bin/env python3
"""Derive data/moves/<move>.json game parameters for the priority moves from refs/moves skeletons. stdlib only.

    python3 tools/derive_moves.py            writes data/moves/{cross_step,arm_styling,pirouette,push}.json

Every number carries a 'basis' string: '<sample id> <field> <how> f<frame> t<time>'. Peaks use the same main-peak rule
as js/refskel.js mainPeak (median-5 + mean-3 smoothing, half-height width). Reference angles are in the skeleton
convention (knee 0 = straight); the 'game' block converts to rider.js conventions (knee interior, 180 = straight) and
applies Cheney's style rules where the reference disagrees (noted in 'style_override').
Re-run after an import changes a basis sample (tools/import_moves.py lists stale bases).
"""
import json, math, os, statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'refs', 'moves'); OUT = os.path.join(ROOT, 'data', 'moves')


def smooth(v, win=5):
    h = win // 2; m = [st.median(v[max(0, i - h):i + h + 1]) for i in range(len(v))]
    return [sum(m[max(0, i - 1):i + 2]) / len(m[max(0, i - 1):i + 2]) for i in range(len(m))]


class S:
    def __init__(self, move, sid):
        self.id = sid; self.sk = json.load(open(os.path.join(REF, move, sid + '.skeleton.json'), encoding='utf-8'))
        self.ok = [(i, f) for i, f in enumerate(self.sk['frames']) if f['ok']]

    def val(self, f, n):
        a = f['ang']
        if n == 'knee_max': return max(a['knee_L'], a['knee_R'])
        if n == 'arm_abd_max': return max(a['arm_abd_L'], a['arm_abd_R'])
        if n == 'img_facing':   # >0 = she faces the camera (her left shoulder on the image right), <0 = back to camera
            l = f['lm']; tl = math.hypot((l[11][0] + l[12][0] - l[23][0] - l[24][0]) / 2, (l[11][1] + l[12][1] - l[23][1] - l[24][1]) / 2) or 1
            return (l[11][0] - l[12][0]) / tl
        return a[n]

    def curve(self, n): return [i for i, _ in self.ok], [f['t'] for _, f in self.ok], [self.val(f, n) for _, f in self.ok]

    def peak(self, n, mn=False, lo=-9, hi=99):
        I, T, V = self.curve(n); s = smooth([(-v if mn else v) for v in V])
        k = max((j for j in range(len(T)) if lo <= T[j] <= hi), key=lambda j: s[j])
        base = st.median(s); half = base + 0.5 * (s[k] - base); a = b = k
        while a > 0 and s[a - 1] >= half: a -= 1
        while b < len(s) - 1 and s[b + 1] >= half: b += 1
        g = -1 if mn else 1
        return dict(v=round(g * s[k], 1), raw=round(V[k], 1), f=I[k], t=round(T[k], 2), t0=round(T[a], 2), t1=round(T[b], 2))

    def med(self, n, lo, hi):
        I, T, V = self.curve(n); x = [v for t, v in zip(T, V) if lo <= t <= hi]
        return round(st.median(x), 1)

    def at(self, n, frame): return round(self.val(self.sk['frames'][frame], n), 2)

    def B(self, field, p=None, how='main peak', lo=None, hi=None):
        if p is not None: return f"{self.id} ang.{field} {how} f{p['f']} t{p['t']} (smoothed {p['v']}, raw {p['raw']}, half-height {p['t0']}..{p['t1']})"
        return f"{self.id} ang.{field} {how} over t {lo}..{hi}"


def num(v, basis, **kw): return dict(v=v, basis=basis, **kw)


def head(move, best, sk, extra_src=()):
    m = sk.sk
    return {'move': move, 'schema': 'data/moves v1 (style of throwdown.json): every number = {v, basis}; basis = sample id + skeleton field + frame/time',
            'derived_by': 'tools/derive_moves.py from refs/moves (package moves-2026-11-08)',
            'conventions': 'ref angles: knee 0 = straight, torso_lean 0 = upright, arm_abd 0 = arm hanging, elbow 0 = straight (MediaPipe skeleton). game.* knee = interior angle (180 = straight) as in rider.js. t = clip time (0 = user segment start).',
            'best_sample': {'id': best, 'user_score': m['user_score'], 'clip_title': m.get('clip_title'), 'source': m.get('source'), 'src_time': m['src_time'],
                            'view': m.get('view'), 'replay': f'lab.html?ref={move}/{best}'},
            'other_sources': list(extra_src)}


def cross_step():
    s = S('cross_step', 'pro_ARCk35WWnbk_38')
    kL = [p for p in s_peaks(s, 'knee_L', 24, 0.3) if p['t'] < 2.15]; kR = [p for p in s_peaks(s, 'knee_R', 24, 0.3) if p['t'] < 2.15]
    steps = sorted(kL + kR, key=lambda p: p['t'])
    per = round(st.median([b['t'] - a['t'] for a, b in zip(steps, steps[1:]) if b['t'] - a['t'] > 0.2]), 2)
    W = (0.0, 2.1)   # clean part: 2.17 s has a non-ok frame and a detection glitch (f69 knee_R 129.5), 2.2-2.5 is a reach/lean, not a step
    d = head('cross_step', s.id, s)
    d['segment_notes'] = ('2.9 s user segment = ~4 cross-steps walking up the board (vision on the mp4: crossings at ~0.5-0.7, 1.3-1.5, 1.9-2.1 s, feet end near the nose). '
                          't 2.17 is a non-ok frame and f69 a detection glitch (knee_R 129.5, ankle_dy 0.8) — excluded; 2.2-2.5 s torso 40 deg + right arm 90 deg = a reach/lean at the end, not part of the step cycle. '
                          'World-coordinate ankle order along the hip line is too noisy at 45 deg to count crossings (only 3 sign changes); step timing comes from the knee-flexion peaks of the stepping leg.')
    d['stance'] = num('R (goofy)', f'{s.id} view.stance; refskel stance() falls back to the head method (travel = away from camera) — head method over t 0..0.5 votes L 11 / R 3, so the skeleton does NOT confirm goofy: treat front foot as unknown, mirror freely')
    d['ref'] = {
        'step_period_s': num(per, f"{s.id} ang.knee_L/knee_R local peaks >24 deg in t 0..2.1, median spacing; peaks at t {[p['t'] for p in steps]}"),
        'steps_in_segment': num(len(steps), f"{s.id} same peaks (L {len(kL)}, R {len(kR)})"),
        'knee_step_peak_deg': num(round(st.median([p['v'] for p in steps]), 1), f"{s.id} median of those knee peaks (stepping leg lifts)"),
        'knee_support_deg': num(s.med('knee_L', *W), s.B('knee_L', how='median (support / between steps)', lo=W[0], hi=W[1])),
        'knee_other_deg': num(s.med('knee_R', *W), s.B('knee_R', how='median', lo=W[0], hi=W[1])),
        'torso_lean_deg': num(s.med('torso_lean', *W), s.B('torso_lean', how='median', lo=W[0], hi=W[1])),
        'torso_lean_peak_deg': num(s.peak('torso_lean', hi=2.1)['v'], s.B('torso_lean', s.peak('torso_lean', hi=2.1), 'peak within t<=2.1')),
        'arm_abd_lead_peak_deg': num(s.peak('arm_abd_L', hi=2.1)['v'], s.B('arm_abd_L', s.peak('arm_abd_L', hi=2.1), 'main peak (reaching arm)')),
        'arm_abd_L_deg': num(s.med('arm_abd_L', *W), s.B('arm_abd_L', how='median', lo=W[0], hi=W[1])),
        'arm_abd_R_deg': num(s.med('arm_abd_R', *W), s.B('arm_abd_R', how='median', lo=W[0], hi=W[1])),
        'elbow_deg': num(round((s.med('elbow_L', *W) + s.med('elbow_R', *W)) / 2, 1), s.B('elbow_L+elbow_R', how='mean of medians', lo=W[0], hi=W[1])),
        'wrist_span_m': num(s.med('wrist_span', *W), s.B('wrist_span', how='median', lo=W[0], hi=W[1])),
        'ankle_dist_m': num(s.med('ankle_dist', *W), s.B('ankle_dist', how='median (feet close: 0.0-0.3 m)', lo=W[0], hi=W[1])),
    }
    g = d['ref']
    d['game'] = {
        '_': 'proposed rider.js params for the dance cross-step (DANCE_K timing / dance arm targets). Not wired yet.',
        'stepT': num(g['step_period_s']['v'], 'ref.step_period_s'),
        'kneeSupport': num(round(180 - g['knee_support_deg']['v']), '180 - ref.knee_support_deg (interior)'),
        'kneeStepLift': num(round(180 - g['knee_step_peak_deg']['v']), '180 - ref.knee_step_peak_deg: stepping leg at its highest'),
        'torsoLean': num(g['torso_lean_deg']['v'], 'ref.torso_lean_deg (forward lean while walking the board)'),
        'armLeadAbd': num(min(g['arm_abd_lead_peak_deg']['v'], 70), 'ref.arm_abd_lead_peak_deg capped at 70 (Cheney: outside arm about shoulder height, bent elbow, never overhead)', style_override='cap 70'),
        'armTrailAbd': num(g['arm_abd_R_deg']['v'], 'ref.arm_abd_R_deg (trailing arm low)'),
        'elbow': num(g['elbow_deg']['v'], 'ref.elbow_deg (soft elbows)'),
        'footGap': num(g['ankle_dist_m']['v'], 'ref.ankle_dist_m (feet stay close; deck walking)'),
    }
    return d


def s_peaks(s, n, thr, gap):
    I, T, V = s.curve(n); sm = smooth(V); out = []
    for j in range(1, len(sm) - 1):
        if sm[j] >= sm[j - 1] and sm[j] > sm[j + 1] and sm[j] >= thr:
            if out and T[j] - out[-1]['t'] < gap:
                if sm[j] > out[-1]['v']: out[-1] = dict(t=round(T[j], 2), v=round(sm[j], 1), f=I[j])
            else: out.append(dict(t=round(T[j], 2), v=round(sm[j], 1), f=I[j]))
    return out


def pirouette():
    s = S('pirouette', 'pro_ARCk35WWnbk_36')
    tor = s.peak('torso_lean', hi=0.45); pull = s.peak('wrist_span', mn=True, lo=0.45, hi=0.9)
    I, T, Fc = s.curve('img_facing'); sm = smooth(Fc)
    face0 = next(T[j] for j in range(len(T)) if T[j] > 0.3 and sm[j] > 0.3)     # first stably facing the camera = 180 deg into the spin
    sp = (0.4, 1.45)
    d = head('pirouette', s.id, s, ['pro_ARCk35WWnbk_3 (4分, same rider, 2.8 s) for a second look'])
    d['segment_notes'] = ('2.0 s user segment, one 360 deg turn on the board (vision on the mp4: back to camera 0-0.9 s, facing the camera ~1.0-1.5 s, back again by ~1.6-1.9 s). '
                          'The knee main peak (knee_L ~88-126 deg at t 1.6-1.9) is NOT part of the spin: one heel kicks up behind her as she exits (vision sees the RIGHT heel; MediaPipe left/right is unreliable seen from behind, stats.shoulder_facing_flips = 9). '
                          'Use the spin window t 0.4-1.45 for knees. Shoulder yaw from world coords flips sign with the detector, so turn timing comes from image facing (lm shoulder order).')
    d['stance'] = num('L (regular)', f'{s.id} refskel stance(): travel method (向画面左), ankle order in t 0..0.5, 11/11 frames agree with view.stance')
    d['ref'] = {
        'windup_t': num(tor['t'], s.B('torso_lean', tor, 'peak in t<=0.45 (wind-up lean)')),
        'windup_torso_lean_deg': num(tor['v'], s.B('torso_lean', tor, 'peak in t<=0.45')),
        'windup_arm_abd_deg': num(s.med('arm_abd_max', -0.1, 0.1), s.B('arm_abd_max', how='median (arms open before the turn)', lo=-0.1, hi=0.1)),
        'pull_in_t': num(pull['t'], s.B('wrist_span', pull, 'min in t 0.45..0.9 (arms gathered to the chest during the turn; they already close to 0.2-0.3 m at t 0.37-0.6)')),
        'pull_in_wrist_span_m': num(pull['v'], s.B('wrist_span', pull, 'min in t 0.45..0.9')),
        'open_wrist_span_m': num(s.med('wrist_span', 1.0, 1.45), s.B('wrist_span', how='median (arms re-open, facing camera)', lo=1.0, hi=1.45)),
        'half_turn_t': num(face0, f'{s.id} lm shoulder order (img facing = (lm11.x-lm12.x)/torso length, smoothed) first > 0.3 after t 0.3 = she faces the camera = 180 deg'),
        'turn_start_t': num(0.45, f'{s.id} lm shoulder order |facing| falls from ~1.0 (t 0.1) to ~0.1 at t 0.5 — rotation starts ~0.45 (vision: tiles 3-4 of the 6 fps sheet)'),
        'turn_end_t': num(1.6, f'{s.id} vision on the mp4 (back to camera again by ~1.6 s); lm facing flips back at f47-f50 (t 1.47-1.57)'),
        'knee_spin_deg': num(s.med('knee_max', *sp), s.B('knee_max', how='median during the spin', lo=sp[0], hi=sp[1])),
        'knee_spin_min_deg': num(s.peak('knee_max', mn=True, lo=sp[0], hi=sp[1])['v'], s.B('knee_max', s.peak('knee_max', mn=True, lo=sp[0], hi=sp[1]), 'min during the spin (rise)')),
        'torso_spin_deg': num(s.med('torso_lean', *sp), s.B('torso_lean', how='median during the spin (upright)', lo=sp[0], hi=sp[1])),
        'ankle_dist_m': num(s.med('ankle_dist', *sp), s.B('ankle_dist', how='median (feet close at centre)', lo=sp[0], hi=sp[1])),
        'exit_kick_knee_deg': num(s.peak('knee_L', lo=1.5)['v'], s.B('knee_L', s.peak('knee_L', lo=1.5), 'peak after the spin (heel kick on exit; side uncertain)')),
    }
    g = d['ref']; dur = round(g['turn_end_t']['v'] - g['turn_start_t']['v'], 2)
    d['game'] = {
        '_': 'proposed rider.js params for a body pirouette on a rolling board (board keeps its heading). Not wired yet.',
        'spinT': num(dur, 'ref.turn_end_t - ref.turn_start_t (one 360 deg)'),
        'windupT': num(round(g['turn_start_t']['v'] - (-0.1), 2), 'ref.turn_start_t - segment start (-0.1 pad)'),
        'windupLean': num(min(g['windup_torso_lean_deg']['v'], 15), 'ref.windup_torso_lean_deg capped at 15 (Cheney: upright, elegant)', style_override='cap 15'),
        'armsOpenAbd': num(g['windup_arm_abd_deg']['v'], 'ref.windup_arm_abd_deg'),
        'pullInSpan': num(g['pull_in_wrist_span_m']['v'], 'ref.pull_in_wrist_span_m (hands to chest = spin accelerates)'),
        'pullInAt': num(round((g['pull_in_t']['v'] - g['turn_start_t']['v']) / dur, 2), '(ref.pull_in_t - ref.turn_start_t) / spinT: phase of max gather'),
        'reopenSpan': num(g['open_wrist_span_m']['v'], 'ref.open_wrist_span_m'),
        'knee': num(round(180 - g['knee_spin_deg']['v']), '180 - ref.knee_spin_deg (interior)'),
        'kneeRise': num(round(180 - g['knee_spin_min_deg']['v']), '180 - ref.knee_spin_min_deg (tallest moment)'),
        'torso': num(g['torso_spin_deg']['v'], 'ref.torso_spin_deg'),
        'feetGap': num(g['ankle_dist_m']['v'], 'ref.ankle_dist_m'),
        'speedLoss': num(0.1, 'not measurable from the skeleton (no board); docs/moves.md "slows a little" — placeholder, ask exporter for board speed'),
    }
    return d


def push():
    s = S('push', 'pro_ARCk35WWnbk_20')
    sup = s.peak('knee_L'); sup2 = s.peak('knee_L', lo=1.4); tor = s.peak('torso_lean'); rec = s.peak('knee_R', hi=0.4)
    F = s.sk['frames']
    lift = round(F[4]['world'][27][1] - F[4]['world'][28][1], 2)
    d = head('push', s.id, s)
    d['segment_notes'] = ('1.8 s user segment = 2 push strokes with the RIGHT (rear) foot, left foot on the board (vision on the mp4 + skeleton: right ankle reaches forward of the hip and drops to ground level ~0.43-0.5 s, '
                          'moves back relative to the hip until ~0.77 s (world x -0.11 -> +0.58 m, travel = image left), lifts, swings forward again, second contact ~1.5-1.77 s). '
                          'Support (left) knee bend and torso lean peak inside each contact. Recovery swing is HIGH: right ankle 0.30 m above the left at f4 with knee_R ~90 deg.')
    d['stance'] = num('L (regular), pushes with R', f'{s.id} refskel stance(): travel method, 100% agree with view.stance; vision confirms right foot pushes')
    d['ref'] = {
        'cycle_s': num(round(sup2['t'] - sup['t'], 2), f"{s.id} ang.knee_L main peak f{sup['f']} t{sup['t']} -> next support-knee peak f{sup2['f']} t{sup2['t']} (one stroke per cycle)"),
        'contact_t0': num(0.47, f'{s.id} world right ankle y reaches ground level (0.69-0.72 m below hip, = left/board ankle +-0.05) at f16-f18 t 0.43-0.5'),
        'contact_t1': num(0.77, f'{s.id} world right ankle x most rearward +0.58 at f26 t 0.77, then lifts (f30 y 0.48)'),
        'support_knee_peak_deg': num(sup['v'], s.B('knee_L', sup)),
        'support_knee_glide_deg': num(s.med('knee_L', 1.0, 1.4), s.B('knee_L', how='median between strokes', lo=1.0, hi=1.4)),
        'torso_lean_peak_deg': num(tor['v'], s.B('torso_lean', tor)),
        'torso_lean_glide_deg': num(s.med('torso_lean', 1.0, 1.4), s.B('torso_lean', how='median between strokes', lo=1.0, hi=1.4)),
        'recovery_knee_peak_deg': num(rec['v'], s.B('knee_R', rec, 'peak t<=0.4 (push leg recovery)')),
        'recovery_foot_lift_m': num(lift, f'{s.id} world left_ankle.y - right_ankle.y at f4 t{F[4]["t"]} (+y down)'),
        'push_reach_fwd_m': num(round(-F[16]['world'][28][0], 2), f'{s.id} world right_ankle.x at f16 t{F[16]["t"]} (plant point ahead of the hip; travel = -x)'),
        'push_reach_back_m': num(round(F[26]['world'][28][0], 2), f'{s.id} world right_ankle.x at f26 t{F[26]["t"]} (toe-off behind the hip)'),
        'arm_abd_deg': num(s.med('arm_abd_max', 0.4, 0.8), s.B('arm_abd_max', how='median during contact', lo=0.4, hi=0.8)),
        'elbow_deg': num(s.med('elbow_L', 0.4, 0.8), s.B('elbow_L', how='median during contact', lo=0.4, hi=0.8)),
    }
    g = d['ref']
    d['game'] = {
        '_': 'proposed values for rider.js startPush/pushAccel/stateWeights (push cycle T, contact window c0/c1, support knee, lean). Not wired yet.',
        'T': num(g['cycle_s']['v'], 'ref.cycle_s (rider.js now: 1.3 flat / 1.0 uphill)'),
        'c0': num(round(g['contact_t0']['v'] - rec['t'], 2), f"ref.contact_t0 - recovery knee peak t{rec['t']} (cycle start = push foot at its highest; rider.js now: c0 = 0.3*T)"),
        'contactS': num(round(g['contact_t1']['v'] - g['contact_t0']['v'], 2), 'ref.contact_t1 - ref.contact_t0 (rider.js now: clamp(0.6/v, 0.22, 0.45))'),
        'kneeSupport': num(round(180 - min(g['support_knee_peak_deg']['v'], 45)), '180 - ref.support_knee_peak_deg, capped at 45 deg flexion (Cheney: soft knee, long spine, no hunched dig; ref 58 deg)', style_override='cap 45'),
        'kneeGlide': num(round(180 - g['support_knee_glide_deg']['v']), '180 - ref.support_knee_glide_deg'),
        'lean': num(min(g['torso_lean_peak_deg']['v'], 18), 'ref.torso_lean_peak_deg capped at 18 (long spine; ref 29)', style_override='cap 18'),
        'reachFwd': num(g['push_reach_fwd_m']['v'], 'ref.push_reach_fwd_m'),
        'reachBack': num(g['push_reach_back_m']['v'], 'ref.push_reach_back_m'),
        'recoveryLift': num(min(g['recovery_foot_lift_m']['v'], 0.08), 'ref.recovery_foot_lift_m = 0.30 m, capped at 0.08 (rider.js rule: recovery swing low ~5 cm; the reference skater swings high — Cheney to decide)', style_override='cap 0.08'),
    }
    return d


def arm_styling():
    s = S('arm_styling', 'pro_ARCk35WWnbk_10'); t = S('arm_styling', 'pro_EiPZ7dODY0E_1')
    p = s.peak('arm_abd_L'); pt = t.peak('arm_abd_L')
    I, T, V = t.curve('arm_abd_L'); sm = smooth(V)
    base = sm[0]; half = base + 0.5 * (pt['v'] - base)
    rise0 = next(T[j] for j in range(len(T)) if sm[j] > base + 0.1 * (pt['v'] - base)); hold0 = next(T[j] for j in range(len(T)) if sm[j] > pt['v'] - 0.1 * (pt['v'] - base))
    hold1 = max(T[j] for j in range(len(T)) if sm[j] > pt['v'] - 0.1 * (pt['v'] - base)); end = max(T[j] for j in range(len(T)) if sm[j] > half)
    d = head('arm_styling', s.id, s, [f'{t.id} (4分, 0.9 s, oblique, regular) — the best sample is only 0.3 s (the raise itself is ~2 frames), so TIMING comes from this one'])
    d['segment_notes'] = (f'best {s.id}: 0.3 s, front/back camera, left arm jumps from 52 to 127 deg abduction between f1 and f2 (one frame) and drops at f8 — the segment holds the pose, not the motion. '
                          f'{t.id}: rise {rise0}->{hold0} s, hold to {hold1} s, half-way down at {end} s.')
    d['stance'] = num('L (regular)', f'{s.id} refskel stance(): travel method; agrees with view.stance')
    d['ref'] = {
        'arm_up_abd_deg': num(p['v'], s.B('arm_abd_L', p)),
        'arm_up_elbow_deg': num(s.med('elbow_L', p['t0'], p['t1']), s.B('elbow_L', how='median over the arm_abd_L half-height window', lo=p['t0'], hi=p['t1'])),
        'arm_other_abd_deg': num(s.med('arm_abd_R', p['t0'], p['t1']), s.B('arm_abd_R', how='median over the same window', lo=p['t0'], hi=p['t1'])),
        'knee_deg': num(s.med('knee_max', p['t0'], p['t1']), s.B('knee_max', how='median over the same window', lo=p['t0'], hi=p['t1'])),
        'torso_lean_deg': num(s.med('torso_lean', p['t0'], p['t1']), s.B('torso_lean', how='median over the same window', lo=p['t0'], hi=p['t1'])),
        'rise_s': num(round(hold0 - rise0, 2), f'{t.id} ang.arm_abd_L smoothed: 10% -> 90% of (peak {pt["v"]} - start {round(base, 1)}) at t {rise0} -> {hold0}'),
        'hold_s': num(round(hold1 - hold0, 2), f'{t.id} ang.arm_abd_L smoothed above 90%: t {hold0} -> {hold1}'),
        'lower_s': num(round(2 * (end - hold1), 2), f'{t.id} ang.arm_abd_L smoothed: 90% at {hold1} -> 50% at {end}, doubled'),
        'timing_peak_abd_deg': num(pt['v'], t.B('arm_abd_L', pt)),
        'timing_elbow_deg': num(t.med('elbow_L', pt['t0'], pt['t1']), t.B('elbow_L', how='median over its arm_abd_L half-height window', lo=pt['t0'], hi=pt['t1'])),
    }
    g = d['ref']
    d['game'] = {
        '_': 'proposed targets for the rider.js dance-arm raise (act.lz/le/ly targets, eL easing). Not wired yet.',
        'upAbd': num(min(g['arm_up_abd_deg']['v'], 90), 'ref.arm_up_abd_deg capped at 90 = shoulder height (Cheney: outside arm floats to about shoulder height, NEVER overhead; the reference 131 deg is overhead)', style_override='cap 90'),
        'upElbow': num(max(g['arm_up_elbow_deg']['v'], 30), 'ref.arm_up_elbow_deg, floor 30 (bent elbow)'),
        'otherAbd': num(min(g['arm_other_abd_deg']['v'], 35), 'ref.arm_other_abd_deg capped at 35 (inside arm low; never both up)', style_override='cap 35'),
        'riseS': num(g['rise_s']['v'], 'ref.rise_s'),
        'holdS': num(g['hold_s']['v'], 'ref.hold_s'),
        'lowerS': num(g['lower_s']['v'], 'ref.lower_s'),
        'knee': num(round(180 - g['knee_deg']['v']), '180 - ref.knee_deg (body otherwise unchanged)'),
    }
    return d


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for f in (cross_step, arm_styling, pirouette, push):
        d = f(); p = os.path.join(OUT, d['move'] + '.json')
        s = json.dumps(d, ensure_ascii=False, indent=1) + '\n'
        old = open(p, encoding='utf-8').read() if os.path.exists(p) else None
        if old != s:
            open(p, 'w', encoding='utf-8').write(s); print('write', os.path.relpath(p, ROOT))
        else: print('same ', os.path.relpath(p, ROOT))
