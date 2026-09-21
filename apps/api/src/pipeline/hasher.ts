import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export interface FileFingerprint {
  size: number;
  mtimeMs: number;
}

@Injectable()
export class HasherService {
  async stat(filePath: string): Promise<FileFingerprint> {
    const stat = await fsp.stat(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  }

  /** Real content hash (sha256 over the full file bytes), streamed to avoid loading large files fully into memory. */
  async hashContent(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /** Canonical, order-independent key for a set of optimize options. */
  variantKey(options: Record<string, string | number | undefined>): string {
    const parts = Object.keys(options)
      .sort()
      .filter((key) => options[key] !== undefined)
      .map((key) => `${key}=${options[key]}`);
    return parts.join(';');
  }
}
