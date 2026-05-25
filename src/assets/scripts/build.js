/**
 * Unified build script for Õpetaja Assistent 2
 *
 * This script handles the complete build process:
 * 1. Converting SVG icons to PNG
 * 2. Cleaning the dist directory
 * 3. Building and minifying JavaScript files
 * 4. Copying static assets to dist
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import sharp from 'sharp'

// Check if building for production
const isProd = process.argv.includes('--prod')

// Configuration
const CONFIG = {
  // Directories
  srcDir: 'src',
  distDir: 'dist',
  templatesDir: 'src/assets/templates',

  // Source SVG file for all icon sizes
  iconSource: 'src/assets/templates/icon.svg',

  // Icons to generate
  icons: [
    { size: 48, name: 'icon48.png' },
    { size: 128, name: 'icon128.png' }
  ],

  // Files to bundle with Bun
  bundleFiles: ['content.js', 'background.js', 'popup.js'],

  // Build mode
  isProd: isProd,

  // Bundle options
  bundleOptions: isProd ? ['--minify'] : []
}

// Main build function
async function build() {
  console.log(`🚀 Starting ${CONFIG.isProd ? 'PRODUCTION' : 'DEVELOPMENT'} build process...`)

  try {
    // Step 1: Clean dist directory
    await cleanDist()

    // Step 2: Bundle JavaScript
    await bundleJavaScript()

    // Step 3: Convert icons
    await convertIcons()

    // Step 4: Copy static assets
    await copyStaticAssets()

    console.log('✅ Build completed successfully!')
  } catch (error) {
    console.error('❌ Build failed:', error)
    process.exit(1)
  }
}

// Clean dist directory
async function cleanDist() {
  console.log('🧹 Cleaning dist directory...')

  if (fs.existsSync(CONFIG.distDir)) {
    fs.rmSync(CONFIG.distDir, { recursive: true, force: true })
  }

  fs.mkdirSync(CONFIG.distDir, { recursive: true })
}

// Bundle JavaScript files using Bun
async function bundleJavaScript() {
  console.log('📦 Bundling JavaScript files...')

  const files = CONFIG.bundleFiles.map(file => path.join(CONFIG.srcDir, file))

  return new Promise((resolve, reject) => {
    const bunBuild = spawn('bun', ['build', ...files, '--outdir', CONFIG.distDir, ...CONFIG.bundleOptions])

    bunBuild.stdout.on('data', data => {
      console.log(`  ${data.toString().trim()}`)
    })

    bunBuild.stderr.on('data', data => {
      console.error(`  ${data.toString().trim()}`)
    })

    bunBuild.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Bun build failed with code ${code}`))
      }
    })
  })
}

// Convert SVG icons to PNG
async function convertIcons() {
  console.log('🖼️  Converting SVG icons to PNG...')

  try {
    // Check if source SVG exists
    if (!fs.existsSync(CONFIG.iconSource)) {
      throw new Error(`Source icon not found: ${CONFIG.iconSource}`)
    }

    // Convert each icon size
    for (const icon of CONFIG.icons) {
      console.log(`  Converting ${icon.name} (${icon.size}x${icon.size})...`)

      await sharp(CONFIG.iconSource).resize(icon.size, icon.size).png().toFile(path.join(CONFIG.distDir, icon.name))
    }
  } catch (error) {
    console.error('Error converting icons:', error)
    throw error
  }
}

// Copy static assets to dist
async function copyStaticAssets() {
  console.log('📋 Copying static assets...')

  // Copy manifest.json and sync version from package.json
  const manifestPath = path.join(CONFIG.templatesDir, 'manifest.json')
  fs.copyFileSync(manifestPath, path.join(CONFIG.distDir, 'manifest.json'))
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const manifestDistPath = path.join(CONFIG.distDir, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestDistPath, 'utf8'))
  manifest.version = pkg.version
  fs.writeFileSync(manifestDistPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`  Copied manifest.json (version synced to ${pkg.version})`)

  // Copy popup.html
  const popupPath = path.join(CONFIG.templatesDir, 'popup.html')
  fs.copyFileSync(popupPath, path.join(CONFIG.distDir, 'popup.html'))
  console.log('  Copied popup.html')

  // Copy icon.svg
  const iconSvgPath = path.join(CONFIG.templatesDir, 'icon.svg')
  fs.copyFileSync(iconSvgPath, path.join(CONFIG.distDir, 'icon.svg'))
  console.log('  Copied icon.svg')

  // Copy CSS files
  const stylesSourceDir = path.join(CONFIG.srcDir, 'assets', 'styles')
  const stylesDestDir = path.join(CONFIG.distDir, 'styles')

  // Create the destination directory structure
  fs.mkdirSync(stylesDestDir, { recursive: true })

  // Copy JournalSyncBannerService.css
  const cssSourcePath = path.join(stylesSourceDir, 'JournalSyncBannerService.css')
  const cssDestPath = path.join(stylesDestDir, 'JournalSyncBannerService.css')
  fs.copyFileSync(cssSourcePath, cssDestPath)
  console.log('  Copied JournalSyncBannerService.css')

  // Copy xhrInterceptor.js (main-world script, NOT bundled — must stay a plain IIFE)
  const xhrInterceptorSource = path.join(CONFIG.srcDir, 'xhrInterceptor.js')
  fs.copyFileSync(xhrInterceptorSource, path.join(CONFIG.distDir, 'xhrInterceptor.js'))
  console.log('  Copied xhrInterceptor.js')

  // Copy LessonTimes.json
  const lessonTimesSourceDir = path.join(CONFIG.srcDir, 'features', 'singleJournal', 'lessonDiscrepancies')
  const lessonTimesDestDir = path.join(CONFIG.distDir, 'src', 'features', 'singleJournal', 'lessonDiscrepancies')

  // Create the destination directory structure
  fs.mkdirSync(lessonTimesDestDir, { recursive: true })

  const lessonTimesSourcePath = path.join(lessonTimesSourceDir, 'LessonTimes.json')
  const lessonTimesDestPath = path.join(lessonTimesDestDir, 'LessonTimes.json')
  fs.copyFileSync(lessonTimesSourcePath, lessonTimesDestPath)
  console.log('  Copied LessonTimes.json')
}

// Run the build process
build()
