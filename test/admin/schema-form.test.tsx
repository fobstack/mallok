// @vitest-environment happy-dom
import { act, type JSX } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type FieldValues, type UseFormReturn, useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/admin/api.js';
import { SchemaForm, showServerErrors } from '../../src/admin/form/form.js';
import type { FieldSpec } from '../../src/admin/form/types.js';
import type { ThemeField } from '../../src/core/index.js';

/**
 * The schema form on React Hook Form (docs/ADMIN_MIGRATION.md, phase 4),
 * rendered into a real DOM: what a person filling it in, or a screen reader,
 * actually gets.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function spec(name: string, field: Partial<ThemeField>): FieldSpec {
  return {
    name,
    field: { type: 'string', required: false, ...field } as ThemeField,
  };
}

const SPECS = [
  spec('a', { label: 'A', required: true }),
  spec('b', { label: 'B', type: 'number' }),
];

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** Renders the form and returns its handle once it has mounted. */
function mount(options: {
  readonly defaults: FieldValues;
  readonly validateHere?: boolean;
  readonly namePrefix?: string;
  readonly onValid: (values: FieldValues) => void;
}): UseFormReturn<FieldValues> {
  let handle: UseFormReturn<FieldValues> | null = null;
  function Harness(): JSX.Element {
    const form = useForm<FieldValues>({ defaultValues: options.defaults });
    handle = form;
    return (
      <form onSubmit={form.handleSubmit(options.onValid)}>
        <SchemaForm
          specs={SPECS}
          control={form.control}
          idPrefix="t"
          {...(options.namePrefix === undefined
            ? {}
            : { namePrefix: options.namePrefix })}
          {...(options.validateHere === undefined
            ? {}
            : { validateHere: options.validateHere })}
        />
        <button type="submit">Save</button>
      </form>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(<Harness />);
  });
  if (handle === null) {
    throw new Error('The form did not mount.');
  }
  return handle;
}

async function submit(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[type=submit]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function control(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`No control #${id}.`);
  }
  return element;
}

describe('the schema form', () => {
  it('checks every declared field before submitting, and says why beside each', async () => {
    const onValid = vi.fn();
    mount({ defaults: { b: 'not a number' }, onValid });
    await submit();

    expect(onValid).not.toHaveBeenCalled();
    for (const [id, message] of [
      ['t-a', 'This field is required.'],
      ['t-b', 'Enter a number.'],
    ] as const) {
      expect(control(id).getAttribute('aria-invalid')).toBe('true');
      expect(control(id).getAttribute('aria-describedby')).toBe(`${id}-error`);
      expect(control(`${id}-error`).textContent).toBe(message);
    }
  });

  it('submits what was entered once every field passes', async () => {
    const onValid = vi.fn();
    mount({ defaults: { a: 'set', b: 3 }, onValid });
    await submit();
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(onValid.mock.calls[0]?.[0]).toEqual({ a: 'set', b: 3 });
  });

  it('leaves the checks to the server when asked to', async () => {
    const onValid = vi.fn();
    mount({ defaults: {}, validateHere: false, onValid });
    await submit();
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(document.getElementById('t-a-error')).toBeNull();
  });

  it("puts the server's message on the field it names", async () => {
    const form = mount({ defaults: {}, validateHere: false, onValid: vi.fn() });
    act(() => {
      showServerErrors(
        form.setError,
        new ApiError(400, 'Not saved.', { a: 'Already taken.' }),
      );
    });
    expect(control('t-a').getAttribute('aria-describedby')).toBe('t-a-error');
    expect(control('t-a-error').textContent).toBe('Already taken.');
    expect(document.getElementById('t-b-error')).toBeNull();
  });

  it('reads and writes a group nested in the values', async () => {
    const onValid = vi.fn();
    mount({
      defaults: { rows: [{ a: 'first', b: 1 }] },
      namePrefix: 'rows.0.',
      onValid,
    });
    expect((control('t-a') as HTMLInputElement).value).toBe('first');
    await submit();
    expect(onValid.mock.calls[0]?.[0]).toEqual({
      rows: [{ a: 'first', b: 1 }],
    });
  });
});
