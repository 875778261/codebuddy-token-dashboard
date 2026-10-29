#!/usr/bin/env node
/**
 * 浏览器拒绝打开 AppData（"此文件夹包含系统文件"），但允许选择普通路径。
 * 这里用目录联接（Windows junction / POSIX symlink）把两个真实目录挂到仓库下：
 *
 *   cb-bridge/data      → %LOCALAPPDATA%\CodeBuddyExtension\Data
 *   cb-bridge/appdata   → %APPDATA%\CodeBuddy CN
 *
 * 然后在页面里选 cb-bridge 这一个目录：history 与会话库一次拿全。
 * 联接是零拷贝透传，数据仍然只在本地；不想要了直接删掉 cb-bridge 即可（不会动源目录）。
 */
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('cb-bridge')
const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
const isWin = process.platform === 'win32'

const targets = [
  ['data', process.env.CB_DATA ?? path.join(process.env.LOCALAPPDATA ?? path.join(home, 'Library/Application Support'), 'CodeBuddyExtension', 'Data')],
  ['appdata', process.env.CB_SESSIONS_DIR ?? path.join(process.env.APPDATA ?? path.join(home, 'Library/Application Support'), 'CodeBuddy CN')],
]

const exists = (p) => {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

mkdirSync(root, { recursive: true })
let ok = 0

for (const [name, target] of targets) {
  const link = path.join(root, name)
  if (!existsSync(target)) {
    console.log(`- 跳过 ${name}：源目录不存在 ${target}`)
    continue
  }
  if (exists(link)) {
    console.log(`- 已存在 ${link}，跳过（如需重建先手动删除它）`)
    ok += 1
    continue
  }
  try {
    symlinkSync(target, link, isWin ? 'junction' : 'dir')
    console.log(`√ ${link}`)
    console.log(`     → ${target}`)
    ok += 1
  } catch (err) {
    console.error(`× 创建 ${link} 失败：${err.message}`)
    console.error('  可改用 `npm run collect` 直接生成快照 JSON。')
  }
}

console.log('')
if (ok) {
  console.log('注意：这只是实验性捷径。Chrome 对联接目录不返回 FileSystemEntry，')
  console.log('所以**拖拽 cb-bridge 无效**；只能尝试用页面上的「选择目录」选中它：')
  console.log(`  ${root}`)
  console.log('')
  console.log('若「选择目录」也被拒绝，请改用：')
  console.log('  · 直接把 %LOCALAPPDATA%\\CodeBuddyExtension\\Data 拖进窗口（推荐）')
  console.log('  · 或 npm run collect 生成快照后导入')
  console.log('')
  console.log('提示：联接是零拷贝透传，源文件不会被复制；删掉 cb-bridge 只删链接。')
} else {
  console.log('没有建立任何联接。请确认 CodeBuddy 已在本机运行过，或用 CB_DATA / CB_SESSIONS_DIR 指定路径。')
  process.exitCode = 1
}
