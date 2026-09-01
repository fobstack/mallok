/**
 * The API's response shapes, as the admin consumes them.
 *
 * These mirror what `src/worker/admin-*.ts` returns. They are declared here
 * rather than imported because the Worker's types carry Cloudflare types the
 * browser build must not pull in.
 */

import type { ThemeField, ThemeManifest } from '../core/index.js';

/** Who is signed in. */
export interface Session {
  readonly kind: 'session' | 'token';
  readonly email: string | null;
  readonly csrf: string;
  readonly passwordIterations: number;
  readonly passwordRecommendedIterations: number;
}

/** Site settings the admin may edit. */
export interface Settings {
  readonly name: string;
  readonly tagline: string | null;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly kinds: Readonly<Record<string, { readonly base: string }>>;
  readonly themeOptions: Readonly<Record<string, unknown>>;
  readonly nav: Readonly<
    Record<string, readonly { label: string; href: string }[]>
  >;
  readonly seo: Readonly<Record<string, unknown>>;
  readonly domain: string | null;
  readonly mediaBaseUrl: string | null;
  readonly cacheTtl: number;
  readonly maxImageEdge: number | null;
  readonly setupCompletedAt: string | null;
}

/** The active theme, its manifest and its templates. */
export interface ThemeInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly kinds: ThemeManifest['kinds'];
  readonly options: ThemeManifest['options'];
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly imageWidths: readonly number[];
  readonly clientScripts: ThemeManifest['clientScripts'];
  readonly assetBase: string;
  /** Templates and locale bundles, so the editor can render a real preview. */
  readonly files: Readonly<Record<string, string>>;
  readonly available: readonly string[];
  readonly switchRequiresDeploy: boolean;
}

/** One content row as the list endpoint returns it. */
export interface ContentListItem {
  readonly id: string;
  readonly kind: string;
  readonly locale: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'draft' | 'scheduled' | 'published';
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly translationGroup: string;
}

/** A registered plugin as the admin lists it. */
export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly official: boolean;
  readonly enabled: boolean;
  readonly hooks: readonly string[];
  readonly routes: readonly string[];
  readonly affectsFragmentCache: boolean;
  readonly clientScripts: readonly {
    src: string;
    purpose: string;
    bytes?: number;
  }[];
  readonly runsOnEveryRequest: boolean;
  readonly settings: Readonly<Record<string, ThemeField>>;
  readonly values: Readonly<Record<string, unknown>>;
  readonly secrets: readonly {
    name: string;
    label: string;
    required: boolean;
    configured: boolean;
    /** The plugin can verify this one without sending anything real. */
    checkable: boolean;
  }[];
  readonly panels: readonly PluginPanel[];
}

/** A declarative table panel a plugin contributes. */
export interface PluginPanel {
  readonly id: string;
  readonly label: string;
  readonly type: 'table';
  readonly table: string;
  readonly columns: readonly {
    field: string;
    label: string;
    type: 'text' | 'email' | 'datetime' | 'badge';
  }[];
  readonly filters: readonly string[];
  readonly detail: readonly string[];
  readonly orderBy: string;
  readonly actions: readonly {
    id: string;
    label: string;
    type: 'update' | 'download';
  }[];
}

/** One media object. */
export interface MediaItem {
  readonly sha256: string;
  readonly kind: 'image' | 'file';
  readonly mime: string;
  readonly ext: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly variants: readonly number[];
  readonly originalName: string;
  readonly alt: string | null;
  readonly refCount: number;
  readonly url: string;
}

/** Deployment facts the admin must be honest about. */
export interface Health {
  readonly ok: boolean;
  readonly site: string | null;
  readonly theme: string;
  readonly pipeline: string;
  /**
   * Whether a cache-purge token is configured. When false, a saved change
   * reaches visitors only after the cached page expires — the admin says so
   * rather than claiming the edit is live (docs/ADMIN.md §5).
   */
  readonly purgeConfigured: boolean;
  readonly customDomain: string | null;
  readonly mediaBaseUrl: string | null;
}
