// ============================================
// ADVANCED IMAGE OPTIMIZER MODULE
// ============================================
// Automatically optimizes player profile images after upload
// Target: ~50KB-80KB or lower while maintaining visual quality
// Supports: JPG, JPEG, PNG, WEBP

const IMAGE_OPTIMIZER = {
  // Configuration
  config: {
    maxFileSizeTarget: 80 * 1024,       // 80KB target
    maxDimensions: 500,                 // Max 500x500px for display quality
    minDimensions: 200,                 // Min 200x200px
    initialQuality: 0.75,               // Start at 75% quality
    minQuality: 0.30,                   // Don't go below 30% quality
    supportedFormats: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    qualityStep: 0.05,                  // Adjust quality by 5% steps
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
          console.log(`✅ Image already optimized (${(file.size / 1024).toFixed(2)}KB < 80KB target)`);
          return resolve({ blob: file, dataUrl: await this.fileToDataUrl(file), optimized: false });
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
          const { blob, quality } = await this.adaptiveQualityCompression(
            canvas,
            this.config.maxFileSizeTarget,
            this.config.initialQuality
          );

          // Convert to data URL
          const dataUrl = await this.blobToDataUrl(blob);

          console.log(`🎯 Compression complete:`);
          console.log(`   Original: ${(file.size / 1024).toFixed(2)}KB (${file.type})`);
          console.log(`   Optimized: ${(blob.size / 1024).toFixed(2)}KB (JPEG @ ${(quality * 100).toFixed(0)}%)`);
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
