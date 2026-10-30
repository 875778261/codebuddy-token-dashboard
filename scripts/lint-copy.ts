/**
 * 文案门禁：把 docs/COPY.md 的五条检查里可脚本化的三条跑成命令。
 *
 * 只检查「用户看得见的中文」——候选片段来自 JSX 文本节点与字符串字面量。
 * 因此：代码注释、类型名、字段路径都不会被误判；<code> 里的路径块也被跳过。
 *
 * 用法：npm run lint:copy
 * 退出码：1 = 有禁用词（阻断），0 = 只有超长提示或全通过。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'

interface Rule {
  test: RegExp
  why: string
}

/** 与 docs/COPY.md 的「禁用词」表一一对应，改这里必须同步改文档 */
const BANNED: Rule[] = [
  { test: /句柄/, why: '说「没记住文件夹」' },
  { test: /文件框/, why: '说「窗口选择」' },
  { test: /归一/, why: '说「路径写法不同 / 按路径归类」' },
  { test: /恒等式/, why: '说「加总对得上」' },
  { test: /口径/, why: '说「这类数字本身的上限」' },
  { test: /载入/, why: '说「读入」' },
  { test: /重新扫描/, why: '说「重扫」' },
  { test: /在途/, why: '说「写到一半」' },
  { test: /当前窗口|该窗口|窗口内/, why: '说「这个时间段」' },
  { test: /requests\[\]/, why: '字段名不进句子' },
  { test: /(?<![\w.\-/\\])(usage|fail|cwd|jsonl|vscdb|selectedModelId)(?![\w.\-/\\])/i, why: '字段名不进句子' },
]

/** L1 层（首屏）单句上限，见 COPY.md；超长只提示不阻断 */
const L1_FILE = 'Landing.tsx'
const L1_MAX = 28

const QUOTED = /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g
const JSX_TEXT = />([^<>{}]+)</g

const hasCJK = (s: string) => /[\u4e00-\u9fa5]/.test(s)
/** 整段都是 ASCII 且带路径符号 → 路径/glob 块，按规矩允许原样出现 */
const isPathLike = (s: string) => /^[\x20-\x7E]+$/.test(s) && /[\\/*%]/.test(s)
const stripTemplateExpr = (s: string) => s.replace(/\$\{[^}]*\}/g, ' ')
const clean = (s: string) => stripTemplateExpr(s).replace(/\s+/g, ' ').trim()

function uiFiles(): string[] {
  const ui = readdirSync(join(SRC, 'ui'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(SRC, 'ui', f))
  return [join(SRC, 'App.tsx'), ...ui]
}

function candidates(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(JSX_TEXT)) out.push(m[1])
  for (const m of line.matchAll(QUOTED)) out.push(m[2])
  return out
}

let scanned = 0
let total = 0
const errors: string[] = []
const warnings: string[] = []

for (const file of uiFiles()) {
  const text = readFileSync(file, 'utf8')
  text.split(/\r?\n/).forEach((line, i) => {
    scanned += 1
    for (const raw of candidates(line)) {
      const s = clean(raw)
      if (!s || !hasCJK(s) || isPathLike(s)) continue
      total += 1

      for (const rule of BANNED) {
        if (rule.test.test(s)) {
          errors.push(`${file}:${i + 1}  命中「${s.match(rule.test)?.[0]}」→ ${rule.why}\n    …${s}…`)
        }
      }

      if (file.endsWith(L1_FILE)) {
        for (const part of s.split(/[。；：，、]/)) {
          if (part.trim().length > L1_MAX) {
            warnings.push(`${file}:${i + 1}  单句 ${part.trim().length} 字（上限 ${L1_MAX}）\n    …${part.trim()}…`)
          }
        }
      }
    }
  })
}

for (const w of warnings) console.log(`提示  ${w}`)
for (const e of errors) console.error(`错误  ${e}`)

const fileCount = uiFiles().length
if (errors.length) {
  console.error(`\n文案检查失败：${errors.length} 处禁用词 / ${warnings.length} 处超长（扫描 ${fileCount} 个文件、${total} 段可见文案）`)
  console.error('规则见 docs/COPY.md：禁用词必须换掉，不是加白名单。')
  process.exit(1)
}

console.log(`文案检查通过：${fileCount} 个文件、${total} 段可见文案，${warnings.length} 处超长提示`)
