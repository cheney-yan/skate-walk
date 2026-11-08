#!/usr/bin/env python3
"""Import a motion-reference handoff package into refs/moves/ (contract: refs/moves/CONTRACT.md). stdlib only.

    python3 tools/import_moves.py <package_dir> [--accept-contract] [--dry-run] [--repo DIR]

Steps (CONTRACT.md §5):
  1. run <package>/validate_handoff.py <package>            non-zero -> abort
  2. diff <package>/CONTRACT.md vs refs/moves/CONTRACT.md   differs -> stop, unless --accept-contract
     (first import: the package's copy is installed)
  3. compare with the previously imported samples (refs/moves/index.json):
       new / changed (src_time | user_score | label | file content) / removed (absent from this package =
       the user lowered the score or disabled it -> local files deleted; data/moves/*.json entries that
       reference a removed sample are listed — those numbers need a new basis sample)
  4. copy skeletons, summaries, mp4s (mp4s are .gitignored), delete removed, merge index.json
     (dedup by sample id, records the imported package list)
  5. regenerate the 参考样本 table in docs/moves.md (between <!-- REFS:BEGIN --> / <!-- REFS:END -->)
  6. write refs/moves/IMPORT_REPORT.md (package, accepted/rejected samples + reasons, measured data quality,
     coverage, requests to the exporter). The hand-written block between <!-- MANUAL:BEGIN --> and
     <!-- MANUAL:END --> is kept across runs.
Idempotent: re-running the same package changes nothing (files are only written when their content differs).
Exit codes: 0 ok, 1 validation/IO failure, 2 contract differs, 3 unsupported version.
"""
import argparse, difflib, hashlib, json, math, os, re, shutil, statistics as st, subprocess, sys

SUPPORTED_MAJOR = 1
ANG = ('knee_L', 'knee_R', 'hip_L', 'hip_R', 'elbow_L', 'elbow_R', 'arm_abd_L', 'arm_abd_R', 'torso_lean', 'ankle_dy', 'ankle_dist', 'wrist_span', 'hip_h')
PRIORITY = ('cross_step', 'arm_styling', 'pirouette', 'push')
CAMS = (('斜侧', '斜侧45°'), ('侧面', '侧面'), ('正对', '正/背面'))
# quality gates for copying angles into game parameters (contract §4.5 + our own measured gates)
GATE_OK_RATIO = 0.85      # share of frames with a detection
GATE_BONE_CV = 12.0       # % variation of thigh/shin length over the clip: above = world coords unreliable
GATE_SHORT = 0.5          # s: shorter user segments rarely contain one full cycle of a step / spin / push


def die(msg, code=1):
    print('IMPORT FAILED: ' + msg, file=sys.stderr); sys.exit(code)


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def jload(p):
    with open(p, encoding='utf-8') as f: return json.load(f)


def jdump(o):
    return json.dumps(o, ensure_ascii=False, indent=1) + '\n'


class Writer:
    """writes only when content differs; remembers what it did"""
    def __init__(self, dry): self.dry, self.log = dry, []

    def text(self, p, s):
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                if f.read() == s: return False
        self.log.append('write ' + p)
        if not self.dry:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p + '.tmp', 'w', encoding='utf-8') as f: f.write(s)
            os.replace(p + '.tmp', p)
        return True

    def copy(self, src, dst):
        if os.path.exists(dst) and sha(src) == sha(dst): return False
        self.log.append('copy ' + dst)
        if not self.dry:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst + '.tmp'); os.replace(dst + '.tmp', dst)
        return True

    def rm(self, p):
        if not os.path.exists(p): return False
        self.log.append('delete ' + p)
        if not self.dry: os.remove(p)
        return True


def major(v):
    m = re.match(r'(\d+)\.', str(v) + '.')
    return int(m.group(1)) if m else -1


# ---------------------------------------------------------------- measurements (data quality)
def _d(a, b): return math.sqrt(sum((a[k] - b[k]) ** 2 for k in range(3)))


