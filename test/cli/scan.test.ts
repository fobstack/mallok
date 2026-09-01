import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDirectory } from '../../src/cli/scan.js';

/** Writes a tree of files under a fresh temp directory. */
async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mallok-scan-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, ...path.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

const OPTIONS = {
  defaultLocale: 'en',
  kinds: ['page', 'article', 'product'],
};

describe('scanDirectory', () => {
  it('reads a bundle with its translations and assets', async () => {
    const root = await tree({
      'article/hello/index.md': '---\ntitle: Hello\n---\n\n![a](images/a.png)',
      'article/hello/index.zh.md': '---\ntitle: 你好\n---\n\n正文。',
      'article/hello/images/a.png': 'png-bytes',
      'article/hello/mallok.json':
        '{"translation_group":"g1","items":{"en":{"id":"i1","created_at":"t","path":"/p"}}}',
    });
    const result = await scanDirectory(root, OPTIONS);
    expect(result.layout).toBe('bundles');
    expect(result.bundles).toHaveLength(1);
    const bundle = result.bundles[0];
    expect(bundle?.kind).toBe('article');
    expect(bundle?.name).toBe('hello');
    expect(bundle?.documents.map((d) => d.locale)).toEqual(['en', 'zh']);
    expect(bundle?.identity?.translation_group).toBe('g1');
    expect([...(bundle?.documents[0]?.assets.keys() ?? [])]).toEqual([
      'images/a.png',
    ]);
  });

  it('treats a referenced file that is absent as missing, not an error', async () => {
    const root = await tree({
      'article/x/index.md': '---\ntitle: X\n---\n\n![a](images/gone.png)',
    });
    const result = await scanDirectory(root, OPTIONS);
    expect(result.bundles[0]?.documents[0]?.missing).toEqual([
      'images/gone.png',
    ]);
    expect(result.bundles[0]?.documents[0]?.assets.size).toBe(0);
  });

  it('stops rather than guessing an unrecognised content type', async () => {
    const root = await tree({
      'recipes/x/index.md': '---\ntitle: X\n---\n\nBody.',
    });
    // Filing unknown content under `article` would put it at a URL the
    // author never chose (docs/CONTENT_FORMAT.md §7.1).
    await expect(scanDirectory(root, OPTIONS)).rejects.toThrow(
      /do not match any content type/,
    );
  });

  it('accepts --kind for a flat directory of Markdown files', async () => {
    const root = await tree({
      'one.md': '---\ntitle: One\n---\n\nBody.',
      'two.md': '---\ntitle: Two\n---\n\nBody.',
    });
    const result = await scanDirectory(root, { ...OPTIONS, kind: 'article' });
    expect(result.layout).toBe('flat');
    expect(result.bundles.map((b) => b.name).sort()).toEqual(['one', 'two']);
    expect(result.bundles.every((b) => b.kind === 'article')).toBe(true);
  });

  it('reports image slots that have no file yet', async () => {
    const root = await tree({
      'article/x/index.md': '---\ntitle: X\n---\n\n![a](images/have.png)',
      'article/x/images/have.png': 'bytes',
      'article/x/image-slots.json':
        '{"slots":["images/have.png","images/wanted.png"]}',
    });
    const result = await scanDirectory(root, OPTIONS);
    // Only the unfilled one is reported (docs/CONTENT_FORMAT.md §7.5).
    expect(result.bundles[0]?.unfilledSlots).toEqual(['images/wanted.png']);
  });

  it('ignores a bundle file that is not index*.md', async () => {
    const root = await tree({
      'article/x/index.md': '---\ntitle: X\n---\n\nBody.',
      'article/x/image-requirements.md': 'Notes for a human.',
    });
    const result = await scanDirectory(root, OPTIONS);
    // Mallok does not interpret or upload other files (§7.5).
    expect(result.bundles[0]?.documents).toHaveLength(1);
  });

  it('says so when there is nothing to import', async () => {
    const root = await tree({ 'readme.txt': 'no markdown here' });
    await expect(scanDirectory(root, OPTIONS)).rejects.toThrow(
      /No Markdown found/,
    );
  });
});
