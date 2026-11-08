# 动作参考交接契约（CONTRACT）

**contract_version: 1.0**　生效 2026-11-08

双方：
- **出口方**：长板视频导演（Codync bot，仓库 skate-walk-test，脚本 `make_handoff.py`）。产出交接包。
- **进口方**：skate-walk 项目（Codex 维护，仓库 skate-walk）。导入交接包，产出游戏动作。
- **仲裁**：Cheney。分数、动作名以他为准；契约改动由他在两边之间传递。

这份文件两边各存一份，**路径固定**：出口方 `skate-walk-test/handoff/moves/CONTRACT.md`，进口方 `skate-walk/refs/moves/CONTRACT.md`。
每个包里都带当前版本的 CONTRACT.md；进口时先 diff 两份，不一致就先对齐契约再导入。

---

## 1. 版本

三个版本号，各管各的：

| 名称 | 在哪 | 规则 |
|---|---|---|
| `contract_version` | 本文件头、`index.json` | 契约文本有实质改动就升。主版本升 = 进口方脚本必须改；次版本升 = 只加了可选内容。 |
| `schema_version` | `index.json`、每个 `*.summary.json`、每个 `*.skeleton.json` | 数据格式版本。**次版本**：只增字段，老读取器照常工作。**主版本**：删字段、改字段含义、改单位、改坐标约定。 |
| `package` | `index.json` | 包的 id，`moves-YYYY-MM-DD`，同一天第二包加 `-2`。进口方记录已导入的 package 列表。 |

出口方保证：`schema_version` 主版本不变时，已发出的 sample 文件字段只增不减、含义不变。

## 2. 目录（固定，不可改名）

```
<package>/
  CONTRACT.md                   本文件
  README.md                     面向人的说明，可随意改
  CHANGELOG.md                  每包一节：日期、package、schema_version、新增/删除/改分的 sample 数
  index.json                    唯一入口。进口方只从这里出发找文件
  validate_handoff.py           校验脚本（stdlib only，两边都能跑）
  <move>/
    <move>.summary.json
    <sample>.skeleton.json
    <sample>.mp4                可选
```

- `<move>` 是 slug：小写 ASCII、下划线。slug 清单和动作名的对应在 `index.json.moves`，**slug 一旦出现就不改名**；动作名（中文/英文）可改。
- `<sample>` id：`<clip>_<n>`，来自用户审片段 id，**稳定**。同一 sample 再次出现时 id 相同、`src_time` 相同。

## 3. 文件契约

### 3.1 index.json（必有）
```
schema_version   "1.x"
contract_version "1.x"
package          "moves-2026-11-08"
generator        字符串
generated        ISO 日期
min_score        整数，本包收录的最低用户分
n                sample 总数
coords, joints   见 3.3；与每个 skeleton 里的相同
moves            { slug: { n, description, summary } }
samples[]        每项：move, id, user_score(0–5), label, clip, src_time[a,b], dur, camera, stance,
                 fullbody_ok(bool), ok_ratio(0–1), flags[], skeleton(相对路径), clip_mp4(相对路径或 null)
```

### 3.2 `<move>.summary.json`
```
schema_version, move, description, n, n_fullbody, scores{分:数量}, best(sample id)
pooled_median_of  { knee_peak, knee_typical, torso_lean_peak, torso_lean_typical, arm_abd_peak, wrist_span_peak, ankle_dist_peak, dur }
                  只用 fullbody_ok 的样本；没有则用全部
samples[]         与 index 同结构 + stats_brief{knee,torso,arm: [min,median,max]}，best 在前
```
`pooled_median_of` 是**参考起点**，不是规范值。进口方做游戏参数时以 best 样本的曲线为准。

### 3.3 `<sample>.skeleton.json`
头部：
```
schema_version, id, move, label(用户认定), label_bot(机器标，仅对照), user_score, user_segment,
user_flags{unsure, direction_wrong, board_wrong, relabeled}, user_note,
clip, clip_title, source(URL 或路径), src_time[a,b], pad(秒),
view{camera, travel, stance, camera_moving, board_deg}   # 机器猜的，可为 null
fps(源帧率), joints[33], coords(文字约定), t_zero(文字), stats{...}, stamp(内部用，勿依赖)
```
`frames[]` 每帧：
```
t       片段内秒，0 = 用户段起点，负值 = pad
t_src   源视频秒
ok      bool，false 时无 world/lm/ang
world   [33][x,y,z] 米。原点髋中心。+x 画面右、+y 向下、+z 远离镜头（MediaPipe 约定）。three.js 用时 y 取负。
lm      [33][x,y,z,visibility] 画面归一化坐标
ang     { knee_L, knee_R, hip_L, hip_R, elbow_L, elbow_R, arm_abd_L, arm_abd_R, torso_lean, ankle_dy, ankle_dist, wrist_span, hip_h }
        单位度；knee 0=直、torso_lean 0=直立、arm_abd 0=垂臂；ankle_dy/ankle_dist/wrist_span/hip_h 单位米
```
33 点顺序 = MediaPipe Pose 标准顺序，见 `joints`。

### 3.4 mp4
360p、无声、H.264、时间范围 = `src_time`。可选，进口方可以 .gitignore。

## 4. 语义规则

1. **用户分数是最终的**。包里只有 ≥ `min_score` 的样本。
2. **消失即删除**：某 sample 在前一包有、这一包没有，表示用户降分或禁用，进口方导入时删掉本地那份（含由它派生的 data/moves 依据，要换样本）。`CHANGELOG.md` 会列出。
3. **同 id 内容变了**（`src_time` 或 `user_score` 或 `label` 变）：以新包为准覆盖。
4. 出口方不保证段边界精确到动作周期；进口方取曲线主峰。
5. `fullbody_ok=false` 的样本不拿来抄角度。
6. 板不在骨架里。板相关量只有 `view.board_deg`，粗略。

## 5. 进口方义务（Codex）

- 维护 `tools/import_moves.py <package_dir>`：跑 `validate_handoff.py` → 对比上一包 → 复制/删除 → 合并 index → 重生成 docs 表。失败要退出非零并说明。
- 导入后写 **`IMPORT_REPORT.md`** 回给出口方（经 Cheney 转）：导入了哪个 package、接受/拒绝的 sample（拒绝要给原因）、对出口方的请求（例如「cross_step 想要正面机位样本」「需要 board 位置」）。这是进口方唯一的反馈通道。
- 想改契约：改 `refs/moves/CONTRACT.md`，升 contract_version，在 IMPORT_REPORT.md 里说明，Cheney 转给出口方。出口方下一包按新契约出或者回复不同意的理由。
- 不要改 `refs/moves/<move>/*.skeleton.json` 的内容。要改就在自己目录做派生文件。

## 6. 出口方义务（长板视频导演）

- 每包必带 `CONTRACT.md`、`CHANGELOG.md`、`index.json`、`validate_handoff.py`，且 validate 通过。
- 想改格式：先升 `schema_version`，在 CONTRACT.md 第 3 节写清楚，在 CHANGELOG 写迁移说明。主版本变更先告诉 Cheney 再出包。
- 收到 IMPORT_REPORT.md 后在下一包的 CHANGELOG 里回应每一条请求（做了 / 做不了 / 待定）。
- 不改 slug、不改 sample id。

## 7. 校验

`python3 validate_handoff.py <package_dir>` 两边都要能跑通，退出 0 才算合法包。它检查：目录、版本字段、index 与文件一一对应、每个 skeleton 的必有字段和数组长度、帧 t 单调、ok 帧有 33 点。

## 8. 变更记录（契约本身）

- 1.0（2026-11-08）首版。
