/** 测试打包 stub：把 ?url / ?worker 等资源 import 替换为空字符串，供 scripts-verify 跑浏览器代码 */
import { build } from '../node_modules/esbuild/lib/main.js'

const stubPlugin = {
  name: 'stub-url-assets',
  setup(b) {
    for (const marker of ['?url', '?worker', '?inline']) {
      b.onResolve({ filter: new RegExp(`\\${marker}$`) }, (args) => ({
        path: `stub:${marker}`,
        namespace: 'stub',
      }))
    }
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default ""', loader: 'js' }))
  },
}

const outfile = process.argv[3] ?? '/tmp/bundle_test.mjs'
await build({
  entryPoints: [process.argv[2]],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'error',
  plugins: [stubPlugin],
})
