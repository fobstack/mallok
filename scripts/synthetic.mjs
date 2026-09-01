/** Deterministic synthetic Markdown of roughly `kb` kilobytes. */
export function syntheticMarkdown(kb) {
  const paragraph =
    'Titanium alloys combine **high strength** with low density, which is why ' +
    'aerospace buyers keep asking about *Grade 5* bar stock, `Ti-6Al-4V` plate ' +
    'and [seamless tubing](https://example.com/tubing). ';
  const block = [
    '## Section heading',
    '',
    paragraph.repeat(3),
    '',
    '- Item one with some text',
    '- Item two with `code`',
    '- Item three',
    '',
    '| Grade | Density | Tensile |',
    '|-------|---------|---------|',
    '| Gr2   | 4.51    | 345 MPa |',
    '| Gr5   | 4.43    | 895 MPa |',
    '',
    '![Furnace](images/furnace.jpg)',
    '',
    '> A quoted remark from a mill engineer.',
    '',
  ].join('\n');
  const target = kb * 1024;
  let out = '# Synthetic article\n\n';
  while (out.length < target) {
    out += block;
  }
  return out;
}

/** Runs `fn` `rounds` times and returns the median CPU time in ms. */
export async function medianCpuMs(fn, rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const start = process.cpuUsage();
    await fn();
    const used = process.cpuUsage(start);
    samples.push((used.user + used.system) / 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}
