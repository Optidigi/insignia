import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';

type Draft = { label: string; version: number };

type Props = Draft & { canEdit: boolean; viewer: string };

function DraftEditor({ label: initialLabel, version: initialVersion, canEdit, viewer }: Props) {
  const [label, setLabel] = useState(initialLabel);
  const [savedLabel, setSavedLabel] = useState(initialLabel);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackTone, setFeedbackTone] = useState<'error' | 'success' | ''>('');
  const saving = useRef(false);
  const focusField = () => document.getElementById('synthetic-label')?.focus();

  const onFieldChange = (event: Event) => {
    const value = (event.currentTarget as HTMLElement & { value: string }).value;
    setLabel(value);
    setFieldError('');
    setFeedback('');
    setFeedbackTone('');
  };

  const save = async () => {
    if (saving.current || !canEdit) return;
    const nextLabel = label.trim();
    if (nextLabel.length === 0 || Array.from(nextLabel).length > 80 || /\p{Cc}/u.test(nextLabel)) {
      setFieldError('Enter a label between 1 and 80 characters.');
      focusField();
      return;
    }
    if (nextLabel === savedLabel) {
      setFeedback('No changes to save.');
      setFeedbackTone('');
      return;
    }

    saving.current = true;
    setBusy(true);
    setFieldError('');
    setFeedback('Saving synthetic draft…');
    setFeedbackTone('');
    try {
      // App Bridge intercepts this same-origin request and adds the ID token.
      const response = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ label: nextLabel, version, viewer }),
        cache: 'no-store',
        redirect: 'error',
      });
      if (response.status === 401) throw new Error('Your Admin session expired. Retry after reconnecting.');
      if (response.status === 403) throw new Error('You do not have permission to edit this draft.');
      if (response.status === 409) throw new Error('This draft changed. Reload the page before saving again.');
      if (response.status === 422) {
        setFieldError('Enter a valid label between 1 and 80 characters.');
        focusField();
        return;
      }
      if ((response.status !== 200 && response.status !== 201) ||
          !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The draft could not be saved. Retry when your connection is available.');
      }
      const updated: unknown = await response.json();
      if (!isDraft(updated)) throw new Error('The save response was invalid. Reload the page.');
      setLabel(updated.label);
      setSavedLabel(updated.label);
      setVersion(updated.version);
      setFeedback('Synthetic draft saved locally.');
      setFeedbackTone('success');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'The draft could not be saved.');
      setFeedbackTone('error');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <form class="draft-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <s-text-field
        id="synthetic-label"
        label="Synthetic draft label"
        value={label}
        error={fieldError}
        disabled={!canEdit || busy}
        onInput={onFieldChange}
        onChange={onFieldChange}
      />
      <s-button
        type="submit"
        variant="primary"
        loading={busy}
        disabled={!canEdit || busy}
        onClick={(event) => { event.preventDefault(); void save(); }}
      >
        Save synthetic draft
      </s-button>
      {!canEdit && <p>You have read-only access to this draft.</p>}
      <p class="draft-feedback" data-tone={feedbackTone} role="status" aria-live="polite">{feedback}</p>
    </form>
  );
}

function isDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<Draft>;
  return typeof draft.label === 'string' && typeof draft.version === 'number' &&
    Number.isSafeInteger(draft.version) && draft.version >= 0;
}

export function mountDraftEditor(root: HTMLElement): () => void {
  const version = Number(root.dataset.version);
  if (!Number.isSafeInteger(version) || version < 0 || root.dataset.label === undefined ||
      !/^[0-9a-f]{64}$/.test(root.dataset.viewer ?? '') ||
      (root.dataset.canEdit !== 'true' && root.dataset.canEdit !== 'false')) {
    throw new Error('Invalid draft fragment');
  }
  render(<DraftEditor label={root.dataset.label} version={version} canEdit={root.dataset.canEdit === 'true'} viewer={root.dataset.viewer!} />, root);
  return () => render(null, root);
}
