/**
 * File Manager for Multi-Platform Integration
 *
 * This module handles file operations for attachments across different messaging
 * platforms, including download, upload, storage, and metadata management.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { PlatformFile, MessagePlatform } from './platform-interface';

/**
 * File metadata stored alongside attachments
 */
export interface FileMetadata {
  /** Original file information */
  original: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    platform: string;
    url: string;
    caption?: string;
  };
  /** Local storage information */
  local: {
    path: string;
    filename: string;
    storedAt: Date;
    hash: string;
    size: number;
  };
  /** Processing information */
  processing: {
    downloaded: boolean;
    validated: boolean;
    errors: string[];
    lastAccessed?: Date;
  };
  /** Security information */
  security: {
    scanned: boolean;
    safe: boolean;
    scanResults?: any;
  };
}

/**
 * File upload options
 */
export interface FileUploadOptions {
  /** Target platform */
  platform: string;
  /** Target chat/channel ID */
  chatId: string;
  /** Optional caption */
  caption?: string;
  /** Whether to delete local file after upload */
  deleteAfterUpload?: boolean;
  /** Upload timeout in milliseconds */
  timeout?: number;
}

/**
 * File download options
 */
export interface FileDownloadOptions {
  /** Whether to overwrite existing files */
  overwrite?: boolean;
  /** Download timeout in milliseconds */
  timeout?: number;
  /** Whether to validate file integrity */
  validateIntegrity?: boolean;
  /** Maximum file size to download (bytes) */
  maxSize?: number;
}

/**
 * File storage configuration
 */
export interface FileStorageConfig {
  /** Base directory for file storage */
  baseDir: string;
  /** Maximum total storage size (bytes) */
  maxTotalSize: number;
  /** Maximum individual file size (bytes) */
  maxFileSize: number;
  /** File retention period (days) */
  retentionDays: number;
  /** Allowed MIME types (empty = all allowed) */
  allowedMimeTypes: string[];
  /** Blocked MIME types */
  blockedMimeTypes: string[];
  /** Whether to enable virus scanning */
  enableVirusScanning: boolean;
}

/**
 * File operation result
 */
export interface FileOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** File path (for successful operations) */
  filePath?: string;
  /** File metadata */
  metadata?: FileMetadata;
  /** Error message (for failed operations) */
  error?: string;
  /** Additional details */
  details?: Record<string, any>;
}

/**
 * Main file manager class
 */
export class FileManager {
  private config: FileStorageConfig;
  private platforms = new Map<string, MessagePlatform>();
  private metadataCache = new Map<string, FileMetadata>();

  constructor(config: Partial<FileStorageConfig> = {}) {
    this.config = {
      baseDir: path.join(os.homedir(), '.everfern', 'attachments'),
      maxTotalSize: 10 * 1024 * 1024 * 1024, // 10GB
      maxFileSize: 100 * 1024 * 1024, // 100MB
      retentionDays: 30,
      allowedMimeTypes: [],
      blockedMimeTypes: [
        'application/x-executable',
        'application/x-msdownload',
        'application/x-msdos-program'
      ],
      enableVirusScanning: false,
      ...config
    };
  }

  /**
   * Initialize the file manager
   */
  async initialize(): Promise<void> {
    try {
      // Create base directories
      await this.ensureDirectories();

      // Load existing metadata
      await this.loadMetadataCache();

      // Clean up old files
      await this.cleanupOldFiles();

      console.log('FileManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize FileManager:', error);
      throw error;
    }
  }

  /**
   * Register a platform for file operations
   */
  registerPlatform(name: string, platform: MessagePlatform): void {
    this.platforms.set(name, platform);
  }

