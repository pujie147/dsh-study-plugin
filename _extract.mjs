import { readFileSync, writeFileSync } from 'node:fs'
const src = 'C:/Users/pyg12/.dsh/study-work/plugin/study-plugin.dist.json'
const d = JSON.parse(readFileSync(src, 'utf8'))
writeFileSync('C:/Users/pyg12/gitProjects/study_dsh_plugin/_extract_host.js', d.code.host, 'utf8')
writeFileSync('C:/Users/pyg12/gitProjects/study_dsh_plugin/_extract_client.js', d.code.client, 'utf8')
console.log('host', Buffer.byteLength(d.code.host, 'utf8'), 'client', Buffer.byteLength(d.code.client, 'utf8'))
console.log('host lines', d.code.host.split('\n').length, 'client lines', d.code.client.split('\n').length)
