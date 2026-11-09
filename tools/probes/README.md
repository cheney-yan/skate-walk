# 测试与截图脚本

在页面里用 `LAB.*` 钩子跑的脚本。运行方法（在 `tools/rec` 目录下）：

```
timeout 280 node rec.mjs <输出目录> eval ../probes/<组>/<脚本>.js
LABQ='&route=bondi' timeout 280 node rec.mjs <输出目录> eval ../probes/<组>/<脚本>.js   # Bondi 路线
```

每次推送前至少跑 `regression/probe74` 和 `regression/probe75`。

## regression

- `regression/probe74.js`：测试路线跑完整程（期望 "end 371"，事件里有 set/step-on/hop-on）
- `regression/probe75.js`：Bondi 380→520 m（期望 stuckWindows 0），用 LABQ=&route=bondi
- `regression/probeG4.js`：路面规则：地面不高于路、路边 3 m 内无海（Bondi）
- `regression/probe196.js`：决策日志：每 20 m 状态 + 决策
- `regression/probe197.js`：走路时鞋是否陷进坡里
- `regression/probe198.js`：体力最低值 / 休息次数

## measure

- `measure/piroM.js`：pirouette 身体倾斜和膝角
- `measure/xsClip.js`：cross-step 两小腿最近距离、脚是否离板
- `measure/pushLift.js`：蹬地收脚的最高离地高度
- `measure/boards.js`：四块板各在 Bondi 跑 4 分钟对比（Bondi）
- `measure/perf2.js`：每帧渲染耗时和三角面（Bondi）
- `measure/ffCost.js`：加速子步的单步耗时
- `measure/stprobe.js`：街道是否贴地（Bondi）

## shots

- `shots/mapshot2.js`：地图对比：我们的俯视 vs 航拍（Bondi，输出到指定目录）
- `shots/lightShot.js`：不同时间的全景光影
- `shots/girlLight.js`：女孩近景光影（前/左/右）
- `shots/restShot2.js`：路边坐下/起身分帧
- `shots/xsShot.js`：cross-step 侧面分帧
- `shots/piroShot.js`：pirouette 分帧
- `shots/farCmp.js`：远处阴影开/关对比
- `shots/seaLow.js`：低角度看海
