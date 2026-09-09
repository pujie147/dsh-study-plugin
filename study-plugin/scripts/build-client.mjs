// build-client.mjs — 零依赖构建：src/client.mjs → lib/client.js
// 产物 = 浏览器经典脚本：window.__ModuleLoader__.load({ id, factory:(require)=>{…} })
//  1) 从仓库根 src/client.js 的 styles.insert('…') 提取完整 CSS（单一事实来源）
//  2) 内联 CSS 为 <style data-plugin-css="study-plugin/client.css"> 标签（静态模块无 styles.insert API）
//  3) externals 仅 react（浏览器模块表的 seed 模块，factory 的 require("react") 解析它）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..')
const read = (rel) => readFileSync(join(pluginRoot, rel), 'utf8')

// 1) 提取 CSS
const dyn = readFileSync(join(repoRoot, 'src', 'client.js'), 'utf8')
const marker = "styles.insert('"
const start = dyn.indexOf(marker)
if (start < 0) throw new Error('src/client.js 中未找到 styles.insert( — 提取 CSS 失败')
const end = dyn.indexOf("')", start + marker.length)
if (end < 0) throw new Error('styles.insert 结束标记未找到')
const css = dyn.slice(start + marker.length, end)
if (css.length < 100) throw new Error('提取到的 CSS 过短，疑似错误: ' + css.length)

// 2) 读客户端源码（bundle 作用域，纯 JS，无 import/export）
const client = read('src/client.mjs')

// 3) 组装
const banner = [
  '// study-plugin client bundle (built by scripts/build-client.mjs — DO NOT EDIT BY HAND)',
  'window.__ModuleLoader__.load({',
  '  id: "study-plugin",',
  '  factory: (require) => {',
  '    const React = require("react");',
  '    const STUI_CSS = ' + JSON.stringify(css) + ';',
  '    (function () {',
  '      if (typeof document === "undefined") return',
  '      var tagId = "study-plugin/client.css"',
  '      if (document.querySelector(\'style[data-plugin-css="\' + tagId + \'"]\') !== null) return',
  '      var tag = document.createElement("style")',
  '      tag.dataset.plugin = "study-plugin"',
  '      tag.dataset.pluginCss = tagId',
  '      tag.textContent = STUI_CSS',
  '      document.head.appendChild(tag)',
  '    })();'
].join('\n')
const footer = '\n    return { apply, inject };\n  },\n});\n'
const bundle = banner + '\n' + client + footer

mkdirSync(join(pluginRoot, 'lib'), { recursive: true })
writeFileSync(join(pluginRoot, 'lib', 'client.js'), bundle, 'utf8')
console.log('[study-plugin build] lib/client.js 已生成')
console.log('  css   :', css.length, 'chars')
console.log('  bundle:', bundle.length, 'chars')
for (const m of ['window.__ModuleLoader__.load', 'id: "study-plugin"', 'require("react")', 'return { apply, inject }', 'tag.dataset.pluginCss']) {
  if (bundle.indexOf(m) < 0) throw new Error('bundle 缺少必需标记: ' + m)
}
console.log('  标记检查: OK')
