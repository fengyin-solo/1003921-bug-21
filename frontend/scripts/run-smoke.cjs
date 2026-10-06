// 不依赖原生二进制的 TS 运行器：用 typescript 自带 transpileModule 即时转译，并解析 @/ 别名。
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    request = path.join(root, 'src', request.slice(2))
  }
  try {
    return originalResolve.call(this, request, parent, isMain, options)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && (request.startsWith('./') || request.startsWith('../'))) {
      const base = path.resolve(path.dirname(parent.filename), request)
      for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) {
          return cand
        }
      }
    }
    throw err
  }
}

Module._extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

// 浏览器环境桩：localStorage 用内存 Map 实现。
const mem = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}

require(path.join(root, 'scripts', 'smoke.ts'))
