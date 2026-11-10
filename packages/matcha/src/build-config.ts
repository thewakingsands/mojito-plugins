// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.

declare const __MATCHA_UNIVERSALIS__: { apiKey: string; uploaderId: string } | null | undefined

/**
 * The Universalis API key and uploader ID, injected when the package is built (MATCHA_UNIVERSALIS_API_KEY and
 * MATCHA_UNIVERSALIS_UPLOADER_ID, see vite.config.ts); null when the build has none, which turns Universalis off.
 */
export const universalisCredentials = typeof __MATCHA_UNIVERSALIS__ === 'undefined' ? null : __MATCHA_UNIVERSALIS__
