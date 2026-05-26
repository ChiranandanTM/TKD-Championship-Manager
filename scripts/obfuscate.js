/**
 * Build script: obfuscates all JS files from public/js/ into dist/
 * then copies HTML, CSS, and assets unchanged.
 *
 * Run: node scripts/obfuscate.js
 * Deploy: firebase deploy --public dist
 */

const JavaScriptObfuscator = require('javascript-obfuscator');
const fse = require('fs-extra');
const path = require('path');
const fs = require('fs');

const SRC = path.resolve(__dirname, '../public');
const DIST = path.resolve(__dirname, '../dist');

// Files that should NOT be obfuscated (service worker must stay readable for browser)
const SKIP_OBFUSCATION = ['service-worker.js'];

// Obfuscator options — strong protection without breaking ES module imports
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,        // keep console for Firebase error visibility
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,               // keep window.xxx exports intact
  rotateStringArray: true,
  selfDefending: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  sourceMap: false
};

async function build() {
  console.log('🔨 Cleaning dist/...');
  await fse.remove(DIST);
  await fse.ensureDir(DIST);

  console.log('📂 Copying all files from public/ to dist/...');
  await fse.copy(SRC, DIST);

  console.log('🔒 Obfuscating JS files...');
  const jsDir = path.join(DIST, 'js');
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

  let obfuscated = 0;
  let skipped = 0;

  for (const file of jsFiles) {
    if (SKIP_OBFUSCATION.includes(file)) {
      console.log(`  ⏭  Skipped: ${file}`);
      skipped++;
      continue;
    }

    const filePath = path.join(jsDir, file);
    const source = fs.readFileSync(filePath, 'utf8');

    try {
      const result = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_OPTIONS);
      fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
      console.log(`  ✅ Obfuscated: ${file}`);
      obfuscated++;
    } catch (err) {
      console.warn(`  ⚠️  Could not obfuscate ${file}: ${err.message} — copying as-is`);
    }
  }

  console.log(`\n✅ Build complete`);
  console.log(`   Obfuscated : ${obfuscated} files`);
  console.log(`   Skipped    : ${skipped} files`);
  console.log(`   Output dir : dist/`);
  console.log(`\n🚀 To deploy: firebase deploy --public dist`);
}

build().catch(err => {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
});
