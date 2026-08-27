# ADR-0006：CLI 是首个 adapter，Studio 是长期核心入口

- 状态：Accepted product direction
- 日期：2026-08-27

## 背景

Mallok 的 MVP 先通过 CLI 验证内容、static、D1 发布和部署恢复。若把“CLI-first”误解为永久产品定位，Mallok 就只能让开发者更省事，无法实现“第一次建站的人也能独立使用”的长期目标。

同时，把完整 GUI、浏览器认证、托管和多人权限塞进 0.1，会在核心内容与发布契约尚未稳定时形成第二套作者真相和更大的安全面。

## 决策

1. Mallok 只在内容站创建与持续发布这条窄路径上追求比通用框架更轻、更容易；不声称全面替代 Astro。
2. Phase 1–3 保持 CLI-first。CLI 是稳定自动化 adapter，不拥有领域真相。
3. CLI、未来 Guided Start 和 Studio 必须调用共享 application/domain service 或管理 API；Studio 不得 shell out 到 CLI，也不得绕过发布服务直接写 D1。
4. Mallok Studio 是长期核心产品阶段，不是可有可无的外壳；但它仍在 MVP 发布链路稳定后进入 Phase 4，并先冻结身份、权限、作者真相、托管与威胁模型。
5. ESM Theme API 只面向主题作者。最终用户选择模板，不要求理解 ESM、组件或构建工具。
6. “更轻、更容易、优于 Astro”是需要同环境工程基准与真人任务测试验证的假设；未通过证据门前只能写“为该目标设计”。

## 后果

- T-001 至 T-013 的 MVP 技术顺序不变，可以继续从 core 开始；
- README/PRD 必须区分长期愿景、当前 MVP 能力和未交付 Studio；
- Phase 4 需要新的任务、AC 和威胁模型，不能在现有 task 中顺手实现 GUI；
- application service 的业务行为必须可被 CLI 和未来界面复用，交互措辞与 shell 解析留在 adapter；
- 比较性宣传必须绑定版本、fixture、环境和证据，不能拿单一零 JS 特性冒充全面优势。
