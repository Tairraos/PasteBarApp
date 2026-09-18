import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import react from '@vitejs/plugin-react'
import * as dotenv from 'dotenv'
import { defineConfig, PluginOption } from 'vite'
import dynamicImport from 'vite-plugin-dynamic-import'
import { viteStaticCopy } from 'vite-plugin-static-copy'

import i18nextLoader from './src/lib/i18n-vite-loaded/loader'

dotenv.config()

const ReactCompilerConfig = {
  runtimeModule: 'react-compiler-runtime',
  target: '19', // '17' | '18' | '19'
}

let pastebarAppPackage
const pastebarUIVersion = require('./package.json').version

/**
 * Put the version in the document title.
 *
 * The window is built with `hidden_title(true)` on macOS and `decorations(false)` on
 * Windows, so the OS title bar shows nothing — but the document title is still what the
 * window list, Mission Control and the taskbar display, and "which build am I running?" is
 * the first question when a packaged app misbehaves. `APP_VERSION` already carries the
 * version into the bundle; this applies the same value to `<title>` so the two cannot
 * disagree.
 */
function htmlTitleVersion(): PluginOption {
  return {
    name: 'pastebar-html-title-version',
    transformIndexHtml(html: string) {
      const version = pastebarAppPackage?.default?.version
      if (!version) return html
      return html.replace(
        /<title>([^<]*)<\/title>/,
        (_m, name: string) => `<title>${name} ${version}</title>`
      )
    },
  }
}

async function loadPasteBarAppPackage() {
  try {
    const pastebarAppPath =
      process.env.PASTEBAR_APP_PATH || path.resolve(__dirname, '../..')
    const packageJsonPath = path.join(pastebarAppPath, 'package.json')
    const packageJsonUrl = pathToFileURL(packageJsonPath).href

    pastebarAppPackage = await import(packageJsonUrl, {
      with: { type: 'json' },
    })
  } catch (e) {
    console.log('Please make sure main PasteBarApp repo exist')
    console.error('\nError reading package.json:', e)
    process.exit(1)
  }
}

export default async () => {
  await loadPasteBarAppPackage()

  console.log('PasteBar App Path:', process.env.PASTEBAR_APP_PATH)
  console.log('PasteBar App Version:', pastebarAppPackage.default.version)
  console.log('PasteBar UI Version:', pastebarUIVersion)
  console.log('')

  return defineConfig({
    clearScreen: false,
    server: {
      port: 4422,
      open: false,
      strictPort: true,
    },
    define: {
      BUILD_DATE: JSON.stringify(new Date().valueOf()),
      APP_VERSION: JSON.stringify(pastebarAppPackage.default.version),
      APP_UI_VERSION: JSON.stringify(pastebarUIVersion),
    },
    envPrefix: [
      'VITE_',
      'TAURI_PLATFORM',
      'TAURI_ARCH',
      'TAURI_FAMILY',
      'TAURI_PLATFORM_VERSION',
      'TAURI_PLATFORM_TYPE',
      'TAURI_DEBUG',
    ],

    build: {
      outDir: path.join(__dirname, 'dist-ui'),
      emptyOutDir: true,
      commonjsOptions: { defaultIsModuleExports: 'auto' },
      target: ['es2015', 'safari11'],
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_DEBUG,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          history: path.resolve(__dirname, 'history-index.html'),
          quickpaste: path.resolve(__dirname, 'quickpaste-index.html'),
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        plugins: [],
      },
    },
    resolve: {
      alias: {
        '~': path.join(__dirname, 'src'),
      },
    },
    plugins: [
      // Injects the version into <title>. Must live in this array: a second top-level
      // `plugins` key would silently replace this one rather than merge with it.
      htmlTitleVersion(),
      react({
        babel: {
          plugins: [
            'module:@preact/signals-react-transform',
            ['babel-plugin-react-compiler', ReactCompilerConfig],
          ],
        },
      }) as PluginOption,
      dynamicImport() as any,
      i18nextLoader({
        paths: ['./src/locales/lang'],
        namespaceResolution: 'basename',
      }) as PluginOption,
      viteStaticCopy({
        targets: [
          {
            src: 'drop-*',
            dest: '.',
          },
        ],
      }),
      {
        name: 'build-script',
        closeBundle() {
          const packageJson = require('./package.json')
          const version = packageJson.version
          fs.mkdir(path.join(__dirname, 'dist-ui'), { recursive: false }, () => {
            const versionFile = path.join(__dirname, 'dist-ui', `ui.version.${version}`)
            fs.writeFileSync(versionFile, version)
            const stylesSrc = path.join(__dirname, 'assets/styles')
            const stylesDest = path.join(__dirname, 'dist-ui/assets/styles')
            fs.cpSync(stylesSrc, stylesDest, { recursive: true })
            const wasmSrc = path.join(__dirname, 'assets/markdown')
            const wasmDest = path.join(__dirname, 'dist-ui/assets/markdown')
            fs.cpSync(wasmSrc, wasmDest, { recursive: true })
          })
        },
      },
    ],
  })
}
