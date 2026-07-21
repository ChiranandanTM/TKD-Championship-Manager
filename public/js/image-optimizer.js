// ============================================
// ADVANCED IMAGE OPTIMIZER MODULE
// ============================================
// Automatically optimizes player profile images after upload
// Target: ~35KB blob or lower while maintaining visual quality
//
// Sizing note: the compressed blob is stored as a base64 data URL in
// playerImages/{id}, which firebase-rules.json caps at 50,000 characters.
// Base64 inflates raw bytes by ~4/3, so the target here must stay well
// under 37.5KB (50000 chars / 4 * 3) to leave room for the data-URL
// prefix and never trip that validation rule.
// Supports: JPG, JPEG, PNG, WEBP

const IMAGE_OPTIMIZER = {
  // Configuration
  config: {
    maxFileSizeTarget: 35 * 1024,       // 35KB target — keeps base64 output safely under the 50,000-char Firebase limit
    maxDimensions: 500,                 // Max 500x500px for display quality
    minDimensions: 200,                 // Min 200x200px
    initialQuality: 0.75,               // Start at 75% quality
    minQuality: 0.30,                   // Don't go below 30% quality
    supportedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    qualityStep: 0.05,                  // Adjust quality by 5% steps
    maxDataUrlLength: 49000,            // Hard safety ceiling, just under Firebase's 50,000-char cap
  },

  // Validate file format
  validateFileFormat(file) {
    if (!file || !file.type) {
      return { valid: false, error: '❌ Invalid file: No file provided' };
    }

    const mimeType = file.type.toLowerCase();
    if (!this.config.supportedFormats.includes(mimeType)) {
      return {
        valid: false,
        error: `❌ Unsupported format: ${mimeType}. Supported: JPG, PNG, WEBP`
      };
    }

    // Check file size (skip unreasonably large files)
    const maxSize = 50 * 1024 * 1024; // 50MB limit
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `❌ File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Max: 50MB`
      };
    }

    return { valid: true };
  },

  // Fix image orientation (EXIF)
  async fixImageOrientation(canvas, img, orientation) {
    const ctx = canvas.getContext('2d');
    ctx.save();

    const width = canvas.width;
    const height = canvas.height;

    // Apply rotation/flip based on EXIF orientation (1-8)
    switch (orientation) {
      case 2: // Flip horizontal
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        break;
      case 3: // Rotate 180
        ctx.translate(width, height);
        ctx.rotate(Math.PI);
        break;
      case 4: // Flip vertical
        ctx.translate(0, height);
        ctx.scale(1, -1);
        break;
      case 5: // Rotate 90 CCW & flip
        canvas.width = height;
        canvas.height = width;
        ctx.translate(0, width);
        ctx.rotate(-Math.PI / 2);
        break;
      case 6: // Rotate 90 CW
        canvas.width = height;
        canvas.height = width;
        ctx.translate(height, 0);
        ctx.rotate(Math.PI / 2);
        break;
      case 7: // Rotate 90 CW & flip
        canvas.width = height;
        canvas.height = width;
        ctx.translate(height, width);
        ctx.rotate(Math.PI / 2);
        ctx.scale(1, -1);
        break;
      case 8: // Rotate 90 CCW
        canvas.width = height;
        canvas.height = width;
        ctx.translate(0, height);
        ctx.rotate(-Math.PI / 2);
        break;
      default:
        // No rotation needed for orientation 1
        break;
    }

    ctx.drawImage(img, 0, 0);
    ctx.restore();
  },

  // Extract EXIF orientation (simplified - for common formats)
  async getImageOrientation(file) {
    return new Promise((resolve) => {
      try {
        // For JPEG files, try to extract EXIF orientation
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
          const reader = new FileReader();
          reader.onload = (e) => {
            const view = new Uint8Array(e.target.result);
            // Check for EXIF marker (simplified check)
            if (view[0] === 0xFF && view[1] === 0xD8) {
              // JPEG file, but full EXIF parsing is complex
              // For now, assume default orientation 1
              resolve(1);
            } else {
              resolve(1);
            }
          };
          reader.readAsArrayBuffer(file.slice(0, 1024));
        } else {
          resolve(1); // Default orientation for other formats
        }
      } catch (err) {
        console.warn('⚠️ Could not extract EXIF orientation:', err);
        resolve(1); // Default orientation on error
      }
    });
  },

  // Calculate optimal dimensions while maintaining aspect ratio
  calculateOptimalDimensions(originalWidth, originalHeight) {
    let width = originalWidth;
    let height = originalHeight;
    const maxDim = this.config.maxDimensions;

    // Scale down if larger than max dimensions
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // Ensure minimum dimensions for quality
    if (width < this.config.minDimensions && height < this.config.minDimensions) {
      const ratio = this.config.minDimensions / Math.min(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    return { width, height };
  },

  // Adaptive quality adjustment - iteratively compress to hit target size
  async adaptiveQualityCompression(canvas, targetSize, initialQuality) {
    return new Promise(async (resolve) => {
      let quality = initialQuality;
      let lastBlob = null;

      const attemptCompression = async (q) => {
        return new Promise((resolveAttempt) => {
          canvas.toBlob((blob) => {
            resolveAttempt(blob);
          }, 'image/jpeg', q);
        });
      };

      // Binary search for optimal quality
      let minQuality = this.config.minQuality;
      let maxQuality = Math.min(initialQuality, 0.95);
      let attempts = 0;
      const maxAttempts = 8;

      while (attempts < maxAttempts && (maxQuality - minQuality) > 0.02) {
        quality = (minQuality + maxQuality) / 2;
        const blob = await attemptCompression(quality);
        const size = blob.size;

        console.log(`🔍 Optimization attempt ${attempts + 1}: Quality ${(quality * 100).toFixed(0)}% = ${(size / 1024).toFixed(2)}KB`);

        lastBlob = blob;

        if (size > targetSize) {
          // Too large, reduce quality
          maxQuality = quality;
        } else {
          // Small enough, try higher quality
          minQuality = quality;
        }

        attempts++;
      }

      // One final compression with best quality found
      lastBlob = await attemptCompression(minQuality);
      console.log(`✅ Final optimized image: Quality ${(minQuality * 100).toFixed(0)}% = ${(lastBlob.size / 1024).toFixed(2)}KB`);

      resolve({ blob: lastBlob, quality: minQuality });
    });
  },

  // Main optimization function
  async optimizeImage(file) {
    return new Promise(async (resolve) => {
      try {
        // Validate file format
        const validation = this.validateFileFormat(file);
        if (!validation.valid) {
          console.error(validation.error);
          return resolve({ error: validation.error, original: file });
        }

        console.log(`📸 Starting image optimization for: ${file.name}`);
        console.log(`📊 Original size: ${(file.size / 1024).toFixed(2)}KB`);

        // Check if already small enough
        if (file.size <= this.config.maxFileSizeTarget) {
          const smallDataUrl = await this.fileToDataUrl(file);
          if (smallDataUrl.length <= this.config.maxDataUrlLength) {
            console.log(`✅ Image already optimized (${(file.size / 1024).toFixed(2)}KB < target, no re-encode needed)`);
            return resolve({ blob: file, dataUrl: smallDataUrl, optimized: false });
          }
          // Small binary size but still too large as base64 (e.g. an already-JPEG file
          // right at the edge) — fall through to the normal compression pipeline below
          // instead of returning it as-is.
        }

        // Load image
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = async () => {
          URL.revokeObjectURL(url);
          console.log(`📐 Original dimensions: ${img.width}x${img.height}px`);

          // Get EXIF orientation
          const orientation = await this.getImageOrientation(file);
          console.log(`🔄 EXIF orientation: ${orientation}`);

          // Calculate optimal dimensions
          const { width, height } = this.calculateOptimalDimensions(img.width, img.height);
          console.log(`📏 Optimized dimensions: ${width}x${height}px`);

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          // Apply orientation and draw image
          const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for better compression
          ctx.fillStyle = '#FFFFFF'; // White background for transparent PNGs
          ctx.fillRect(0, 0, width, height);
          await this.fixImageOrientation(canvas, img, orientation);

          // Adaptive quality compression
          let { blob, quality } = await this.adaptiveQualityCompression(
            canvas,
            this.config.maxFileSizeTarget,
            this.config.initialQuality
          );

          // Convert to data URL
          let dataUrl = await this.blobToDataUrl(blob);

          // Hard safety net: pathological images (rare, e.g. very high-detail source
          // photos) can still exceed the target after quality-only compression.
          // Progressively shrink dimensions at minimum quality until the base64
          // output is guaranteed to fit Firebase's 50,000-char validation cap.
          let safetyCanvas = canvas;
          let safetyAttempts = 0;
          while (dataUrl.length > this.config.maxDataUrlLength && safetyAttempts < 5) {
            safetyAttempts++;
            const shrunkWidth = Math.max(this.config.minDimensions, Math.round(safetyCanvas.width * 0.7));
            const shrunkHeight = Math.max(this.config.minDimensions, Math.round(safetyCanvas.height * 0.7));
            const shrunkCanvas = document.createElement('canvas');
            shrunkCanvas.width = shrunkWidth;
            shrunkCanvas.height = shrunkHeight;
            const shrunkCtx = shrunkCanvas.getContext('2d', { alpha: false });
            shrunkCtx.fillStyle = '#FFFFFF';
            shrunkCtx.fillRect(0, 0, shrunkWidth, shrunkHeight);
            shrunkCtx.drawImage(safetyCanvas, 0, 0, shrunkWidth, shrunkHeight);

            blob = await new Promise((r) => shrunkCanvas.toBlob(r, 'image/jpeg', this.config.minQuality));
            dataUrl = await this.blobToDataUrl(blob);
            quality = this.config.minQuality;
            safetyCanvas = shrunkCanvas;

            console.log(`⚠️ SAFETY NET attempt ${safetyAttempts}: shrunk to ${shrunkWidth}x${shrunkHeight}, dataUrl=${dataUrl.length} chars`);
          }

          console.log(`🎯 Compression complete:`);
          console.log(`   Original: ${(file.size / 1024).toFixed(2)}KB (${file.type})`);
          console.log(`   Optimized: ${(blob.size / 1024).toFixed(2)}KB (JPEG @ ${(quality * 100).toFixed(0)}%), dataUrl=${dataUrl.length} chars`);
          console.log(`   Reduction: ${(100 - (blob.size / file.size * 100)).toFixed(1)}%`);

          // Create optimized File object
          const optimizedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          });

          resolve({
            blob,
            dataUrl,
            file: optimizedFile,
            optimized: true,
            originalSize: file.size,
            optimizedSize: blob.size,
            reduction: (100 - (blob.size / file.size * 100)).toFixed(1),
          });
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          const error = '❌ Failed to load image. File may be corrupted.';
          console.error(error);
          resolve({ error, original: file });
        };

        img.src = url;
      } catch (err) {
        console.error('❌ Image optimization error:', err);
        resolve({ error: err.message, original: file });
      }
    });
  },

  // Utility: Convert file to data URL
  fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // Utility: Convert blob to data URL
  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  // Utility: Format file size for display
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  // Batch optimize multiple images (for future use)
  async optimizeMultiple(files) {
    const results = [];
    for (const file of files) {
      const result = await this.optimizeImage(file);
      results.push(result);
    }
    return results;
  },
};

console.log('✅ Image Optimizer module loaded');
