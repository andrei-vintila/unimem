// Tauri API bindings for the desktop app

import { invoke } from '@tauri-apps/api/core';

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Get the app data directory path
 */
export async function getAppDataDir(): Promise<string> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri environment');
  }
  return invoke<string>('get_app_data_dir');
}

/**
 * Get the documents directory path
 */
export async function getDocumentDir(): Promise<string> {
  if (!isTauri()) {
    throw new Error('Not running in Tauri environment');
  }
  return invoke<string>('get_document_dir');
}

/**
 * Get the database storage path based on environment
 */
export async function getDatabasePath(): Promise<string> {
  if (isTauri()) {
    const appDataDir = await getAppDataDir();
    return `${appDataDir}/unimem.db`;
  }

  // Browser fallback - use IndexedDB
  return 'idb://unimem';
}
