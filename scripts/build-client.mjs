// build-client.mjs — 零依赖构建：src/client.mjs + src/client.css → lib/client.js
// 产物 = 浏览器经典脚本：window.__ModuleLoader__.load({ id, factory:(require)=>{…} })
//  1) CSS 取包内 src/client.css（单一事实来源，可独立发布；开发仓库内与动态版
//     src/client.js 的 styles.insert 做一致性核对，漂移即报错）
//  2) 内联为 <style data-plugin-css> 标签（静态模块无 styles.insert API）
//  3) externals 仅 react（浏览器模块表 seed，factory 的 require("react") 解析它）
// 用法: node scripts/build-client.mjs [--sync-css | --allow-css-drift]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(pluginRoot, '..')
const read = (rel) => readFileSync(join(pluginRoot, rel), 'utf8')

function extractFromDynamic(dynPath) {
  const dyn = readFileSync(dynPath, 'utf8')
  const marker = "styles.insert('"
  const start = dyn.indexOf(marker)
  if (start < 0) throw new Error('动态版未找到 styles.insert( — 无法提取 CSS')
  const end = dyn.indexOf("')", start + marker.length)
  if (end < 0) throw new Error('styles.insert 结束标记未找到')
  return dyn.slice(start + marker.length, end)
}

const cssRel = 'src/client.css'
const cssAbs = join(pluginRoot, cssRel)
const dynClient = join(repoRoot, 'src', 'client.js')

// --sync-css：从动态版重新提取并写包内 CSS（开发仓库内使用）
if (process.argv.includes('--sync-css')) {
  const src = extractFromDynamic(dynClient)
  writeFileSync(cssAbs, src, 'utf8')
  console.log('[build] 已从动态版同步 ' + cssRel + '（' + src.length + ' chars）')
  process.exit(0)
}

// 1) CSS：包内文件为准（首次缺失则自动从动态版提取生成）
let css
if (existsSync(cssAbs)) {
  css = readFileSync(cssAbs, 'utf8')
} else if (existsSync(dynClient)) {
  css = extractFromDynamic(dynClient)
  writeFileSync(cssAbs, css, 'utf8')
  console.log('[build] 首次生成 ' + cssRel + '（从动态版 styles.insert 提取），请纳入版本管理')
} else {
  throw new Error(cssRel + ' 缺失且无动态版可提取 — 请从仓库运行或恢复包内 CSS')
}
if (css.length < 100) throw new Error(cssRel + ' 过短，疑似错误: ' + css.length)

// 一致性核对（仅开发仓库；独立发布包无 ../src 自动跳过）
if (existsSync(dynClient)) {
  const dynCss = extractFromDynamic(dynClient).replace(/\s+$/, '')
  if (dynCss !== css.replace(/\s+$/, '')) {
    const msg = 'CSS 漂移: src/client.css 与动态版 styles.insert 不一致（改动动态版后请运行: node scripts/build-client.mjs --sync-css）'
    if (!process.argv.includes('--allow-css-drift')) throw new Error(msg)
    console.warn('[build] 警告: ' + msg)
  }
}

// 2) 客户端源码（bundle 作用域，纯 JS，无 import/export）
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
