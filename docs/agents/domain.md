# 领域文档

说明各工程技能在探索代码库时，应如何消费本仓库的领域文档。

## 探索之前先读这些

- 仓库根目录的 **`GLOSSARY.md`**；
- 或仓库根目录的 **`GLOSSARY-MAP.md`**（如果存在）：它指向每个上下文各自的 `GLOSSARY.md`，读取其中与当前主题相关的那些；
- **`docs/adr/`**：读取涉及你即将改动区域的 ADR。多上下文仓库中，还要检查 `src/<context>/docs/adr/` 下的上下文级决策。

若上述文件不存在，**静默继续**。不要提示它们的缺失，也不要主动建议提前创建。`/domain-modeling` 技能（经由 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）会在术语或决策真正被确定时按需惰性创建。

## 文件结构

本仓库为**单上下文**：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库以根目录存在 `GLOSSARY-MAP.md` 为标志。本仓库没有该文件，因此不要去找各上下文独立的 `GLOSSARY.md` 或 `src/<context>/docs/adr/`。

## 沿用术语表的词汇

当你的产出需要命名某个领域概念时（出现在 issue 标题、重构提案、假设、测试名称中），使用 `GLOSSARY.md` 中定义的术语。不要漂移到术语表明确回避的同义词。

若所需概念尚未收录进术语表，这本身是一个信号：要么你在发明项目并不使用的语言（重新考虑），要么确实存在空白（记录下来交给 `/domain-modeling`）。

## 与 ADR 冲突时显式标注

若你的产出与既有 ADR 相矛盾，应显式指出，而不是悄悄覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重新审视，因为……_