def measure(sk, entry):
    F = sk['frames']; ok = [f for f in F if f['ok']]
    m = {'frames': len(F), 'ok': len(ok), 'nonok': len(F) - len(ok)}
    gap = cur = 0
    for f in F:
        cur = 0 if f['ok'] else cur + 1; gap = max(gap, cur)
    m['max_gap'] = gap
    # world jitter: median |2nd difference| of wrists+ankles per frame (cm). Real motion at 30 fps gives ~1-3 cm.
    jit = []
    for a, b, c in zip(ok, ok[1:], ok[2:]):
        for j in (15, 16, 27, 28):
            jit.append(math.sqrt(sum((a['world'][j][k] - 2 * b['world'][j][k] + c['world'][j][k]) ** 2 for k in range(3))))
    m['jitter_cm'] = round(100 * st.median(jit), 1) if jit else None
    # bone-length consistency (rigid bones should not change length): thigh + shin, both sides
    cvs = []
    for a, b in ((23, 25), (25, 27), (24, 26), (26, 28)):
        L = [_d(f['world'][a], f['world'][b]) for f in ok]
        if len(L) > 2 and st.mean(L) > 0: cvs.append(100 * st.pstdev(L) / st.mean(L))
    m['bone_cv'] = round(st.mean(cvs), 1) if cvs else None
    # camera cuts / re-detections: hip centre jumps > 12 % of the image or body scale jumps > 35 % in one frame
    cuts = []
    for a, b in zip(ok, ok[1:]):
        if b['t'] - a['t'] > 0.12: continue
        ha = [(a['lm'][23][k] + a['lm'][24][k]) / 2 for k in (0, 1)]; hb = [(b['lm'][23][k] + b['lm'][24][k]) / 2 for k in (0, 1)]
        sa = math.hypot(a['lm'][11][0] - a['lm'][23][0], a['lm'][11][1] - a['lm'][23][1]); sb = math.hypot(b['lm'][11][0] - b['lm'][23][0], b['lm'][11][1] - b['lm'][23][1])
        if math.hypot(hb[0] - ha[0], hb[1] - ha[1]) > 0.12 or (sa > 0 and abs(sb / sa - 1) > 0.35): cuts.append(round(b['t'], 2))
    m['cuts'] = cuts
    # stance from the skeleton: the ankle further along the travel direction (image x) is the front foot
    tr = (sk.get('view') or {}).get('travel') or ''
    sg = -1 if '向画面左' in tr else 1 if '向画面右' in tr else 0
    seg = [f for f in ok if 0 <= f['t'] <= 0.5] or ok
    v = [('L' if (f['world'][27][0] - f['world'][28][0]) * sg > 0 else 'R') for f in seg if sg and abs(f['world'][27][0] - f['world'][28][0]) > 0.04]
    if v:
        nL = v.count('L'); m['stance_skel'] = 'L' if nL >= len(v) - nL else 'R'; m['stance_conf'] = round(max(nL, len(v) - nL) / len(v), 2)
    else:
        m['stance_skel'] = None; m['stance_conf'] = 0
    vs = entry.get('stance') or ''
    m['stance_view'] = 'L' if vs.startswith('左') else 'R' if vs.startswith('右') else None
    # foot crossings: sign changes of the ankle order along the hip line (cross-steps)
    sgn = []
    for f in ok:
        w = f['world']; ax = (w[24][0] - w[23][0], w[24][2] - w[23][2]); n = math.hypot(*ax) or 1
        d = ((w[27][0] - w[28][0]) * ax[0] + (w[27][2] - w[28][2]) * ax[1]) / n
        if abs(d) > 0.06: sgn.append(d > 0)
    m['foot_cross'] = sum(1 for a, b in zip(sgn, sgn[1:]) if a != b)
    # one-foot-off-the-deck events (push / step): |ankle_dy| > 0.15 m segments
    ev, up = 0, False
    for f in ok:
        u = abs(f['ang']['ankle_dy']) > 0.15
        if u and not up: ev += 1
        up = u
    m['foot_lift_events'] = ev
    # stats ranges
    def rng(k):
        x = [max(f['ang'][k + '_L'], f['ang'][k + '_R']) if k in ('knee', 'arm_abd') else f['ang'][k] for f in ok]
        return [round(min(x)), round(st.median(x)), round(max(x))] if x else None
    m['knee'] = rng('knee'); m['arm'] = rng('arm_abd'); m['torso'] = rng('torso_lean')
    m['facing_flips'] = (sk.get('stats') or {}).get('shoulder_facing_flips')
    return m