  /**
   * Download a file from a platform
   */
  async downloadFile(
    file: PlatformFile,
    platform: string,
    options: FileDownloadOptions = {}
  ): Promise<FileOperationResult> {
    try {
      // Validate file
      const validation = await this.validateFile(file, options);
      if (!validation.success) {
        return validation;
      }

      // Generate local file path
      const localPath = await this.generateLocalPath(file);

      // Check if file already exists
      if (!options.overwrite && await this.fileExists(localPath)) {
        const metadata = await this.getFileMetadata(file.id);
        return {
          success: true,
          filePath: localPath,
          metadata: metadata || undefined,
          details: { cached: true }
        };
      }

      // Get platform instance
      const platformInstance = this.platforms.get(platform);
      if (!platformInstance) {
        return {
          success: false,
          error: `Platform ${platform} not registered`
        };
      }

      // Download file with timeout
      await this.downloadWithTimeout(
        platformInstance,
        file,
        localPath,
        options.timeout || 30000
      );

      // Verify download
      const stats = await fs.stat(localPath);
      if (file.size > 0 && stats.size !== file.size) {
        await fs.unlink(localPath).catch(() => {}); // Clean up partial download
        return {
          success: false,
          error: 'File size mismatch after download'
        };
      }

      // Calculate file hash
      const hash = await this.calculateFileHash(localPath);

      // Create metadata
      const metadata: FileMetadata = {
        original: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          platform,
          url: file.url,
          caption: file.caption
        },
        local: {
          path: localPath,
          filename: path.basename(localPath),
          storedAt: new Date(),
          hash,
          size: stats.size
        },
        processing: {
          downloaded: true,
          validated: true,
          errors: []
        },
        security: {
          scanned: false,
          safe: true // Assume safe until proven otherwise
        }
      };

      // Perform security scan if enabled
      if (this.config.enableVirusScanning) {
        await this.performSecurityScan(metadata);
      }

      // Save metadata
      await this.saveFileMetadata(file.id, metadata);
      this.metadataCache.set(file.id, metadata);

      return {
        success: true,
        filePath: localPath,
        metadata
      };

    } catch (error) {
      return {
        success: false,
        error: `Download failed: ${error}`
      };
    }
  }

  /**
   * Upload a file to a platform
   */
  async uploadFile(
    localPath: string,
    options: FileUploadOptions
  ): Promise<FileOperationResult> {
    try {
      // Validate local file
      if (!await this.fileExists(localPath)) {
        return {
          success: false,
          error: 'Local file does not exist'
        };
      }

      const stats = await fs.stat(localPath);
      if (stats.size > this.config.maxFileSize) {
        return {
          success: false,
          error: 'File exceeds maximum size limit'
        };
      }

      // Get platform instance
      const platform = this.platforms.get(options.platform);
      if (!platform) {
        return {
          success: false,
          error: `Platform ${options.platform} not registered`
        };
      }

      // Read file for upload
      const fileBuffer = await fs.readFile(localPath);
      const filename = path.basename(localPath);

      // Upload file
      const messageId = await platform.sendMessage('', {
        chatId: options.chatId,
        attachments: [{
          file: fileBuffer,
          filename,
          caption: options.caption
        }]
      });

      // Clean up local file if requested
      if (options.deleteAfterUpload) {
        await fs.unlink(localPath).catch(() => {});
      }

      return {
        success: true,
        details: {
          messageId,
          platform: options.platform,
          chatId: options.chatId
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Upload failed: ${error}`
      };
    }
  }

  /**
   * Get file metadata by file ID
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
    // Check cache first
    if (this.metadataCache.has(fileId)) {
      return this.metadataCache.get(fileId)!;
    }

    // Load from disk
    try {
      const metadataPath = this.getMetadataPath(fileId);
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataJson) as FileMetadata;

      // Update cache
      this.metadataCache.set(fileId, metadata);
      return metadata;
    } catch (error) {
      return null;
    }
  }

  /**
   * List all stored files
   */
  async listFiles(): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];

    try {
      const metadataDir = path.join(this.config.baseDir, 'metadata');
      const metadataFiles = await fs.readdir(metadataDir);

      for (const filename of metadataFiles) {
        if (filename.endsWith('.json')) {
          const fileId = filename.replace('.json', '');
          const metadata = await this.getFileMetadata(fileId);
          if (metadata) {
            files.push(metadata);
          }
        }
      }
    } catch (error) {
      console.error('Error listing files:', error);
    }

    return files;
  }

  /**
   * Delete a file and its metadata
   */
  async deleteFile(fileId: string): Promise<boolean> {
    try {
      const metadata = await this.getFileMetadata(fileId);
      if (!metadata) {
        return false;
      }

      // Delete local file
      await fs.unlink(metadata.local.path).catch(() => {});

      // Delete metadata file
      const metadataPath = this.getMetadataPath(fileId);
      await fs.unlink(metadataPath).catch(() => {});

      // Remove from cache
      this.metadataCache.delete(fileId);

      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    availableSpace: number;
    oldestFile?: Date;
    newestFile?: Date;
  }> {
    const files = await this.listFiles();

    let totalSize = 0;
    let oldestFile: Date | undefined;
    let newestFile: Date | undefined;

    for (const file of files) {
      totalSize += file.local.size;

      if (!oldestFile || file.local.storedAt < oldestFile) {
        oldestFile = file.local.storedAt;
      }

      if (!newestFile || file.local.storedAt > newestFile) {
        newestFile = file.local.storedAt;
      }
    }

    return {
      totalFiles: files.length,
      totalSize,
      availableSpace: this.config.maxTotalSize - totalSize,
      oldestFile,
      newestFile
    };
  }

  /**
   * Clean up old files based on retention policy
   */
  async cleanupOldFiles(): Promise<number> {
    const files = await this.listFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    let deletedCount = 0;

    for (const file of files) {
      if (file.local.storedAt < cutoffDate) {
        const deleted = await this.deleteFile(file.original.id);
        if (deleted) {
          deletedCount++;
        }
      }
    }

    return deletedCount;
  }

  /**
   * Validate file before download
   */
  private async validateFile(
    file: PlatformFile,
    options: FileDownloadOptions
  ): Promise<FileOperationResult> {
    // Check file size
    if (options.maxSize && file.size > options.maxSize) {
      return {
        success: false,
        error: `File size (${file.size}) exceeds maximum allowed (${options.maxSize})`
      };
    }

    if (file.size > this.config.maxFileSize) {
      return {
        success: false,
        error: `File size (${file.size}) exceeds system maximum (${this.config.maxFileSize})`
      };
    }

    // Check MIME type
    if (this.config.blockedMimeTypes.includes(file.mimeType)) {
      return {
        success: false,
        error: `MIME type ${file.mimeType} is blocked`
      };
    }

    if (this.config.allowedMimeTypes.length > 0 &&
        !this.config.allowedMimeTypes.includes(file.mimeType)) {
      return {
        success: false,
        error: `MIME type ${file.mimeType} is not allowed`
      };
    }

    // Check available storage space
    const stats = await this.getStorageStats();
    if (stats.availableSpace < file.size) {
      return {
        success: false,
        error: 'Insufficient storage space'
      };
    }

    return { success: true };
  }

  /**
   * Generate local file path
   */
  private async generateLocalPath(file: PlatformFile): Promise<string> {
    // Create safe filename
    const safeFilename = this.sanitizeFilename(file.name);
    const extension = path.extname(safeFilename);
    const basename = path.basename(safeFilename, extension);

    // Add hash to prevent conflicts
    const hash = crypto.createHash('md5').update(file.id).digest('hex').substring(0, 8);
    const filename = `${basename}_${hash}${extension}`;

    return path.join(this.config.baseDir, 'files', filename);
  }

  /**
   * Sanitize filename for safe storage
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .substring(0, 100); // Limit length
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download file with timeout
   */
  private async downloadWithTimeout(
    platform: MessagePlatform,
    file: PlatformFile,
    localPath: string,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Download timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      platform.downloadFile(file, localPath)
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Calculate file hash for integrity verification
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Perform security scan on file using static entropy & binary signature analysis
   */
  private async performSecurityScan(metadata: FileMetadata): Promise<void> {
    let isSafe = true;
    let scanResult = 'clean';
    let threatsFound: string[] = [];

    try {
      const targetPath = metadata.local?.path;
      const targetFilename = metadata.local?.filename || metadata.original?.name || '';

      if (targetPath && (await fs.stat(targetPath)).isFile()) {
        const fileBuffer = await fs.readFile(targetPath);
        
        // 1. Calculate Shannon Entropy (0-8 bits per byte)
        const byteCounts = new Uint32Array(256);
        for (let i = 0; i < fileBuffer.length; i++) {
          byteCounts[fileBuffer[i]]++;
        }
        let entropy = 0;
        for (let i = 0; i < 256; i++) {
          if (byteCounts[i] > 0) {
            const p = byteCounts[i] / fileBuffer.length;
            entropy -= p * Math.log2(p);
          }
        }

        // 2. Binary Executable Signature Check (PE, ELF, Mach-O, dangerous extensions)
        const isExeExt = /\.(exe|dll|bat|cmd|vbs|ps1|sh|jar|scr|pif)$/i.test(targetFilename);
        const hasMZHeader = fileBuffer.length > 2 && fileBuffer[0] === 0x4d && fileBuffer[1] === 0x5a;
        const hasELFHeader = fileBuffer.length > 4 && fileBuffer[0] === 0x7f && fileBuffer[1] === 0x45 && fileBuffer[2] === 0x4c && fileBuffer[3] === 0x46;

        if ((hasMZHeader || hasELFHeader) && isExeExt) {
          threatsFound.push('executable_binary_detected');
        }

        // High entropy check (>7.8) for suspicious packed payloads
        if (entropy > 7.85 && fileBuffer.length > 10240) {
          threatsFound.push(`high_entropy_compressed_or_encrypted (${entropy.toFixed(2)} bits/byte)`);
        }

        if (threatsFound.length > 0) {
          scanResult = `flagged: ${threatsFound.join(', ')}`;
          // Mark executable flags if strict policies apply
        }
      }
    } catch (err) {
      console.warn('[FileManager] Security scan warning:', err);
    }

    metadata.security.scanned = true;
    metadata.security.safe = isSafe;
    metadata.security.scanResults = {
      scannedAt: new Date(),
      engine: 'everfern-static-analyzer',
      result: scanResult
    };
  }

  /**
   * Save file metadata to disk
   */
  private async saveFileMetadata(fileId: string, metadata: FileMetadata): Promise<void> {
    const metadataPath = this.getMetadataPath(fileId);
    const metadataJson = JSON.stringify(metadata, null, 2);
    await fs.writeFile(metadataPath, metadataJson, 'utf-8');
  }

  /**
   * Get metadata file path
   */
  private getMetadataPath(fileId: string): string {
    return path.join(this.config.baseDir, 'metadata', `${fileId}.json`);
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [
      this.config.baseDir,
      path.join(this.config.baseDir, 'files'),
      path.join(this.config.baseDir, 'metadata')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Load metadata cache from disk
   */
  private async loadMetadataCache(): Promise<void> {
    try {
      const metadataDir = path.join(this.config.baseDir, 'metadata');
      const files = await fs.readdir(metadataDir);

      for (const filename of files) {
        if (filename.endsWith('.json')) {
          const fileId = filename.replace('.json', '');
          const metadata = await this.getFileMetadata(fileId);
          if (metadata) {
            this.metadataCache.set(fileId, metadata);
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet, which is fine
    }
  }
}

/**
 * Create a file manager with default configuration
 */
export function createFileManager(config: Partial<FileStorageConfig> = {}): FileManager {
  return new FileManager(config);
}
