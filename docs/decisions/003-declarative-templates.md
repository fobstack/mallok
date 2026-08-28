# DEC-003：声明式模板

状态：`Accepted`

## 决定

0.1 模板由 manifest、Liquid-like HTML、CSS、静态资源和受约束 settings 构成，不运行模板提供者的任意 JavaScript。

## 原因

Mallok 的价值是降低维护成本，而不是建立另一个组件生态。任意代码模板会重新引入依赖、打包、沙箱、安全和兼容负担。

## 后果

- 0.1 随产品提供 Journal、Docs、Company 三个受信任模板。
- 普通用户只调整已声明的 accent、sans/serif 字体和 compact/comfortable density；Logo 属于站点设置，0.1 不开放自由布局或自定义 CSS。
- 模板切换必须保留内容与 URL。
- 第三方市场、插件和可执行主题在有真实需求前不进入范围。