def gate(entry, m):
    """(use_for_angles: bool, reasons[]) — contract §4.5 fullbody_ok=false never feeds angles; plus measured gates"""
    r = []
    if not entry.get('fullbody_ok'): r.append('fullbody_ok=false (contract §4.5)')
    if entry.get('ok_ratio', 0) < GATE_OK_RATIO: r.append(f"ok_ratio {entry.get('ok_ratio')} < {GATE_OK_RATIO}")
    if m['bone_cv'] is not None and m['bone_cv'] > GATE_BONE_CV: r.append(f"leg bone length varies {m['bone_cv']}% (> {GATE_BONE_CV}%): world coords unstable")
    uf = entry.get('_user_flags') or {}
    for k in ('direction_wrong', 'board_wrong'):
        if uf.get(k): r.append('user flag ' + k)
    return (not r), r


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('package'); ap.add_argument('--accept-contract', action='store_true'); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--repo', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    a = ap.parse_args()
    P = os.path.abspath(a.package); R = os.path.abspath(a.repo); REF = os.path.join(R, 'refs', 'moves')
    if not os.path.isdir(P): die(f'{P} is not a directory')
    W = Writer(a.dry_run)

    # 1. validate
    vp = os.path.join(P, 'validate_handoff.py')
    if not os.path.exists(vp): die('package has no validate_handoff.py (contract §6)')
    pr = subprocess.run([sys.executable, vp, P], capture_output=True, text=True)
    print(f'[1] validate_handoff.py: exit {pr.returncode}: ' + (pr.stdout.strip().splitlines() or ['(no output)'])[0])
    if pr.returncode != 0: die('package validation failed:\n' + pr.stdout + pr.stderr)

    # 2. contract
    pc, lc = os.path.join(P, 'CONTRACT.md'), os.path.join(REF, 'CONTRACT.md')
    with open(pc, encoding='utf-8') as f: ptxt = f.read()
    if os.path.exists(lc):
        with open(lc, encoding='utf-8') as f: ltxt = f.read()
        if ltxt != ptxt:
            diff = ''.join(difflib.unified_diff(ltxt.splitlines(True), ptxt.splitlines(True), 'refs/moves/CONTRACT.md (ours)', 'package/CONTRACT.md'))
            if not a.accept_contract:
                print(diff[:6000])
                die('CONTRACT.md in the package differs from refs/moves/CONTRACT.md. Align the contract first (Cheney arbitrates), '
                    'then re-run with --accept-contract to install the package copy.', 2)
            print('[2] contract differs -> accepted (--accept-contract), installing package copy'); W.text(lc, ptxt)
        else: print('[2] CONTRACT.md identical')
    else:
        print('[2] first import: installing CONTRACT.md'); W.text(lc, ptxt)

    ix = jload(os.path.join(P, 'index.json'))
    for k in ('schema_version', 'contract_version'):
        if major(ix.get(k)) != SUPPORTED_MAJOR: die(f'{k} {ix.get(k)} unsupported (this importer knows {SUPPORTED_MAJOR}.x); update tools/import_moves.py', 3)
    pkg = ix['package']

    # 3. compare with what we have
    lip = os.path.join(REF, 'index.json')
    old = jload(lip) if os.path.exists(lip) else {'samples': [], 'imported_packages': []}
    oldS = {s['id']: s for s in old.get('samples', [])}; newS = {s['id']: s for s in ix['samples']}
    new_ids = sorted(set(newS) - set(oldS)); removed = sorted(set(oldS) - set(newS)); changed = {}
    for i in sorted(set(newS) & set(oldS)):
        o, n = oldS[i], newS[i]; why = [k for k in ('src_time', 'user_score', 'label', 'move') if o.get(k) != n.get(k)]
        src = os.path.join(P, n['skeleton']); dst = os.path.join(REF, n['skeleton'])
        if not why and (not os.path.exists(dst) or sha(src) != sha(dst)): why.append('skeleton content')
        if why: changed[i] = why
    print(f'[3] package {pkg}: {len(newS)} samples; vs local {len(oldS)}: new {len(new_ids)}, changed {len(changed)}, removed {len(removed)}')
    for i in removed: print('    removed', i, oldS[i]['move'])
    for i, w in changed.items(): print('    changed', i, ','.join(w))

    # per-sample checks + measurements (a sample is rejected = not imported only if it is unreadable)
    meas, rejected, accepted = {}, {}, []
    for i, s in newS.items():
        try:
            sk = jload(os.path.join(P, s['skeleton']))
            if sk.get('id') != i: raise ValueError('skeleton id differs from index')
            s['_user_flags'] = sk.get('user_flags') or {}
            s['_label_bot'] = sk.get('label_bot'); s['_note'] = sk.get('user_note') or ''; s['_title'] = sk.get('clip_title') or ''
            meas[i] = measure(sk, s); accepted.append(i)
        except Exception as e:  # noqa
            rejected[i] = f'unreadable skeleton: {e}'

    # 4. copy / delete
    for i in removed:
        o = oldS[i]
        W.rm(os.path.join(REF, o['skeleton']))
        if o.get('clip_mp4'): W.rm(os.path.join(REF, o['clip_mp4']))
    for i in accepted:
        s = newS[i]; W.copy(os.path.join(P, s['skeleton']), os.path.join(REF, s['skeleton']))
        if s.get('clip_mp4') and os.path.exists(os.path.join(P, s['clip_mp4'])): W.copy(os.path.join(P, s['clip_mp4']), os.path.join(REF, s['clip_mp4']))
    for slug, mv in ix['moves'].items():
        W.copy(os.path.join(P, mv['summary']), os.path.join(REF, mv['summary'])); BEST[slug] = jload(os.path.join(P, mv['summary'])).get('best')
    W.copy(os.path.join(P, 'CHANGELOG.md'), os.path.join(REF, 'CHANGELOG.md'))
    # moves that vanished entirely: drop their summary + empty dir
    for slug in sorted(set(m for m in (s['move'] for s in oldS.values())) - set(ix['moves'])):
        d = os.path.join(REF, slug); W.rm(os.path.join(d, slug + '.summary.json'))
        if not a.dry_run and os.path.isdir(d) and not os.listdir(d): os.rmdir(d)
    # stray local files not in the index (e.g. a sample removed by hand)
    keep = {os.path.normpath(os.path.join(REF, newS[i][k])) for i in accepted for k in ('skeleton', 'clip_mp4') if newS[i].get(k)}
    for root, _, files in os.walk(REF):
        for f in files:
            p = os.path.normpath(os.path.join(root, f))
            if (f.endswith('.skeleton.json') or f.endswith('.mp4')) and p not in keep: W.rm(p)

    # basis references in data/moves/*.json
    md = os.path.join(R, 'data', 'moves'); stale, refs_all = [], {}
    if os.path.isdir(md):
        for f in sorted(os.listdir(md)):
            if not f.endswith('.json'): continue
            txt = open(os.path.join(md, f), encoding='utf-8').read()
            for sid in set(re.findall(r'[A-Za-z0-9_\-]+_\d+', txt)):
                if sid in newS: refs_all.setdefault(f, set()).add(sid)
                if sid in removed or (sid in oldS and sid not in newS): stale.append((f, sid))
            try:
                for path, val in walk_basis(json.loads(txt)):
                    for sid in removed:
                        if sid in val: stale.append((f, f'{sid} @ {path}'))
            except ValueError: pass
    stale = sorted(set(stale))
    if stale:
        print('[!] data/moves entries reference REMOVED samples — re-derive them from another sample:')
        for f, s in stale: print('    data/moves/' + f, s)

    # merged index (dedup by id; the package is a full snapshot so removed ids are dropped)
    pk = list(old.get('imported_packages', []))
    rec = next((x for x in pk if x.get('package') == pkg), None)
    if rec is None or new_ids or changed or removed:
        if rec is None: rec = {'package': pkg}; pk.append(rec)
        rec.update({'generated': ix.get('generated'), 'schema_version': ix['schema_version'], 'contract_version': ix['contract_version'],
                    'n': ix['n'], 'new': len(new_ids), 'changed': {i: w for i, w in changed.items()}, 'removed': {i: oldS[i]['move'] for i in removed},
                    'stale_basis': [list(x) for x in stale]})
    # the report describes what importing THIS package changed (recorded on its first import), so re-runs are no-ops
    new_n = rec['new']; changed = rec.get('changed') or {}; removed_rec = rec.get('removed') or {}
    merged = {k: v for k, v in ix.items() if k != 'samples'}
    merged['imported_packages'] = pk; merged['imported_by'] = 'tools/import_moves.py'
    first = {i: oldS[i].get('first_package', pkg) for i in oldS}
    merged['samples'] = [dict({k: v for k, v in newS[i].items() if not k.startswith('_')}, first_package=first.get(i, pkg)) for i in [s['id'] for s in ix['samples']] if i in accepted]
    merged['n'] = len(merged['samples'])
    W.text(lip, jdump(merged))

    # 5. docs table
    docs = os.path.join(R, 'docs', 'moves.md')
    tbl = docs_table(ix, newS, meas, pkg)
    dtxt = open(docs, encoding='utf-8').read() if os.path.exists(docs) else '# Moves\n'
    B, E = '<!-- REFS:BEGIN (generated by tools/import_moves.py — do not edit by hand) -->', '<!-- REFS:END -->'
    if B in dtxt and E in dtxt: dtxt = dtxt[:dtxt.index(B)] + B + '\n' + tbl + E + dtxt[dtxt.index(E) + len(E):]
    else: dtxt = dtxt.rstrip('\n') + '\n\n## 参考样本 (refs/moves)\n\n' + B + '\n' + tbl + E + '\n'
    W.text(docs, dtxt)

    # 6. report
    rp = os.path.join(REF, 'IMPORT_REPORT.md')
    manual = ''
    if os.path.exists(rp):
        t = open(rp, encoding='utf-8').read(); mb, me = '<!-- MANUAL:BEGIN -->', '<!-- MANUAL:END -->'
        if mb in t and me in t: manual = t[t.index(mb) + len(mb):t.index(me)].strip('\n')
    W.text(rp, report(ix, pk, newS, new_n, changed, removed_rec, accepted, rejected, meas, [tuple(x) for x in rec.get('stale_basis', [])], refs_all, manual))

    # .gitignore for mp4s
    gi = os.path.join(R, '.gitignore'); g = open(gi, encoding='utf-8').read() if os.path.exists(gi) else ''
    if 'refs/moves/**/*.mp4' not in g: W.text(gi, g.rstrip('\n') + '\nrefs/moves/**/*.mp4\n')

    print(f'[4] {"(dry run) " if a.dry_run else ""}' + (f'{len(W.log)} file operations' if W.log else 'no-op: everything already up to date'))
    for l in W.log[:12]:
        op, path = l.split(' ', 1); print(f'    {op} {os.path.relpath(path, R)}')
    if len(W.log) > 12: print(f'    ... {len(W.log) - 12} more')
    print(f'[5] report: {os.path.relpath(rp, R)}  accepted {len(accepted)}, rejected {len(rejected)}, angle-grade {sum(1 for i in accepted if gate(newS[i], meas[i])[0])}')
    return 0


def walk_basis(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            p = f'{path}.{k}' if path else k
            if k == 'basis' and isinstance(v, str): yield p, v
            elif k == 'basis' and isinstance(v, (dict, list)): yield p, json.dumps(v, ensure_ascii=False)
            else: yield from walk_basis(v, p)
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from walk_basis(v, f'{path}[{i}]')


def cam_short(c):
    c = c or ''
    for k, v in CAMS:
        if k in c: return v
    return '未识别'


def docs_table(ix, S, meas, pkg):
    L = [f'包 `{pkg}`（schema {ix["schema_version"]}, contract {ix["contract_version"]}），{len(S)} 样本 / {len(ix["moves"])} 动作。'
         '「可抄角度」= fullbody_ok 且 ok_ratio ≥ 0.85 且腿骨长度波动 ≤ 12%（见 refs/moves/IMPORT_REPORT.md）。', '',
         '| move | n | 5/4/3 | 可抄角度 | 机位 斜/侧/正 | best（最高分） | best 时长 | 回放 |', '|---|---|---|---|---|---|---|---|']
    for slug, mv in ix['moves'].items():
        ss = [s for s in S.values() if s['move'] == slug]
        sc = '/'.join(str(sum(1 for s in ss if s['user_score'] == k)) for k in (5, 4, 3))
        good = sum(1 for s in ss if s['id'] in meas and gate(s, meas[s['id']])[0])
        cams = '/'.join(str(sum(1 for s in ss if cam_short(s['camera']) == c)) for c in ('斜侧45°', '侧面', '正/背面'))
        best = BEST.get(slug) or max(ss, key=lambda s: s['user_score'])['id']
        b = next((s for s in ss if s['id'] == best), ss[0])
        L.append(f"| `{slug}` | {len(ss)} | {sc} | {good} | {cams} | `{b['id']}` ({b['user_score']}分) | {b['dur']} s | `lab.html?ref={slug}` |")
    return '\n'.join(L) + '\n'


BEST = {}   # move -> best sample id (from each <move>.summary.json)


def report(ix, pk, S, new_n, changed, removed, accepted, rejected, M, stale, refs_all, manual):
    pkg = ix['package']; L = []
    A = L.append
    A(f'# IMPORT_REPORT — {pkg}')
    A('')
    A('进口方（skate-walk）→ 出口方（长板视频导演），经 Cheney 转。由 `tools/import_moves.py` 生成；“请求”一节是手写的，脚本重跑时保留。')
    A('')
    A('## 1. 导入了什么')
    A('')
    A(f'- package `{pkg}`，schema_version {ix["schema_version"]}，contract_version {ix["contract_version"]}，min_score {ix.get("min_score")}，generated {ix.get("generated")}')
    A(f'- `validate_handoff.py` 退出 0；CONTRACT.md 与 `refs/moves/CONTRACT.md` 一致（首包：已安装进口方副本）')
    A(f'- 已导入包列表：' + ', '.join(f'`{p["package"]}`' for p in pk))
    A(f'- 本包相对上一次导入：新增 {new_n}，变更 {len(changed)}，删除 {len(removed)}' + ('（首包，全部为新增）' if new_n == len(S) else ''))
    for i, w in changed.items(): A(f'  - 变更 `{i}`: {", ".join(w)}')
    for i, mv in removed.items(): A(f'  - 删除 `{i}`（{mv}）：本地 skeleton/mp4 已删')
    if stale:
        A('- **data/moves 里引用了已删除样本的依据（需要换样本）：**')
        for f, s in stale: A(f'  - `data/moves/{f}`: {s}')
    elif removed: A('- data/moves 里没有引用已删除样本的依据。')
    if refs_all:
        A('- data/moves 当前引用的样本：' + '; '.join(f'`{f}` → ' + ', '.join(f'`{x}`' for x in sorted(v)) for f, v in sorted(refs_all.items())))
    A('')
    A('## 2. 接受 / 拒绝')
    A('')
    good = [i for i in accepted if gate(S[i], M[i])[0]]
    A(f'- 接受（已复制进 `refs/moves/`）：**{len(accepted)}** / {len(S)}；拒绝：**{len(rejected)}**')
    for i, r in rejected.items(): A(f'  - 拒绝 `{i}`: {r}')
    A(f'- 其中「可抄角度」（游戏参数可以引用）：**{len(good)}**；其余 {len(accepted) - len(good)} 个只用来看节奏/时序。门槛：'
      f'fullbody_ok（契约 §4.5）、ok_ratio ≥ {GATE_OK_RATIO}、左右大腿+小腿骨长在片段内的变异系数 ≤ {GATE_BONE_CV}%、用户没标 direction_wrong/board_wrong。')
    for i in accepted:
        ok, r = gate(S[i], M[i])
        if not ok: A(f'  - 仅节奏 `{i}`（{S[i]["move"]}，{S[i]["user_score"]}分）：' + '；'.join(r))
    A('')
    A('## 3. 测到的数据质量（全部 106 个，按动作）')
    A('')
    A('列：分数 · 时长 · 非 ok 帧/总帧（最长连续缺帧）· 世界坐标抖动（腕/踝每帧二阶差分中位数，cm；30 fps 下真实动作约 1–3 cm）· 腿骨长度变异 % · '
      '疑似镜头切换/重检测（髋心一帧跳 >12% 画面或身体尺度跳 >35%，给出 t）· 站姿 view.stance vs 骨架（沿 travel 方向哪只踝在前）· 交叉次数（两踝沿髋线换序）· 单脚抬起次数（|ankle_dy|>0.15 m）· 用户 relabeled（机器原标）')
    A('')
    for slug in ix['moves']:
        ids = [s['id'] for s in ix['samples'] if s['move'] == slug and s['id'] in M]
        if not ids: continue
        A(f'### {slug}')
        A('')
        A('| sample | 分 | dur | 缺帧 | 抖动cm | 骨长% | 切换? | 机位 | 站姿 view/骨架 | 交叉 | 抬脚 | 备注 |')
        A('|---|---|---|---|---|---|---|---|---|---|---|---|')
        for i in ids:
            s, m = S[i], M[i]; notes = []
            if s['dur'] < GATE_SHORT: notes.append(f'段长 {s["dur"]} s < 一个周期')
            if s['dur'] > 2.5: notes.append('长段 >2.5 s，可能含别的动作')
            if s['_user_flags'].get('relabeled'): notes.append(f'relabeled（机器：{s["_label_bot"]}）')
            if s['_note']: notes.append('用户：' + s['_note'])
            sv, sk = m['stance_view'] or '?', m['stance_skel'] or '?'
            stn = f'{sv}/{sk}' + ('' if sv == sk or '?' in (sv, sk) else ' ✗')
            A(f"| `{i}` | {s['user_score']} | {s['dur']} | {m['nonok']}/{m['frames']} ({m['max_gap']}) | {m['jitter_cm']} | {m['bone_cv']} | {','.join(map(str, m['cuts'])) or '—'} | {cam_short(s['camera'])} | {stn} | {m['foot_cross']} | {m['foot_lift_events']} | {'；'.join(notes)} |")
        A('')
    # aggregates
    allm = [M[i] for i in accepted]
    A('### 汇总')
    A('')
    nf = sum(m['frames'] for m in allm); nn = sum(m['nonok'] for m in allm)
    A(f'- 帧：{nf}，ok=false {nn}（{100 * nn / max(1, nf):.1f}%）；ok_ratio < 0.9 的样本 {sum(1 for i in accepted if S[i]["ok_ratio"] < 0.9)} 个')
    J = sorted(m['jitter_cm'] for m in allm if m['jitter_cm'] is not None)
    A(f'- 世界坐标抖动中位数 {st.median(J)} cm/帧²（最好 {J[0]}，最差 {J[-1]}）；唯一固定机位 60 fps 的 `pushform_1` 只有 {M.get("pushform_1", {}).get("jitter_cm")} cm —— 抖动主要来自跟拍/移动机位')
    B = sorted(m['bone_cv'] for m in allm if m['bone_cv'] is not None)
    A(f'- 腿骨长度变异中位数 {st.median(B)}%（最差 {B[-1]}%）')
    sa = [(S[i]['id'], M[i]) for i in accepted if M[i]['stance_view'] and M[i]['stance_skel']]
    agree = sum(1 for _, m in sa if m['stance_view'] == m['stance_skel'])
    A(f'- 站姿：view.stance 与骨架判定一致 {agree}/{len(sa)}（其余 {sum(1 for i in accepted if not (M[i]["stance_view"] and M[i]["stance_skel"]))} 个缺 travel 左右方向或缺 stance，无法比）。游戏侧一律用 `js/refskel.js` 的 `stance()`。')
    A(f'- 疑似镜头切换/重检测的样本：{sum(1 for m in allm if m["cuts"])} 个')
    A(f'- 0.3 s 的样本：{sum(1 for i in accepted if S[i]["dur"] <= 0.31)} 个；> 2.5 s 的样本：{sum(1 for i in accepted if S[i]["dur"] > 2.5)} 个')
    A(f'- relabeled：{sum(1 for i in accepted if S[i]["_user_flags"].get("relabeled"))} 个（机器标签和用户标签不同，按用户为准）')
    A(f'- 板位置：skeleton 里没有板（契约 §4.6），`view.board_deg` 为 null 的样本 {sum(1 for i in accepted if S[i].get("camera") and "没识别" in S[i]["camera"])} 个（camera=板沿没识别出来）')
    A('')
    A('### 优先 4 个动作的机位覆盖（可抄角度 / 全部）')
    A('')
    A('| move | 斜侧45° | 侧面 | 正/背面 | 未识别 |')
    A('|---|---|---|---|---|')
    for slug in PRIORITY:
        ss = [S[i] for i in accepted if S[i]['move'] == slug]
        cells = []
        for c in ('斜侧45°', '侧面', '正/背面', '未识别'):
            x = [s for s in ss if cam_short(s['camera']) == c]
            cells.append(f"{sum(1 for s in x if gate(s, M[s['id']])[0])} / {len(x)}")
        A(f'| `{slug}` | ' + ' | '.join(cells) + ' |')
    A('')
    A('## 4. 对出口方的请求')
    A('')
    A('<!-- MANUAL:BEGIN -->')
    A(manual if manual else '（待填）')
    A('<!-- MANUAL:END -->')
    A('')
    return '\n'.join(L) + '\n'


if __name__ == '__main__':
    sys.exit(main())
